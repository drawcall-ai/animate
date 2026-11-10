import { run } from '../scripts/run';
import { expect } from 'vitest';
import { SCENARIOS } from '../src/scenarios/index';
import { reaching } from '../src/scenarios/tracking';
import { seeded } from '../scripts/run';
import { SOLDIER, OUTLIER } from '../src/skeletons/index';
import { cases } from '../../../packages/animate/test/kit/open';

const test = cases([
  // A box on the floor misses: the 0.46 m arms stop 1.5–2.9 cm over its grips, the knees at 146° and the hips at 0.36 m, the trunk bowed no further; it expects the lift done.
  ['lift-heavy on the soldier: final-pose dev checks', /beyond the arm’s reach/],
  // XCoM 0.104–0.110 m for a moment walking at 1.56 m/s, bound 0.1 (at seed 2 too a touchdown at 0.11 m/s, bound 0.1): no speed-up clears it at every seed (at speed-ups of 1.2, 1.31, 1.45, 1.6, 1.73 m/s²: seed 2 over at 1.45, seed 0 at 1.6); a clean log is what it expects.
  ['reach: faster final-pose dev checks', /XCoM|touchdown/, [2]],
  // (#18) XCoM 0.110 m for one sub-step at 9.35 s, bound 0.103: the trailing knee held straight at full reach through pre-swing, the heel flat till
  // the reach runs out, peels and snaps the knee bent as the foot lifts — the centre of mass jolted with it.
  ['stable-morning on the soldier: final-pose dev checks', /XCoM outside support/, [3]],
  // (#18) XCoM 0.112 m for a sub-step at 13.97 s, bound 0.100: the same trailing knee held straight at full reach, snapping bent as it lifts.
  ['reach: variation #1 final-pose dev checks', /XCoM outside support/, [2]],
]);
for (const scenario of SCENARIOS) {
  const bodies = [{ on: '', skeleton: undefined },
    ...(['legs-horse', 'dog-fetch', 'lion-run'].includes(scenario.id) ? [] : [{ on: ' on the soldier', skeleton: SOLDIER }]),
    ...(scenario.id === 'reach-around' ? [{ on: ' on the outlier', skeleton: OUTLIER }] : []),
  ];
  for (const { on, skeleton } of bodies) {
    test(`${scenario.id}${on}: final-pose dev checks`, () => {
      expect(run(scenario, { skeleton })).toEqual([]);
    });
  }
}

for (const scenario of SCENARIOS.filter((each) => ['reach', 'knight-arming', 'pickup-shelf'].includes(each.id))) {
  for (const seed of [1, 2, 3, 4]) {
    test(`${scenario.id}: variation #${seed} final-pose dev checks`, () => expect(run(scenario, { vary: seeded(seed) })).toEqual([]));
  }
}

for (const [name, variation] of [['higher', { rise: 0.1 }], ['faster', { pace: 1.2 }]] as const) {
  test(`reach: ${name} final-pose dev checks`, () => expect(run(reaching(variation))).toEqual([]));
}

for (const offset of [-1e-6, 1e-6]) {
  test(`reach: higher with ${offset} m target perturbation`, () => expect(run(reaching({ rise: 0.1 + offset }))).toEqual([]));
}
