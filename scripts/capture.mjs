// Renders contact sheets (rows = times, columns = camera views) for review.
// usage: node scripts/capture.mjs [--examples a,b] [--times 1,2,3 | --frames 6] [--views front,side,three,top]
//        [--size 360] [--mode 3d|2d] [--trail <seconds>] [--zoom k] [--turn rad] [--cols N] [--out captures]
//        [--body mannequin|openpose]  (the actors as viverse's mannequin under thin skeletons, or as OpenPose skeletons;
//                                    default: each example's own)
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
  await page.goto(`${BASE}?capture=1&t=0`);
  await ready();
  const durations = await page.evaluate(async () => {
    const m = await import('/src/entries.ts');
    return Object.fromEntries(m.ENTRIES.map((e) => [e.shot.id, e.shot.duration]));
  });
  const ids = args.examples ? args.examples.split(',') : Object.keys(durations);
  const unknown = ids.filter((id) => !(id in durations));
  if (unknown.length) throw new Error(`unknown examples: ${unknown.join(', ')} (known: ${Object.keys(durations).join(', ')})`);

  for (const id of ids) {
    const frames = Number(args.frames);
    const times = args.times ? args.times.split(',').map(Number) : Array.from({ length: frames }, (_, i) => +((durations[id] * (i + 0.5)) / frames).toFixed(2));
    const cells = [];
    for (const t of times) {
      for (const view of views) {
        await page.goto(`${BASE}?capture=1&example=${id}&t=${t}&view=${view}&${extra}`);
        await ready();
        cells.push(`data:image/png;base64,${(await page.screenshot({ type: 'png' })).toString('base64')}`);
      }
    }
    const cols = Number(args.cols ?? views.length);
    const sheet = await browser.newPage({ viewport: { width: size * cols, height: 200 } });
    await sheet.setContent(`<html><body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},${size}px)">
      ${cells.map((src) => `<img src="${src}" width="${size}" height="${size}" style="display:block;outline:1px solid #333"/>`).join('')}
    </body></html>`);
    const file = join(args.out, `${id}${args.mode === '2d' ? '-2d' : ''}${args.trail ? '-trail' : ''}${args.body ? `-${args.body}` : ''}.png`);
    writeFileSync(file, await sheet.screenshot({ fullPage: true, type: 'png' }));
    await sheet.close();
    console.log(`${file}  times=${times.join(',')}  views=${views.join(',')}`);
  }
} finally {
  await browser.close();
}
