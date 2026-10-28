// Frame-exact video of an example, as seen in live playback (orbit view by default).
// Usage: node scripts/video.mjs --example hand-over [--size 1280x720] [--fps 60] [--view three] [--out captures/hand-over.mp4]
//        --stills 2,6.5,11  saves PNG frames at those times instead of a video
//        --blur 4           film motion blur: 4 subframes per frame, 180° shutter (half of them blended)
// Needs ffmpeg for videos.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { BASE, devServer, pageError } from './examples.mjs';

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    example: { type: 'string', default: 'hand-over' },
    size: { type: 'string', default: '1280x720' },
    fps: { type: 'string', default: '60' },
    view: { type: 'string' },
    out: { type: 'string' },
    stills: { type: 'string' },
    blur: { type: 'string', default: '1' },
  },
});
const [w, h] = args.size.split('x').map(Number);
const fps = Number(args.fps);
const out = args.out ?? `captures/${args.example}.mp4`;
const stills = args.stills?.split(',').map(Number);
const blur = stills ? 1 : Math.max(1, Number(args.blur));
const query = new URLSearchParams({ example: args.example, video: '1' });
if (args.view) query.set('view', args.view);
mkdirSync(dirname(out), { recursive: true });

await using server = await devServer();
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
try {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const failed = pageError(page);
  await page.goto(`${BASE}?${query}`);
  await Promise.race([page.waitForFunction(() => window.__ready === true), failed]);

  // motion blur: render blur× the frame rate, average the first half of each frame's subframes
  const vf = blur > 1 ? ['-vf', `tmix=frames=${Math.max(1, Math.round(blur / 2))},fps=${fps}`] : [];
  const ff = stills ? null : spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps * blur), '-i', '-', ...vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'slow', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = ff ? new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`))))) : Promise.resolve();

  let frames = 0;
  for (;;) {
    const more = await Promise.race([page.evaluate((dt) => window.__frame(dt), 1 / (fps * blur)), failed]);
    frames++;
    if (stills) {
      const t = frames / fps;
      const hit = stills.find((s) => Math.abs(s - t) < 0.5 / fps);
      if (hit !== undefined) await page.screenshot({ path: out.replace(/\.mp4$/, '') + `-${hit}.png` });
      if (t > Math.max(...stills)) break;
      continue;
    }
    const png = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    if (frames % (fps * blur) === 0) process.stdout.write(`\r${(frames / fps / blur).toFixed(0)} s`);
    if (!more) break;
  }
  ff?.stdin.end();
  await done;
  console.log(`\n${out}: ${stills ? `stills at ${stills.join(', ')} s` : `${Math.round(frames / blur)} frames`}, ${w}x${h} @ ${fps} fps`);
} finally {
  await browser.close();
}
