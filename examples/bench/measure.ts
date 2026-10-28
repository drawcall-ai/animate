// A crowd of complete scenarios stepped at 60 Hz, without rendering.
import { SCENARIOS } from '../src/scenarios';
import { FIXED_DT, type Scenario } from '../src/scenario';
import { Simulation } from '../src/simulation';

/** Simulations of `scenarios` (default every example), cycled until they hold at least `n` bodies. */
export class Crowd {
  readonly sims: Simulation[] = [];
  readonly bodies: number = 0;

  constructor(n: number, scenarios: readonly Scenario[] = SCENARIOS) {
    for (let i = 0; this.bodies < n; i++) {
      const sim = new Simulation(scenarios[i % scenarios.length]);
      // each lap of the scenarios starts further in, so the crowd doesn't move in lockstep
      sim.advanceTo((Math.floor(i / scenarios.length) * 2.7) % sim.scenario.duration);
      this.sims.push(sim);
      this.bodies += sim.stage.bodies.length;
    }
  }

  /** restarts the finished scenarios */
  restart() {
    this.sims.forEach((sim, i) => {
      if (sim.t >= sim.scenario.duration) this.sims[i] = new Simulation(sim.scenario);
    });
  }

  step() {
    this.restart();
    for (const sim of this.sims) sim.step();
  }
}

/** the scenarios named by `ids` (comma-separated), or every one */
export function named(ids: string | null | undefined): readonly Scenario[] {
  if (!ids) return SCENARIOS;
  return ids.split(',').map((id) => {
    const scenario = SCENARIOS.find((s) => s.id === id);
    if (!scenario) throw new Error(`no scenario "${id}" (known: ${SCENARIOS.map((s) => s.id).join(', ')})`);
    return scenario;
  });
}

export interface Stats {
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface Result {
  bodies: number;
  frames: number;
  /** ms per frame, all bodies */
  frame: Stats;
  /** µs per body per tick, over all bodies and by scenario */
  perBody: Stats;
  byScenario: Map<string, Stats>;
  /** heap growth per frame between collections (bytes) */
  alloc: number;
}

/** Times `n` bodies of `scenarios` for `seconds` after `warmup` seconds, then measures their allocation. */
export function measure(n: number, seconds: number, warmup: number, scenarios?: readonly Scenario[]): Result {
  const crowd = new Crowd(n, scenarios);
  for (let f = 0; f < warmup / FIXED_DT; f++) crowd.step();

  const frames = Math.round(seconds / FIXED_DT);
  const perSim = crowd.sims.map(() => new Float64Array(frames));
  const perFrame = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    crowd.restart();
    const f0 = performance.now();
    for (let i = 0; i < crowd.sims.length; i++) {
      const t0 = performance.now();
      crowd.sims[i].step();
      perSim[i][f] = performance.now() - t0;
    }
    perFrame[f] = performance.now() - f0;
  }

  // µs per body: a simulation's time shared among its bodies
  const perBody = perSim.map((a, i) => a.map((ms) => (ms * 1000) / crowd.sims[i].stage.bodies.length));
  const byScenario = new Map<string, Stats>();
  for (const s of new Set(crowd.sims.map((sim) => sim.scenario.id))) byScenario.set(s, stats(perBody.filter((_, i) => crowd.sims[i].scenario.id === s)));
  return { bodies: crowd.bodies, frames, frame: stats([perFrame]), perBody: stats(perBody), byScenario, alloc: allocation(crowd) };
}

/**
 * heap growth per frame: each simulation's step measured alone, over 40 frames, its median over the steps no collection fell in, summed
 * over the crowd (a whole frame of a large crowd allocates past the young generation: a collection falls in nearly every one)
 */
function allocation(crowd: Crowd): number {
  const collect = globalThis.gc;
  if (!collect) throw new Error('run with --expose-gc');
  collect();
  const grew = crowd.sims.map((): number[] => []);
  for (let f = 0; f < 40; f++) {
    crowd.restart();
    crowd.sims.forEach((sim, i) => {
      const before = process.memoryUsage().heapUsed;
      sim.step();
      const after = process.memoryUsage().heapUsed;
      if (after >= before) grew[i].push(after - before);
    });
  }
  return grew.reduce((sum, bytes) => sum + median(bytes), 0);
}

/** the middle of `values` (NaN if none) */
function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values.length ? values[values.length >> 1] : NaN;
}

function stats(samples: Float64Array[]): Stats {
  const all = new Float64Array(samples.reduce((s, a) => s + a.length, 0));
  let o = 0;
  for (const a of samples) {
    all.set(a, o);
    o += a.length;
  }
  all.sort();
  const at = (q: number) => all[Math.min(all.length - 1, Math.floor(q * all.length))];
  return { mean: all.reduce((s, x) => s + x, 0) / all.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: all[all.length - 1] };
}

/** The results as text tables: per crowd size, then µs per body by scenario. */
export function report(results: Result[]): string {
  const pad = (cells: (string | number)[], width = 10) => cells.map((c) => String(c).padStart(width)).join('');
  const lines = [pad(['bodies', 'ms/frame', 'p50', 'p95', 'p99', 'max', 'µs/body', 'p99', 'KiB/frame'])];
  for (const r of results) {
    const f = r.frame;
    lines.push(pad([r.bodies, ...[f.mean, f.p50, f.p95, f.p99, f.max].map((v) => v.toFixed(3)), r.perBody.mean.toFixed(1), r.perBody.p99.toFixed(1), (r.alloc / 1024).toFixed(2)]));
  }
  lines.push('', `µs per body per tick, mean (p99)\n${'scenario'.padEnd(14)}${pad(results.map((r) => r.bodies), 16)}`);
  for (const id of results[0]?.byScenario.keys() ?? []) {
    const cells = results.map((r) => {
      const s = r.byScenario.get(id);
      return s ? `${s.mean.toFixed(1)} (${s.p99.toFixed(1)})` : '';
    });
    lines.push(`${id.padEnd(14)}${pad(cells, 16)}`);
  }
  return lines.join('\n');
}
