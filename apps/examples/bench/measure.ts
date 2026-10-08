// The benchmark, shared by node (node.ts) and the browser (page.ts): a crowd of the example
// scenarios stepped at 60 Hz without rendering. The scenario scripts run outside the timed and
// heap-measured spans, so the numbers are the humanoids' own.
import { SCENARIOS } from '../src/scenarios';
import { FIXED_DT, Simulation, type ScenarioInput } from '../src/scenario';

/** Simulations of the example scenarios, cycled until they hold at least `n` characters. */
export class Crowd {
  readonly sims: Simulation[] = [];
  readonly characters: number = 0;
  private inputs: ScenarioInput[][] = [];

  constructor(n: number) {
    for (let i = 0; this.characters < n; i++) {
      const sim = new Simulation(SCENARIOS[i % SCENARIOS.length]);
      // each lap of the scenarios starts further in, so the crowd doesn't move in lockstep
      sim.advanceTo((Math.floor(i / SCENARIOS.length) * 2.7) % sim.scenario.duration);
      this.sims.push(sim);
      this.characters += sim.actors.length;
    }
  }

  /** restarts finished scenarios and takes every simulation's inputs for the next step */
  script() {
    this.sims.forEach((sim, i) => {
      if (sim.t >= sim.scenario.duration) this.sims[i] = new Simulation(sim.scenario);
    });
    this.inputs = this.sims.map((sim) => sim.script());
  }

  /** steps simulation `i` on its scripted inputs */
  update(i: number) {
    this.sims[i].update(this.inputs[i]);
  }

  step() {
    this.script();
    for (let i = 0; i < this.sims.length; i++) this.update(i);
  }
}

/** what the benchmark needs from its runtime */
export interface Host {
  /** the heap in use (bytes), or null where it can't be read */
  heap(): number | null;
  /** a full collection, where one can be forced */
  collect?(): void;
  /** called every simulated second (the browser yields to the page here) */
  pause?(): Promise<void>;
}

export interface Stats {
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface Result {
  characters: number;
  frames: number;
  /** ms per frame, all characters */
  frame: Stats;
  /** µs per character per tick, over all characters and by scenario */
  perChar: Stats;
  byScenario: Map<string, Stats>;
  /** heap growth per frame between collections (bytes; NaN where the heap can't be read) */
  alloc: number;
}

/** Times `n` characters for `seconds` after `warmup` seconds, then measures their allocation. */
export async function measure(n: number, seconds: number, warmup: number, host: Host): Promise<Result> {
  const crowd = new Crowd(n);
  for (let f = 0; f < warmup / FIXED_DT; f++) crowd.step();

  const frames = Math.round(seconds / FIXED_DT);
  const perSim = crowd.sims.map(() => new Float64Array(frames));
  const perFrame = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    crowd.script();
    const f0 = performance.now();
    for (let i = 0; i < crowd.sims.length; i++) {
      const t0 = performance.now();
      crowd.update(i);
      perSim[i][f] = performance.now() - t0;
    }
    perFrame[f] = performance.now() - f0;
    if (f % 60 === 59) await host.pause?.();
  }

  // µs per character: a simulation's time shared among its actors
  const perChar = perSim.map((a, i) => a.map((ms) => (ms * 1000) / crowd.sims[i].actors.length));
  const byScenario = new Map<string, Stats>();
  for (const s of new Set(crowd.sims.map((sim) => sim.scenario.id))) byScenario.set(s, stats(perChar.filter((_, i) => crowd.sims[i].scenario.id === s)));
  return { characters: crowd.characters, frames, frame: stats([perFrame]), perChar: stats(perChar), byScenario, alloc: allocation(crowd, host) };
}

/** median heap growth per frame over short runs of the updates alone, keeping runs without a collection */
function allocation(crowd: Crowd, host: Host): number {
  const grew: number[] = [];
  for (let run = 0; run < 40; run++) {
    host.collect?.();
    let bytes = 0;
    for (let f = 0; f < 10; f++) {
      crowd.script();
      const h0 = host.heap();
      if (h0 === null) return NaN;
      for (let i = 0; i < crowd.sims.length; i++) crowd.update(i);
      const h1 = host.heap() ?? NaN;
      // (a collection in between: the run can't tell)
      if (!(h1 >= h0)) {
        bytes = NaN;
        break;
      }
      bytes += h1 - h0;
    }
    if (!Number.isNaN(bytes)) grew.push(bytes / 10);
  }
  grew.sort((a, b) => a - b);
  return grew.length ? grew[grew.length >> 1] : NaN;
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

/** The results as text tables: per crowd size, then µs per character by scenario. */
export function report(results: Result[]): string {
  const pad = (cells: (string | number)[], width = 10) => cells.map((c) => String(c).padStart(width)).join('');
  const lines = [pad(['chars', 'ms/frame', 'p50', 'p95', 'p99', 'max', 'µs/char', 'p99', 'KiB/frame'])];
  for (const r of results) {
    const f = r.frame;
    lines.push(pad([r.characters, ...[f.mean, f.p50, f.p95, f.p99, f.max].map((v) => v.toFixed(3)), r.perChar.mean.toFixed(1), r.perChar.p99.toFixed(1), (r.alloc / 1024).toFixed(2)]));
  }
  lines.push('', `µs per character per tick, mean (p99)\n${'scenario'.padEnd(14)}${pad(results.map((r) => r.characters), 16)}`);
  for (const id of results[0]?.byScenario.keys() ?? []) {
    const cells = results.map((r) => {
      const s = r.byScenario.get(id);
      return s ? `${s.mean.toFixed(1)} (${s.p99.toFixed(1)})` : '';
    });
    lines.push(`${id.padEnd(14)}${pad(cells, 16)}`);
  }
  return lines.join('\n');
}
