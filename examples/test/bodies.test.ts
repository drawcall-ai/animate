import { expect, it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { knownFailure, run } from '../scripts/run';
import { SKELETONS, skeletonModel } from '../src/skeletons';

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
  // (on Node 24 only: the knife edge another way on 22)
  ...process.versions.node.startsWith('22.') ? [] : ['knight-arming on the outlier: final-pose dev checks'],
  // (the core legs, the people's only legs since 2026-10-23: the outlier's planted foot slides 1–1.5 mm a frame as it turns on it
  // (stroll, look-around) and its arm grazes its long trunk; the soldier's short arm reaches round its trunk through it)
  'stroll on the outlier: final-pose dev checks',
  'look-around on the outlier: final-pose dev checks',
  'reach-around on the soldier: final-pose dev checks',
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
