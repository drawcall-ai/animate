import { expect } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { knownFailure, run } from '../scripts/run';
import { SKELETONS, skeletonModel } from '../src/skeletons';
import { cases } from '../../packages/animate/test/open';

// Every scenario with people, on skeletons unlike the default body: the library measures the body it is given, so each must
// finish its story with the dev log as empty as the default body's. The cases that do not yet are listed in `OPEN` (expected to
// fail: each one fixed comes off the list).
const test = cases([
  'shooter on the soldier: final-pose dev checks',
  'stable-morning on the soldier: final-pose dev checks',
  'pickup-shelf on the soldier: final-pose dev checks',
  'reach on the soldier: final-pose dev checks',
  'knight-arming on the soldier: final-pose dev checks',
  'lift-heavy on the soldier: final-pose dev checks',
  'shooter on the outlier: final-pose dev checks',
  // (on Node 24 only: the knife edge another way on 22)
  // (the core legs, the people's only legs since 2026-10-23: the outlier's planted foot slides 1–1.5 mm a frame as it turns on it
  // (stroll, look-around) and its arm grazes its long trunk)
  'stroll on the outlier: final-pose dev checks',
  ['look-around on the outlier: final-pose dev checks', [0, 2, 3]],
  // (its life seed varied: the outlier's dev log has 1–2 problems in the stable story, and once in the knight's)
  ['stable-morning on the outlier: final-pose dev checks', [1, 2, 3]],
  ['knight-arming on the outlier: final-pose dev checks', [3]],
]);

for (const [name, { joints, height }] of Object.entries(SKELETONS)) {
  for (const sc of SCENARIOS.filter((sc) => sc.actors.length)) {
    const title = `${sc.id} on the ${name}: final-pose dev checks`;
    test(title, () => {
      const log = run(sc, () => skeletonModel(joints, height));
      expect(log.filter((entry) => !knownFailure(entry)).map((e) => `${e.check} ${e.where} @${e.time.toFixed(2)}`).slice(0, 5)).toEqual([]);
    });
  }
}
