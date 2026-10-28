// Screenshots of the viewer: node scripts/shot.mjs <beat> <out.png> [at seconds] [cam x,y,z,tx,ty,tz]
// Starts the dev server if none is running on 5290, plays the beat to `at` and saves one frame.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const [beat, out, at = '0', cam] = process.argv.slice(2);
if (!beat || !out) throw new Error('usage: node scripts/shot.mjs <beat> <out.png> [at] [cam]');
const base = 'http://localhost:5290/';
const running = await fetch(base).then(() => true, () => false);
const server = running ? undefined : spawn('npx', ['vite', '--logLevel', 'warn'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'inherit' });
for (let tries = 0; !(await fetch(base).then(() => true, () => false)); tries++) {
  if (tries > 60) throw new Error('dev server did not start');
  await new Promise((done) => setTimeout(done, 500));
}
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (error) => console.error('page error:', error.message));
const query = new URLSearchParams({ beat, at, ...(cam ? { cam } : {}) });
await page.goto(`${base}?${query}`);
await page.waitForSelector('body[data-ready=true]', { timeout: 180_000 });
await page.waitForTimeout(300);
await page.screenshot({ path: out });
console.log(out, await page.textContent('#time'));
await browser.close();
server?.kill();
