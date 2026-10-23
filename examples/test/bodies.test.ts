import { expect, it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { knownFailure, run } from '../scripts/run';
import { SKELETONS, skeletonModel } from './skeletons';

// Every scenario with people, on skeletons unlike the default body: the library measures the body it is given, so each must
// finish its story with the dev log as empty as the default body's. The cases that do not yet are listed in `OPEN` (expected to
// fail: each one fixed comes off the list).
const OPEN = new Set<string>([
  'shooter on the soldier: final-pose dev checks',
  'stable-morning on the soldier: final-pose dev checks',
  'pickup-shelf on the soldier: final-pose dev checks',
  'reach on the soldier: final-pose dev checks',
  'knight-arming on the soldier: final-pose dev checks',
  'lift-heavy on the soldier: final-pose dev checks',
  'shooter on the outlier: final-pose dev checks',
  'vr on the outlier: final-pose dev checks',
  'knight-arming on the outlier: final-pose dev checks',
  // (setting off with the saddle at 8.25 s its XCoM runs 0.10–0.11 m outside support against 0.10: on the edge, passing or failing
  // with any small change to the walk)
  'stable-morning on the outlier: final-pose dev checks',
]);

for (const [name, { joints, height }] of Object.entries(SKELETONS)) {
  for (const sc of SCENARIOS.filter((sc) => sc.actors.length)) {
    const title = `${sc.id} on the ${name}: final-pose dev checks`;
    (OPEN.has(title) ? it.fails : it)(title, () => {
      const log = run(sc, () => skeletonModel(joints, height));
      expect(log.filter((entry) => !knownFailure(entry)).map((e) => `${e.check} ${e.where} @${e.time.toFixed(2)}`).slice(0, 5)).toEqual([]);
    });
  }
}
