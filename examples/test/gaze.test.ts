import { Quaternion, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { runTimeline } from '@pmndrs/timeline';
import { Body, humanoid, lookAt } from '@drawcall/animate';
import { OUTLIER, PERSON, SOLDIER } from '../src/skeletons';
import { FIXED_DT } from '../src/scenario';
import { headShift, SHIFT_BOUNDS } from './gaze';

// A person's gaze shift from up on its left to down on its right, as people shift gaze: one movement, the head's speed a single bell
// within its main sequence, never turning back, and upright on the way (`SHIFT_BOUNDS`) — on the default body and skeletons unlike it.
const SKELETONS = { 'the default person': PERSON, 'the soldier': SOLDIER, 'the outlier': OUTLIER };
const SHIFT_AT = 2;

for (const [name, skeleton] of Object.entries(SKELETONS)) it(`shifts its gaze across and down in one upright movement, ${name}`, () => {
  const person = new Body(humanoid(skeleton), { dev: true });
  /** a point `distance` m from the eyes, `yaw` round to the left and `pitch` down (rad) */
  const fromEyes = (yaw: number, pitch: number, distance: number) => () =>
    person.species.gaze!.eyes(person.pose, new Vector3()).add(new Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(distance));
  const updateStory = runTimeline(function* () {
    yield* lookAt(person, fromEyes(0.8, -0.2, 3), { until: SHIFT_AT });
    yield* lookAt(person, fromEyes(-0.9, 0.6, 1.2), { until: Infinity });
  });
  const head = person.pose.skeleton.index('head');
  const heads: Quaternion[] = [];
  for (let time = 0; time < SHIFT_AT + 1.5; time += FIXED_DT) {
    updateStory(undefined, FIXED_DT);
    person.update(FIXED_DT);
    if (time >= SHIFT_AT - FIXED_DT) heads.push(person.pose.rotation(head).clone());
  }
  const shift = headShift(heads, FIXED_DT);
  expect(shift.amplitude).toBeGreaterThan(80);
  expect(shift.peak).toBeLessThan(SHIFT_BOUNDS.peak(shift.amplitude));
  expect(shift.valley).toBeLessThan(SHIFT_BOUNDS.valley);
  expect(shift.swing).toBeLessThan(SHIFT_BOUNDS.swing);
  expect(shift.roll).toBeLessThan(SHIFT_BOUNDS.roll);
  expect(person.log).toEqual([]);
});
