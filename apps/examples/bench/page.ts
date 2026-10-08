// Browser benchmark (bench.html). Query: ?n=20,50,100&seconds=15&warmup=3
// The report goes to the page and to `window.__bench` (read by scripts/bench.mjs).
import { measure, report, type Host, type Result } from './measure';

declare global {
  interface Window {
    __bench?: { done: boolean; report: string };
  }
  interface Performance {
    /** Chromium only; precise with --enable-precise-memory-info */
    memory?: { usedJSHeapSize: number };
  }
}

const q = new URLSearchParams(location.search);
const sizes = (q.get('n') ?? '20,50,100').split(',').map(Number);
const seconds = Number(q.get('seconds') ?? 15);
const warmup = Number(q.get('warmup') ?? 3);
const out = document.getElementById('out');
if (!out) throw new Error('bench.html needs #out');

const host: Host = {
  heap: () => performance.memory?.usedJSHeapSize ?? null,
  // let the page breathe
  pause: () => new Promise((r) => setTimeout(r, 0)),
};
const timer = crossOriginIsolated ? '5 µs (cross-origin isolated)' : '100 µs (not cross-origin isolated)';
const state = { done: false, report: '' };
window.__bench = state;

const results: Result[] = [];
for (const n of sizes) {
  results.push(await measure(n, seconds, warmup, host));
  state.report = `${report(results)}\n\ntimer resolution: ${timer}`;
  out.textContent = state.report + (results.length < sizes.length ? '\nrunning…' : '');
}
state.done = true;
