import { expect } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { knownFailure, run, seeded } from '../scripts/run';
import { cases } from '../../packages/animate/test/open';

// Every scenario's run with development checks on: its dev log empty and its story finished; and a few of them varied (each person
// up to 10 cm off, turned up to 0.15 rad, up to 4 % taller or shorter), which no story may hang on. Open cases are expected to fail:
// each one fixed comes off the list.
// - shooter: the right forearm and hand at 3700–4100 °/s (limit 2900–3000) and 230 000 °/s² carrying the magazines at 49.9 and 52.2 s,
//   and the left hand up to 0.49 m off the foregrip after the reload, 53.4–53.8 s (a hand's backing out retaking it: shooter.test);
// - look-around: the left upper arm 1.05 cm into the trunk (limit 1) at 15.0 s, turning back from behind;
// - knight-arming: the lance's carry 6.7 mm off its course's end (limit 5) at 55.6–55.9 s;
// - pickup-shelf varied #1, #3, #4: both forearms at 110 000–121 000 °/s² (limit 96 700) at 5.9–6.0 s, taking the box;
// - knight-arming varied #1–#4: the lance's late carry, the sword put 5.4–7.6 mm off the scabbard's mouth (#2, #4), the forearms at
//   107 000 °/s² and the right hand 3.2 cm into the trunk (#3).
// At other seeds: stable-morning's right forearm 2.4–3.6 cm into the trunk reaching for the knot at 12.6 s (seeds 1, 3); pickup-shelf
// varied #2, the forearms at 116 000 °/s² at 6.0 s (seeds 1–3); reach, its walk after the far target braking with the XCoM 11.1 cm
// outside the support at 13.7 s (seed 3), and varied #3 10.8 cm at 13.8 s (seed 2) and its right forearm 1.1–2.2 cm into the trunk
// at 15.3 s (seed 3).
const test = cases(['shooter: final-pose dev checks', 'look-around: final-pose dev checks', ['reach: final-pose dev checks', [3]],
  ['knight-arming: final-pose dev checks', [0, 1, 2]], ['reach: variation #3 final-pose dev checks', [2, 3]], ['pickup-shelf: variation #1 final-pose dev checks', [0, 1]],
  ['pickup-shelf: variation #2 final-pose dev checks', [1, 2, 3]], 'pickup-shelf: variation #3 final-pose dev checks',
  'pickup-shelf: variation #4 final-pose dev checks', ['knight-arming: variation #1 final-pose dev checks', [0, 2, 3]],
  ...[2, 3, 4].map((seed) => `knight-arming: variation #${seed} final-pose dev checks`), ['stable-morning: final-pose dev checks', [1, 3]]]);
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
