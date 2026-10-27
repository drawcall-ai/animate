// Renders contact sheets (rows = times, columns = camera views) for review.
// usage: node scripts/capture.mjs [--examples a,b] [--times 1,2,3 | --frames 6] [--views front,side,three,top]
//        [--size 360] [--mode 3d|2d] [--trail <seconds>] [--zoom k] [--turn rad] [--cols N] [--each] [--out captures]
//        [--body soldier|person|outlier]  (the skeleton people stand on where an example names none: the soldier wears its
//                                         model, the others are drawn as OpenPose skeletons; default soldier)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { BASE, devServer, pageError } from './examples.mjs';

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    examples: { type: 'string' },
    times: { type: 'string' },
    frames: { type: 'string', default: '6' },
    views: { type: 'string', default: 'front,side,three,top' },
    size: { type: 'string', default: '360' },
    mode: { type: 'string', default: '3d' },
    trail: { type: 'string' },
    zoom: { type: 'string' },
    // turns the shots about the focus (rad, + = toward the body's left): e.g. π for the other side
    turn: { type: 'string' },
    // wraps cells into N columns (e.g. a filmstrip of one view over many times)
    cols: { type: 'string' },
    // one sheet per time, its views side by side: <example>@<t>.png
    each: { type: 'boolean', default: false },
    out: { type: 'string', default: 'captures' },
    body: { type: 'string' },
  },
});
const size = Number(args.size);
const views = args.views.split(',');
const extra = new URLSearchParams({ mode: args.mode });
for (const k of ['trail', 'zoom', 'turn', 'body']) if (args[k]) extra.set(k, args[k]);
mkdirSync(args.out, { recursive: true });

await using server = await devServer();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const failed = pageError(page);
  const ready = () => Promise.race([page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 }), failed]);
  // (the first example asked for, if any: another may not load)
  await page.goto(`${BASE}?capture=1&t=0&example=${args.examples?.split(',')[0] ?? ''}`);
  await ready();
  const durations = await page.evaluate(async () => {
    const m = await import('/src/scenarios/index.ts');
    return Object.fromEntries(m.SCENARIOS.map((s) => [s.id, s.duration]));
  });
  const ids = args.examples ? args.examples.split(',') : Object.keys(durations);
  const unknown = ids.filter((id) => !(id in durations));
  if (unknown.length) throw new Error(`unknown examples: ${unknown.join(', ')} (known: ${Object.keys(durations).join(', ')})`);

  for (const id of ids) {
    const frames = Number(args.frames);
    const times = args.times ? args.times.split(',').map(Number) : Array.from({ length: frames }, (_, i) => +((durations[id] * (i + 0.5)) / frames).toFixed(2));
    const shots = async (t) => {
      const cells = [];
      for (const view of views) {
        await page.goto(`${BASE}?capture=1&example=${id}&t=${t}&view=${view}&${extra}`);
        await ready();
        cells.push(`data:image/png;base64,${(await page.screenshot({ type: 'png' })).toString('base64')}`);
      }
      return cells;
    };
    if (args.each) {
      for (const t of times) await sheet(await shots(t), views.length, join(args.out, `${id}@${t.toFixed(2)}.png`));
      console.log(`${join(args.out, `${id}@<t>.png`)}  times=${times.join(',')}  views=${views.join(',')}`);
      continue;
    }
    const cells = [];
    for (const t of times) cells.push(...(await shots(t)));
    const file = join(args.out, `${id}${args.mode === '2d' ? '-2d' : ''}${args.trail ? '-trail' : ''}${args.body ? `-${args.body}` : ''}.png`);
    await sheet(cells, Number(args.cols ?? views.length), file);
    console.log(`${file}  times=${times.join(',')}  views=${views.join(',')}`);
  }
} finally {
  await browser.close();
}

/** the shots `cells` (data URLs) laid out `cols` wide, saved to `file` */
async function sheet(cells, cols, file) {
  const page = await browser.newPage({ viewport: { width: size * cols, height: 200 } });
  await page.setContent(`<html><body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},${size}px)">
    ${cells.map((src) => `<img src="${src}" width="${size}" height="${size}" style="display:block;outline:1px solid #333"/>`).join('')}
  </body></html>`);
  writeFileSync(file, await page.screenshot({ fullPage: true, type: 'png' }));
  await page.close();
}
