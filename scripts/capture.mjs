// Renders contact sheets (rows = times, columns = camera views) for review.
// usage: node scripts/capture.mjs [--examples a,b] [--times 1,2,3 | --frames 6] [--views front,side,three,top]
//        [--size 360] [--mode 3d|2d] [--trail <seconds>] [--zoom k] [--cols N] [--out captures]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const PORT = 5287;
const base = `http://localhost:${PORT}/`;
const size = Number(args.size ?? 360);
const views = (args.views ?? 'front,side,three,top').split(',');
// --cols N wraps cells into N columns (e.g. a filmstrip of one view over many times)
const cols = Number(args.cols ?? 0);
const out = args.out ?? 'captures';
const mode = args.mode ?? '3d';
const trail = (args.trail ? `&trail=${args.trail}` : '') + (args.zoom ? `&zoom=${args.zoom}` : '');
mkdirSync(out, { recursive: true });

async function up() {
  try {
    const r = await fetch(base);
    return r.ok;
  } catch {
    return false;
  }
}

let server;
if (!(await up())) {
  server = spawn('pnpm', ['--filter', 'examples', 'exec', 'vite', '--port', String(PORT)], { stdio: 'ignore', detached: true });
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: size, height: size } });
const durations = await (async () => {
  await page.goto(base + '?capture=1&t=0');
  await page.waitForFunction(() => window.__ready === true);
  return await page.evaluate(async () => {
    const m = await import('/src/scenarios/index.ts');
    return Object.fromEntries(m.SCENARIOS.map((s) => [s.id, s.duration]));
  });
})();
const ids = args.examples ? args.examples.split(',') : Object.keys(durations);

for (const id of ids) {
  const dur = durations[id];
  const times = args.times
    ? args.times.split(',').map(Number)
    : Array.from({ length: Number(args.frames ?? 6) }, (_, i) => +((dur * (i + 0.5)) / Number(args.frames ?? 6)).toFixed(2));
  const cells = [];
  for (const t of times) {
    for (const v of views) {
      await page.goto(`${base}?capture=1&example=${id}&t=${t}&view=${v}&mode=${mode}${trail}`);
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
      const png = await page.screenshot({ type: 'png' });
      cells.push({ t, v, src: `data:image/png;base64,${png.toString('base64')}` });
    }
  }
  const ncols = cols || views.length;
  const sheet = await browser.newPage({ viewport: { width: size * ncols, height: 200 } });
  await sheet.setContent(`<html><body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${ncols},${size}px);gap:0">
    ${cells.map((c) => `<div style="position:relative;outline:1px solid #333"><img src="${c.src}" width="${size}" height="${size}" style="display:block"/></div>`).join('')}
  </body></html>`);
  const file = join(out, `${id}${mode === '2d' ? '-2d' : ''}${trail ? '-trail' : ''}.png`);
  writeFileSync(file, await sheet.screenshot({ fullPage: true, type: 'png' }));
  await sheet.close();
  console.log(`${file}  times=${times.join(',')}  views=${views.join(',')}`);
}
await browser.close();
if (server) process.kill(-server.pid);
