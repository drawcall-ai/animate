import type { LogEntry } from '@drawcall/animate';
import type { CastOptions, Scenario } from '../src/scenario';
import { Simulation } from '../src/simulation';
/** a random source seeded by `seed` (mulberry32): the same numbers every run */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A scenario run to its end with development checks on every body: each body's log (by its index), and whether the run finished. */
export function run(scenario: Scenario, cast: CastOptions = {}): LogEntry[] {
  const sim = new Simulation(scenario, { ...cast, dev: true });
  while (sim.t < scenario.duration) sim.step();
  const log = sim.stage.bodies.flatMap((body, i) => body.log.map((entry) => ({ ...entry, where: `body ${i}: ${entry.where}` })));
  if (!sim.stage.done()) log.push({ time: sim.t, check: `${scenario.id}: scenario unfinished`, value: 1, limit: 0, where: scenario.id });
  return log;
}

/** VR's side-step is known not to finish: the body turns to walk rather than strafe, and comes under the head late. */
export function knownFailure(entry: LogEntry): boolean {
  return entry.check === 'vr: scenario unfinished';
}
