import { run } from './dev-log';
import { expect } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { knownFailure } from '../scripts/run';
import { OUTLIER, SOLDIER } from '../src/skeletons';
import { cases } from '../../packages/animate/test/open';

// Alternate body proportions, with current failures listed by scenario and seed.
const test = cases([
  'shooter on the soldier: final-pose dev checks',
  'pickup-shelf on the soldier: final-pose dev checks',
  ["vr on the soldier: final-pose dev checks", [1]],
  'reach on the soldier: final-pose dev checks',
  'lift-heavy on the soldier: final-pose dev checks',
  'shooter on the outlier: final-pose dev checks',
  'stable-morning on the outlier: final-pose dev checks',
  'stroll on the outlier: final-pose dev checks',
  ["look-around on the outlier: final-pose dev checks", [0, 1, 2]],
  ["vr on the outlier: final-pose dev checks", [0]],
  'knight-arming on the outlier: final-pose dev checks',
  'lift-heavy on the outlier: final-pose dev checks',
]);

/** the scenarios with no people in them */
const CREATURES_ONLY = ['legs-horse', 'dog-fetch', 'lion-run'];

for (const [name, skeleton] of [['soldier', SOLDIER], ['outlier', OUTLIER]] as const) {
  for (const scenario of SCENARIOS.filter((each) => !CREATURES_ONLY.includes(each.id))) {
    test(`${scenario.id} on the ${name}: final-pose dev checks`, () => {
      const log = run(scenario, { skeleton });
      expect(log.filter((entry) => !knownFailure(entry)).map((e) => `${e.check} ${e.where} @${e.time.toFixed(2)}`).slice(0, 5)).toEqual([]);
    });
  }
}
