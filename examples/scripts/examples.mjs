// The examples app, driven headless by the scripts: its dev server and page failures.
import { spawn } from 'node:child_process';

/** the dev server's port (EXAMPLES_PORT, default 5287) */
const PORT = Number(process.env.EXAMPLES_PORT ?? 5287);
export const BASE = `http://localhost:${PORT}/`;

const up = () => fetch(BASE).then((r) => r.ok, () => false);

/**
 * An already running dev server is reused, otherwise one is started and stopped again when
 * the returned stop function is called in finally. Load pages from `BASE`.
 */
export async function devServer() {
  if (await up()) return async () => {};
  const child = spawn('pnpm', ['--filter', 'examples', 'exec', 'vite', '--port', String(PORT)], { stdio: 'ignore', detached: true });
  const stop = () => process.kill(-child.pid);
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await up()) return async () => stop();
  }
  stop();
  throw new Error(`the dev server did not come up on ${BASE} within 20 s`);
}

/** rejects on the page's first uncaught error: race it against waits, so they fail at once instead of timing out */
export function pageError(page) {
  const failed = new Promise((_, reject) => page.on('pageerror', (e) => reject(new Error(`page error: ${e.message}`))));
  failed.catch(() => {});
  return failed;
}
