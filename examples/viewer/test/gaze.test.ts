import { Euler, Quaternion, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { runTimeline } from '@pmndrs/timeline';
import { Body, humanoid, lookAt } from '@drawcall/animate';
import { OUTLIER, PERSON, SOLDIER } from '../src/skeletons/index';
import { FIXED_DT } from '../src/scenario';
import { headShift, SHIFT_BOUNDS } from './gaze';
import { poseOf } from '@drawcall/animate';

// A person's gaze shift from up on its left to down on its right, as people shift gaze: one movement, the head's speed a single bell
// within its main sequence, never turning back, and upright on the way (`SHIFT_BOUNDS`) — on the default body and skeletons unlike it.
const SKELETONS = { 'the default person': PERSON, 'the soldier': SOLDIER, 'the outlier': OUTLIER };
const SHIFT_AT = 2;

for (const [name, skeleton] of Object.entries(SKELETONS)) it(`shifts its gaze across and down in one upright movement, ${name}`, () => {
  const person = new Body(humanoid(skeleton), { dev: true });
  /** a point `distance` m from the eyes, `yaw` round to the left and `pitch` down (rad) */
  const fromEyes = (yaw: number, pitch: number, distance: number) => () =>
    person.species.gaze!.eyes(poseOf(person), new Vector3()).add(new Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(distance));
  const updateStory = runTimeline(function* () {
    yield* lookAt(person, fromEyes(0.8, -0.2, 3), { until: SHIFT_AT });
    yield* lookAt(person, fromEyes(-0.9, 0.6, 1.2), { until: Infinity });
  });
  const head = poseOf(person).skeleton.index('head');
  const heads: Quaternion[] = [];
  for (let time = 0; time < SHIFT_AT + 1.5; time += FIXED_DT) {
    updateStory(undefined, FIXED_DT);
    person.update(FIXED_DT);
    if (time >= SHIFT_AT - FIXED_DT) heads.push(poseOf(person).rotation(head).clone());
  }
  const shift = headShift(heads, FIXED_DT);
  expect(shift.amplitude).toBeGreaterThan(80);
  expect(shift.peak).toBeLessThan(SHIFT_BOUNDS.peak(shift.amplitude));
  expect(shift.valley).toBeLessThan(SHIFT_BOUNDS.valley);
  expect(shift.swing).toBeLessThan(SHIFT_BOUNDS.swing);
  expect(shift.roll).toBeLessThan(SHIFT_BOUNDS.roll);
  expect(person.log).toEqual([]);
});

// The eyes take a body's travel under a steady look at first (the head keeps still as the trunk moves), then re-centre: a look begun
// as a bow straightens ends with the head on the line of sight, as one begun standing does — not held up by the eyes' absorbed share.
it('re-centres its eyes on a near look begun as a bow straightens', () => {
  /** the head's pitch above the line of sight to a point 0.6 m ahead, 5 cm over the eyes, held 3 s (°), after a bow or not */
  const headAboveLine = (bowFirst: boolean) => {
    const person = new Body(humanoid(PERSON), { dev: true }), gaze = person.species.gaze!;
    const face = new Vector3(0, gaze.eyes(poseOf(person), new Vector3()).y + 0.05, 0.6);
    const updateStory = runTimeline(function* () {
      if (bowFirst) yield* lookAt(person, new Vector3(0, 1.12, 0.6), { trunk: 0.65, until: 2 });
      yield* lookAt(person, face, { until: Infinity });
    });
    for (let time = 0; time < (bowFirst ? 2 : 0) + 3; time += FIXED_DT) {
      updateStory(undefined, FIXED_DT);
      person.update(FIXED_DT);
    }
    const ahead = new Vector3(0, 0, 1).applyQuaternion(poseOf(person).rotation(poseOf(person).skeleton.index('head')));
    const line = face.clone().sub(gaze.eyes(poseOf(person), new Vector3()));
    expect(person.log).toEqual([]);
    return (Math.atan2(ahead.y, Math.hypot(ahead.x, ahead.z)) - Math.atan2(line.y, Math.hypot(line.x, line.z))) * 180 / Math.PI;
  };
  expect(Math.abs(headAboveLine(true) - headAboveLine(false))).toBeLessThan(2);
});

// The measure itself: a head turned 20° one way and straight back is turning back; one whose shift trails off at a tenth of its peak,
// its yaw going 0.6° over and 0.4° back as its pitch rises 0.1° a step (as the soldier's did untying the knot), is not.
it('reads a turn back as a swing past its bound, and a trailing shift\'s wiggle as none', () => {
  const dt = 1 / 60, degree = Math.PI / 180, head = (yaw: number, pitch = 0) => new Quaternion().setFromEuler(new Euler(pitch * degree, yaw * degree, 0, 'YXZ'));
  // (out at 200°/s for 0.1 s, then back as fast)
  const back = Array.from({ length: 13 }, (_, k) => head((k <= 6 ? k : 12 - k) * 200 * dt));
  expect(headShift(back, dt).swing).toBeGreaterThan(SHIFT_BOUNDS.swing);
  // (four fifths of a minimum-jerk shift of 20° in 0.3 s, its peak 124°/s, then four steps at 13–19°/s)
  const eased = (s: number) => 20 * (10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5);
  const shift = Array.from({ length: 15 }, (_, k) => head(eased(k / 18)));
  const tail = [0.3, 0.6, 0.4, 0.2].map((over, k) => head(eased(14 / 18) + over, 0.1 * (k + 1)));
  expect(headShift([...shift, ...tail], dt).swing).toBeLessThan(SHIFT_BOUNDS.swing);
});
