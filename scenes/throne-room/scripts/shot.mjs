// Screenshots of the viewer: node scripts/shot.mjs <beat> <out.png> [at seconds, or several: 10,20.5,30] [cam x,y,z,tx,ty,tz]
// Starts the dev server if none is running on 5290 (or $PORT), plays the beat to each `at` and saves a frame there (several times: <out>-<at>.png).
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const [beat, out, at = '0', cam] = process.argv.slice(2);
if (!beat || !out) throw new Error('usage: node scripts/shot.mjs <beat> <out.png> [at[,at…]] [cam]');
const times = at.split(',').map(Number).sort((a, b) => a - b);
const port = process.env.PORT ?? '5290';
const base = `http://localhost:${port}/`;
const running = await fetch(base).then(() => true, () => false);
const server = running ? undefined : spawn('npx', ['vite', '--logLevel', 'warn', '--port', port], { cwd: new URL('..', import.meta.url).pathname, stdio: 'inherit' });
for (let tries = 0; !(await fetch(base).then(() => true, () => false)); tries++) {
  if (tries > 60) throw new Error('dev server did not start');
  await new Promise((done) => setTimeout(done, 500));
}
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (error) => console.error('page error:', error.message));
const query = new URLSearchParams({ beat, at: String(times[0]), ...(cam ? { cam } : {}) });
await page.goto(`${base}?${query}`);
await page.waitForSelector('body[data-ready=true]', { timeout: 180_000 });
for (const [index, time] of times.entries()) {
  if (index > 0) await page.evaluate((seconds) => window.seekTo(seconds), time);
  await page.waitForTimeout(300);
  const path = times.length > 1 ? out.replace(/\.png$/, `-${time}.png`) : out;
  await page.screenshot({ path });
  console.log(path, await page.textContent('#time'));
}
await browser.close();
server?.kill();
