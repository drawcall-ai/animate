import { expect } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { knownFailure, run } from '../scripts/run';
import { OUTLIER, SOLDIER } from '../src/skeletons';
import { cases } from '../../packages/animate/test/open';

// Every scenario with people, on skeletons unlike the default body: the library measures the body it is given, so each must
// finish its story with the dev log as empty as the default body's. The cases that do not yet are listed (expected to fail: each one
// fixed comes off the list).
// - shooter: the soldier's knees at 90 000 °/s² (limit 83 300) sprinting from 19.5 s and landing at 45.0 s, and both bodies' left hand
//   0.29–0.43 m off the foregrip after the reload (as on the default body); the outlier's touchdown at 0.48 m/s at 36.6 s;
// - stable-morning: the soldier's saddle 4.9 cm off its carry's end at 7.35 s, the outlier's 5.1 cm at 11.8 s and its right hand 2.1 cm
//   into the trunk at 2.2 s; neither finishes;
// - pickup-shelf: the soldier's left forearm 10.8 cm into the trunk at 3.3 s, its hands 9–10 cm short of the box at 6.65 s, its feet
//   sliding up to 1.45 cm a frame while planted; unfinished. The outlier's hip rate drops from 2810–3058 to 573–574 °/s (seeds 0, 3); its
//   released right forearm still enters the trunk by 1.4 cm (seed 3).
// - reach: the soldier's first target 0.45 m over its shoulders on tiptoe (limit 0.44), and its floor target 0.47–0.48 m below its
//   shoulders lowered and bowed (limit 0.44) at 6.4–8.1 s, its planted feet sliding up to 2 cm a frame as its hand follows that point
//   down (6.5–8.4 s), and a leg at 271 000 °/s² at 14.4 s;
// - vr: the side-step's end with the XCoM over 10 cm (the soldier, seeds 0–1, at 13.17–13.18 s for seed 0) and 19.9 cm
//   (the outlier, seed 0, at 12.8–12.9 s) outside support, the body leaning after the head and controllers 0.5 m out to its side on its
//   trailing foot (the known unfinished side-step: the body turns to walk rather than strafe);
// - knight-arming: the soldier's left leg at 5180 °/s and 449 000 °/s² from 1.15 s, its feet sliding 1.1 cm a frame, the belt's ends
//   put 4.1 and 5.6 cm off their places at 9.5 s; the outlier's hand 3.9 cm short of the buckle at 4.05 s and the helm's carry
//   7.9 mm off at 63 s, unfinished;
// - lift-heavy: the soldier's hands 11–12 cm short of the box at 4.05 s and its feet sliding up to 2.4 cm a frame, unfinished; the
//   outlier's hands 0.39 m short at 4.05 s;
// - stroll and look-around on the outlier: its planted right foot slides 5.2 mm a frame at 12.8 s; its left upper arm 1.06 cm into
//   the trunk at 15.5 s (at seed 1, its left upper arm enters the trunk at 14.95 s);
// - look-around on the soldier (seed 3): left-leg speed and acceleration and planted left-foot slide exceed their bounds at 8.45 s.
const test = cases([
  ...['shooter', 'stable-morning', 'knight-arming', 'lift-heavy'].flatMap((id) => [`${id} on the soldier: final-pose dev checks`, `${id} on the outlier: final-pose dev checks`]),
  'pickup-shelf on the soldier: final-pose dev checks', ['pickup-shelf on the outlier: final-pose dev checks', [3]],
  'reach on the soldier: final-pose dev checks', ['vr on the soldier: final-pose dev checks', [0, 1]], ['vr on the outlier: final-pose dev checks', [0]],
  'stroll on the outlier: final-pose dev checks', ['look-around on the outlier: final-pose dev checks', [0, 1, 2]],
  ['look-around on the soldier: final-pose dev checks', [3]],
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
