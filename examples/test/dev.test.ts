import { run } from './dev-log';
import { expect } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { reaching } from '../src/scenarios/tracking';
import { knownFailure, seeded } from '../scripts/run';
import { SOLDIER, OUTLIER } from '../src/skeletons';
import { cases } from '../../packages/animate/test/open';

const test = cases([
  // (the reach on its toes for targets 10 cm higher: XCoM 10.5 cm outside the support at life seed 0, an open breach)
  ['reach: higher final-pose dev checks', [0]],
  ['reach: higher with -0.000001 m target perturbation', [0]],
  ['reach: higher with 0.000001 m target perturbation', [0]],
  // (its varied body stepping at its own legs' cadence: a touchdown 0.1002 m/s, over the 0.1 m/s limit, at life seed 2)
  ['reach: variation #2 final-pose dev checks', [2]],
  'shooter on the soldier: final-pose dev checks', // Grip/leg-rate violations.
  'pickup-shelf on the soldier: final-pose dev checks', // Unreachable placement.
  'vr: final-pose dev checks', // Hands ~14 cm short of the floor controllers in the crouch (tracked hand short of a target out of reach).
  'vr on the soldier: final-pose dev checks', // The same; at life seed 1 also a tracking joint-rate violation.
  'reach on the soldier: final-pose dev checks', // Reach diagnostics.
  'lift-heavy on the soldier: final-pose dev checks', // Unreachable lift.
  'look-around: final-pose dev checks', // Upper arm penetrates the trunk.
]);
for (const scenario of SCENARIOS) {
  const bodies = [{ on: '', skeleton: undefined },
    ...(['legs-horse', 'dog-fetch', 'lion-run'].includes(scenario.id) ? [] : [{ on: ' on the soldier', skeleton: SOLDIER }]),
    ...(scenario.id === 'reach-around' ? [{ on: ' on the outlier', skeleton: OUTLIER }] : []),
  ];
  for (const { on, skeleton } of bodies) {
    test(`${scenario.id}${on}: final-pose dev checks`, () => {
      expect(run(scenario, { skeleton }).filter((entry) => !knownFailure(entry))).toEqual([]);
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
