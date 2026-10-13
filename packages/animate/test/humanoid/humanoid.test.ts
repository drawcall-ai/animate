import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { action } from '@pmndrs/timeline';
import { beyond, clampRotation, Pose, solveChain, type Frame } from '../../src';
import { CHAINS } from '../../src/humanoid/skeleton';
import { Rig } from '../../src/humanoid/rig';
import { relaxedPose } from '../../src/humanoid/profile/relaxed';
import { rng, turnUpTo } from './fixtures';
import { INDEX } from '../../src/humanoid/bones';
import { Humanoid } from '../../src/humanoid/humanoid';
import { createSkeletonModel } from '../../src/humanoid/model';

/** a behaviour writing `write` every sub-step, forever */
const every = (write: (f: Frame) => void) =>
  function* () {
    yield* action<Frame>({ update: (f) => void write(f) });
  };

const at = (h: Humanoid, name: string) => h.model.scene.getObjectByName(name)?.getWorldPosition(new Vector3()) ?? new Vector3(NaN);

describe('Humanoid', () => {
  it('stands where it is put, relaxed, the soles on the floor, still', () => {
    const h = new Humanoid(createSkeletonModel(), () => every(() => {}), { position: { x: 1, z: 2 }, yaw: 0.5 });
    for (let i = 0; i < 10; i++) h.update(1 / 60);
    expect(h.yaw).toBeCloseTo(0.5, 9);
    expect(h.velocity.length()).toBe(0);
    h.model.scene.updateMatrixWorld(true);
    for (const side of ['left', 'right']) expect(at(h, `${side}Foot`).y).toBeCloseTo(h.proportions.ankleHeight, 9);
    expect(at(h, 'hips').distanceTo(new Vector3(1, h.proportions.hips.y, 2))).toBeLessThan(0.02);
    // the arms hang
    for (const side of ['left', 'right']) expect(at(h, `${side}UpperArm`).y - at(h, `${side}Hand`).y).toBeGreaterThan(0.95 * h.proportions.armLength);
    expect(h.snapshot().position(INDEX.head).distanceTo(at(h, 'head'))).toBeLessThan(1e-6);
  });

  it('solves its named chains within its ranges of motion: a wrist onto a point in reach', () => {
    const target = new Vector3(-0.25, 1.2, 0.3);
    const h = new Humanoid(createSkeletonModel(), () => every((f) => solveChain(f, 'rightArm', { tip: { position: target }, pole: new Vector3(-0.6, 0.8, -0.3) })));
    h.update(1 / 60);
    h.model.scene.updateMatrixWorld(true);
    expect(at(h, 'rightHand').distanceTo(target)).toBeLessThan(1e-6);
    for (const bone of [INDEX.rightUpperArm, INDEX.rightLowerArm]) {
      const limit = h.rig.skeleton.limits[bone];
      if (!limit) throw new Error('no limit');
      expect(beyond(h.pose.local(bone), limit)).toBeLessThan(1e-9);
    }
  });

  it('solves a limb onto any pose within its ranges (bent 10° or more), its tip turned as that pose turns it', () => {
    const skeleton = new Rig(createSkeletonModel()).skeleton;
    const relaxed = new Pose(skeleton);
    for (const { bone, rotation } of relaxedPose()) relaxed.setLocal(bone, rotation);
    const rand = rng(3);
    for (const chain of ['leftArm', 'rightLeg'] as const) {
      const [first, middle, tip] = CHAINS[chain].map((b) => skeleton.index(b));
      const hinge = skeleton.limits[middle];
      if (!hinge) throw new Error('no limit');
      // (the elbow and the knee: a hinge about the axis of their widest swing, and their twist)
      const wider = hinge.swing[0][1] - hinge.swing[0][0] >= hinge.swing[1][1] - hinge.swing[1][0] ? 0 : 1;
      const axis = new Vector3().setComponent((hinge.axis + 1 + wider) % 3, 1);
      const [lo, hi] = hinge.swing[wider];
      for (let n = 0; n < 300; n++) {
        const truth = new Pose(skeleton).copy(relaxed);
        for (const b of [first, tip]) {
          const limit = skeleton.limits[b];
          if (!limit) throw new Error('no limit');
          const q = turnUpTo(rand, Math.PI);
          clampRotation(q, limit);
          truth.setLocal(b, q);
        }
        let bend = 0;
        while (Math.abs(bend) < 10 * (Math.PI / 180)) bend = lo + (hi - lo) * rand();
        const twist = hinge.twist[0] + (hinge.twist[1] - hinge.twist[0]) * rand();
        const along = new Vector3().setComponent(hinge.axis, 1);
        truth.setLocal(middle, new Quaternion().setFromAxisAngle(axis, bend).multiply(new Quaternion().setFromAxisAngle(along, twist)));
        const pose = new Pose(skeleton).copy(relaxed);
        solveChain({ current: pose }, chain, { tip: { position: truth.position(tip).clone(), quaternion: truth.rotation(tip).clone() }, pole: truth.position(middle).clone() });
        expect(pose.position(tip).distanceTo(truth.position(tip)), chain).toBeLessThan(1e-6);
        expect(pose.rotation(tip).angleTo(truth.rotation(tip)), chain).toBeLessThan(Math.PI / 180);
      }
    }
  });
});
