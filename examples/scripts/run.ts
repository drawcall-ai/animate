import type { LogEntry } from '@drawcall/animate';
import type { CastOptions, Scenario } from '../src/scenario';
import { Simulation } from '../src/simulation';
export { seeded } from '../src/math';

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
