import { expect } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { knownFailure, run } from '../scripts/run';
import { OUTLIER, SOLDIER } from '../src/skeletons';
import { cases } from '../../packages/animate/test/open';

// Every scenario with people, on skeletons unlike the default body: the library measures the body it is given, so each must
// finish its story with the dev log as empty as the default body's. The cases that do not yet are listed (expected to fail: each one
// fixed comes off the list).
const test = cases([]);

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
