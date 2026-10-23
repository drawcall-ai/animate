import { Quaternion, Vector3 } from 'three';
import { expect, it } from 'vitest';
import type { CharacterModel } from '@pmndrs/viverse';
import { parallel, timePassed } from '@pmndrs/timeline';
import { when, withGaze, type Frame } from '@drawcall/animate';
import { idle } from '@drawcall/animate/rig';
import { createOpenPoseModel } from '../src/openpose';
import { SKELETONS, skeletonModel } from '../src/skeletons';
import { person } from './person';
import { headShift, SHIFT_BOUNDS } from './gaze';

// A person's gaze shift from up on its left to down on its right, as people shift gaze: one movement, the head's speed a single bell
// within its main sequence, never turning back, and upright on the way (`SHIFT_BOUNDS`) — on the default body and skeletons unlike it.
const BODIES: [string, () => CharacterModel][] = [['the default body', () => createOpenPoseModel()],
  ...Object.entries(SKELETONS).map(([name, { joints, height }]): [string, () => CharacterModel] => [`the ${name}`, () => skeletonModel(joints, height)])];
const SHIFT_AT = 2;

for (const [name, model] of BODIES) it(`shifts its gaze across and down in one upright movement, ${name}`, () => {
  const at = (yaw: number, pitch: number, distance: number) => (f: Frame) => {
    const eyes = h.gazer.eyes(f.prev, new Vector3());
    return eyes.add(new Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(distance));
  };
  const h = person(model(), (h) => () => parallel<Frame>('all', idle(h), function* () {
    yield* withGaze(h, at(0.8, -0.2, 3), () => when(timePassed(SHIFT_AT, 'seconds')))();
    yield* withGaze(h, at(-0.9, 0.6, 1.2), () => when(() => false))();
  }), { idle: false, dev: true });
  const head = h.pose.skeleton.index('head');
  const heads: Quaternion[] = [];
  for (let t = 0; t < SHIFT_AT + 1.5; t += 1 / 60) {
    h.update(1 / 60);
    if (t >= SHIFT_AT - 1 / 60) heads.push(h.pose.rotation(head).clone());
  }
  const shift = headShift(heads, 1 / 60);
  expect(shift.amplitude).toBeGreaterThan(80);
  expect(shift.peak).toBeLessThan(SHIFT_BOUNDS.peak(shift.amplitude));
  expect(shift.valley).toBeLessThan(SHIFT_BOUNDS.valley);
  expect(shift.swing).toBeLessThan(SHIFT_BOUNDS.swing);
  expect(shift.roll).toBeLessThan(SHIFT_BOUNDS.roll);
  expect(h.log).toEqual([]);
});
