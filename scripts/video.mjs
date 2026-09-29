// Frame-exact video of an example, as seen in live playback (orbit view by default).
// Usage: node scripts/video.mjs --example fight [--size 1280x720] [--fps 60] [--view three] [--out captures/fight.mp4]
//        --stills 2,6.5,11  saves PNG frames at those times instead of a video
//        --markers          keep the input-target indicators (hidden by default)
//        --cam cinematic    scripted camera: the normal third-person shot → a move into first person
//        --blur 4           film motion blur: 4 subframes per frame, 180° shutter (half of them blended)
// Needs the dev server (pnpm dev) and ffmpeg.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const example = arg('example', 'fight');
const [w, h] = arg('size', '1280x720').split('x').map(Number);
const fps = Number(arg('fps', 60));
const view = arg('view');
const out = arg('out', `captures/${example}.mp4`);
const base = arg('url', 'http://localhost:5287/');
const stills = arg('stills')?.split(',').map(Number);
const blur = stills ? 1 : Math.max(1, Number(arg('blur', 1)));

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const markers = process.argv.includes('--markers') ? '' : '&markers=0';
const cam = arg('cam') ? `&cam=${arg('cam')}` : '';
await page.goto(`${base}?example=${example}&video=1${markers}${cam}${view ? `&view=${view}` : ''}`);
await page.waitForFunction(() => window.__ready === true);

// motion blur: render blur× the frame rate, average the first half of each frame's subframes
const vf = blur > 1 ? ['-vf', `tmix=frames=${Math.max(1, Math.round(blur / 2))},fps=${fps}`] : [];
const ff = stills ? null : spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps * blur), '-i', '-', ...vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'slow', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
const done = ff ? new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`))))) : Promise.resolve();

let frames = 0;
for (;;) {
  const more = await page.evaluate((dt) => window.__frame(dt), 1 / (fps * blur));
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
await browser.close();
console.log(`\n${out}: ${Math.round(frames / blur)} frames, ${w}x${h} @ ${fps} fps${errors.length ? `, page errors: ${errors.join('; ')}` : ''}`);
