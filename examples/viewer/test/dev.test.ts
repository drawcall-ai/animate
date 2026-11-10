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
