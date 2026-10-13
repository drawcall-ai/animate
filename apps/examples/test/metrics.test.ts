// Objective motion metrics per scenario, asserted as regression guards (limits = measured
// values with a little headroom; judge.ts). Run: pnpm metrics [-- -t <id>]
import { it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { Simulation, type Scenario } from '../src/scenario';
import type { Frame } from './frame';
import { judge, limitsOf, measure } from './judge';

for (const sc of SCENARIOS) {
  it(sc.id, () => {
    const limit = limitsOf(sc.id);
    const m = measure(sc.id, steps(sc));
    console.log(m.report);
    judge(sc, m, limit);
  });
}

/** each fixed step's frames of a run of `sc` (OpenPose models, read without rendering) */
function* steps(sc: Scenario): Generator<Frame[]> {
  const sim = new Simulation(sc);
  while (sim.t < sc.duration) {
    sim.step();
    const props = sim.run.props();
    yield sim.actors.map((h, i) => ({ t: sim.t, h, input: sim.lastInputs[i], props }));
  }
}
