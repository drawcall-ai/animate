import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { BONES, REST_HINGE, perBone } from '../src/pose/bones';
import { createRotations, fromFrames, hingeFrame } from '../src/pose/rotations';
import { forward, rng, samplePose, sampleRest } from './fixtures';

const rest = sampleRest();
/** T-pose directions of the upper arm and thigh */
const ARM = new Vector3(1, 0, 0);
const LEG = new Vector3(0, -1, 0);

describe('hingeFrame', () => {
  it('is identity at rest and maps rest dir/hinge onto the given ones', () => {
    const q = hingeFrame(ARM, REST_HINGE.leftUpperArm, ARM, REST_HINGE.leftUpperArm, new Quaternion());
    expect(q.angleTo(new Quaternion())).toBeLessThan(1e-9);
    const dir = new Vector3(0.2, -1, 0.3).normalize();
    const hinge = new Vector3(1, 0, 0).addScaledVector(dir, -dir.x).normalize();
    hingeFrame(dir, hinge, LEG, REST_HINGE.leftUpperLeg, q);
    expect(LEG.clone().applyQuaternion(q).distanceTo(dir)).toBeLessThan(1e-12);
    expect(REST_HINGE.leftUpperLeg.clone().applyQuaternion(q).distanceTo(hinge)).toBeLessThan(1e-12);
  });
});

describe('frames → local rotations → FK', () => {
  for (const withHands of [false, true]) {
    it(`reproduces the solver joints (hand rotations: ${withHands})`, () => {
      const rand = rng(withHands ? 7 : 3);
      const local = createRotations();
      const world = createRotations();
      const fk = perBone(() => new Vector3());
      let worst = 0;
      for (let i = 0; i < 500; i++) {
        const { frames, joints } = samplePose(rand, rest, withHands);
        fromFrames(frames, rest, world, local);
        forward(local, rest, joints.hips, fk);
        for (const b of BONES) worst = Math.max(worst, fk[b].distanceTo(joints[b]));
        // world rotations survive the round trip (the forearm twist split changes only the lower arm)
        const hand = local.hips.clone();
        for (const b of ['spine', 'chest', 'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand'] as const) hand.multiply(local[b]);
        expect(hand.angleTo(world.leftHand)).toBeLessThan(1e-6);
        const target = frames.sides[0].hand;
        if (target?.weight === 1) expect(world.leftHand.angleTo(target.quaternion)).toBeLessThan(1e-6);
        // elbows and knees are pure hinges that only flex
        if (!withHands)
          for (const b of ['leftLowerArm', 'rightLowerArm', 'leftLowerLeg', 'rightLowerLeg'] as const) {
            const v = new Vector3(local[b].x, local[b].y, local[b].z);
            expect(v.clone().cross(REST_HINGE[b]).length()).toBeLessThan(1e-9);
            expect(v.dot(REST_HINGE[b]) * Math.sign(local[b].w)).toBeLessThanOrEqual(1e-12);
          }
        const foot = local.hips.clone().multiply(local.rightUpperLeg).multiply(local.rightLowerLeg).multiply(local.rightFoot);
        expect(foot.angleTo(frames.sides[1].foot)).toBeLessThan(1e-6);
      }
      expect(worst).toBeLessThan(1e-6);
    });
  }
});
