// Runs the browser benchmark (examples/bench.html) in headless Chromium and prints its report.
// usage: node scripts/bench.mjs [--n 20,50,100] [--seconds 15] [--warmup 3]
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { BASE, devServer, pageError } from './examples.mjs';

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    n: { type: 'string', default: '20,50,100' },
    seconds: { type: 'string', default: '15' },
    warmup: { type: 'string', default: '3' },
  },
});

await using server = await devServer();
const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });
try {
  const page = await browser.newPage();
  // cross-origin isolation: performance.now() at 5 µs instead of 100 µs
  await page.route('**/bench.html*', async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers(), 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' };
    await route.fulfill({ response, headers });
  });
  const failed = pageError(page);
  await page.goto(`${BASE}bench.html?${new URLSearchParams(args)}`);
  await Promise.race([page.waitForFunction(() => window.__bench?.done === true, null, { timeout: 600000, polling: 500 }), failed]);
  console.log(`Chromium ${browser.version()}\n`);
  console.log(await page.evaluate(() => window.__bench.report));
} finally {
  await browser.close();
}
