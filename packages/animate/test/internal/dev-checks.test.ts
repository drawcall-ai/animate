import { Quaternion, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { selfOf } from '../../src/body';
import { BonePose } from '../../src/kernel/bone-pose';
import { INDEX, dt, person, run } from '../kit/bodies';
import { personSelf, claim } from './self';
import { poseOf } from '../../src/index';

it('checks a planted foot in the final pose after a later writer moved it, naming the requests running', () => {
  const body = person({ dev: true });
  claim(body, 'trunk', (f) => f.current.setRoot(f.current.position(0).clone().add(new Vector3(0.04, 0, 0))));
  body.update(dt);
  expect(body.log).toEqual([]);
  body.update(dt);
  // (caught and blamed on the request running, matched by what it measures — a planted foot's slide, here 4 cm — not by the check's
  // exact name or limit, which are the legs' own)
  expect(body.log).toContainEqual(expect.objectContaining({ check: expect.stringMatching(/planted .*slide/), where: 'leftFoot', beat: 'test', worst: expect.closeTo(0.04, 3) }));
});

it('catches a later joint writer and a snap from final rotations', () => {
  const body = person({ dev: true });
  claim(body, 'look', (f) => f.current.setLocal(INDEX.head, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), f.time > dt ? 2 : 0)));
  run(body, 3 * dt);
  expect(body.log).toContainEqual(expect.objectContaining({ check: 'joint range (°)', where: 'head', beat: 'test' }));
  expect(body.log).toContainEqual(expect.objectContaining({ check: 'joint acceleration (°/s²)', where: 'head', beat: 'test' }));
});

it('checks sustained joint speed even when acceleration is below its ceiling', () => {
  const body = person({ dev: true });
  claim(body, 'look', (f) => f.current.setLocal(INDEX.head, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 15 * f.time)));
  run(body, 4 * dt);
  expect(body.log).toContainEqual(expect.objectContaining({ check: 'joint speed (°/s)', limit: 700 }));
  // (the first sub-step's jump aside)
  expect(body.log.some((entry) => entry.check === 'joint acceleration (°/s²)' && entry.where === 'head' && entry.time > dt)).toBe(false);
});

it('checks standing CoM against the soles once the final pose is still', () => {
  const body = person({ dev: true }), h = personSelf(body);
  const pose = new BonePose(h.skeleton).copy(poseOf(body));
  // (the hips' segment's mass shifted 3 m aside, the standing pose and its soles as they were)
  h.skeleton.bones[INDEX.hips].com.x = 3;
  claim(body, 'trunk', (f) => {
    f.current.copy(pose);
    h.locomotion.settled = true;
    for (const leg of h.stepper?.legs ?? []) leg.swing = null;
  });
  run(body, 3 * dt);
  expect(body.log).toContainEqual(expect.objectContaining({ check: 'standing CoM outside the feet (m)', limit: 0.001 }));
});

it('clears the development beat once nothing runs', () => {
  const body = person({ dev: true }), drop = claim(body, 'trunk', () => {});
  body.update(dt);
  expect(selfOf(body).frame.dev?.beat).toBe('test');
  drop();
  body.update(dt);
  expect(selfOf(body).frame.dev?.beat).toBeUndefined();
});


