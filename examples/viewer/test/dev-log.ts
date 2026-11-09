import type { CastOptions, Scenario } from '../src/scenario';
import { run as runScene } from '../scripts/run';

export function run(scenario: Scenario, cast: CastOptions = {}) {
  return runScene(scenario, cast);
}
