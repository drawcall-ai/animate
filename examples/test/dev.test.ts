import { expect } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { reaching } from '../src/scenarios/tracking';
import { knownFailure, run, seeded } from '../scripts/run';
import { cases } from '../../packages/animate/test/open';

// Every scenario's run with development checks on: its dev log empty and its story finished; and a few of them varied (each person
// up to 10 cm off, turned up to 0.15 rad, up to 4 % taller or shorter), which no story may hang on. Open cases are expected to fail:
// each one fixed comes off the list.
// - look-around: the left upper arm 1.05 cm into the trunk (limit 1) at 15.0 s, turning back from behind;
// - reach higher (seeds 0, 3) and faster (seed 0): the anticipatory walk's braking leaves final-pose XCoM 10.2–11.2 cm outside
//   support at 12.9 / 8.1 s (limit 10 cm), though the hand stays on its course;
// At other seeds: stable-morning's right forearm 2.4–3.6 cm into the trunk reaching for the knot at 12.6 s (seed 3).
const test = cases([['reach: higher final-pose dev checks', [0, 3]], ['reach: faster final-pose dev checks', [0]],
  'look-around: final-pose dev checks', ['stable-morning: final-pose dev checks', [3]]]);
for (const scenario of SCENARIOS) {
  test(`${scenario.id}: final-pose dev checks${scenario.id === 'vr' ? ' (its side-step unfinished, known)' : ''}`, () => {
    expect(run(scenario).filter((entry) => !knownFailure(entry))).toEqual([]);
  });
}

for (const scenario of SCENARIOS.filter((each) => ['reach', 'knight-arming', 'pickup-shelf'].includes(each.id))) {
  for (const seed of [1, 2, 3, 4]) {
    test(`${scenario.id}: variation #${seed} final-pose dev checks`, () => expect(run(scenario, { vary: seeded(seed) })).toEqual([]));
  }
}

for (const [name, variation] of [['higher', { rise: 0.1 }], ['faster', { pace: 1.2 }]] as const) {
  test(`reach: ${name} final-pose dev checks`, () => expect(run(reaching(variation))).toEqual([]));
}
