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

  /** random poses of `chain` within its ranges, the elbow or knee a hinge bent `bent(degrees)` and twisted: where the tip is and how it is turned, and where the middle joint is */
  function* limbPoses(chain: 'leftArm' | 'rightLeg', bent: (degrees: number) => boolean, n: number) {
    const skeleton = new Rig(createSkeletonModel()).skeleton;
    const relaxed = new Pose(skeleton);
    for (const { bone, rotation } of relaxedPose()) relaxed.setLocal(bone, rotation);
    const rand = rng(3);
    const [first, middle, tip] = CHAINS[chain].map((b) => skeleton.index(b));
    const limit = (b: number) => {
      const l = skeleton.limits[b];
      if (!l) throw new Error('no limit');
      return l;
    };
    // the elbow bends about y (its swing's first component), the knee about x (its second); both twist about their bone
    const [hinge, range, along] = chain === 'leftArm' ? [new Vector3(0, 1, 0), limit(middle).swing[0], new Vector3(1, 0, 0)] : [new Vector3(1, 0, 0), limit(middle).swing[1], new Vector3(0, 1, 0)];
    for (let k = 0; k < n; k++) {
      const truth = new Pose(skeleton).copy(relaxed);
      for (const b of [first, tip]) {
        const q = turnUpTo(rand, Math.PI);
        clampRotation(q, limit(b));
        truth.setLocal(b, q);
      }
      let bend = NaN;
      while (!(bend >= range[0] && bend <= range[1] && bent(Math.abs(bend) / (Math.PI / 180)))) bend = range[0] + (range[1] - range[0]) * rand();
      const [lo, hi] = limit(middle).twist;
      truth.setLocal(middle, new Quaternion().setFromAxisAngle(hinge, bend).multiply(new Quaternion().setFromAxisAngle(along, lo + (hi - lo) * rand())));
      yield { skeleton, relaxed, tip, goal: { position: truth.position(tip).clone(), quaternion: truth.rotation(tip).clone() }, middle: truth.position(middle).clone() };
    }
  }

  it('solves a limb onto any pose within its ranges (bent 10° or more), its tip turned as that pose turns it', () => {
    for (const chain of ['leftArm', 'rightLeg'] as const) {
      for (const { skeleton, relaxed, tip, goal, middle } of limbPoses(chain, (d) => d >= 10, 300)) {
        const pose = new Pose(skeleton).copy(relaxed);
        solveChain({ current: pose }, chain, { tip: goal, pole: middle });
        expect(pose.position(tip).distanceTo(goal.position), chain).toBeLessThan(1e-6);
        expect(pose.rotation(tip).angleTo(goal.quaternion), chain).toBeLessThan(Math.PI / 180);
      }
    }
  });

  it('turns the hand of an arm held out nearly straight as asked: with a pole, and nearly always without one', () => {
    const worst = { pole: 0, none: 0 };
    let missed = 0;
    for (const { skeleton, relaxed, tip, goal, middle } of limbPoses('leftArm', (d) => d < 10, 300)) {
      for (const pole of [middle, undefined]) {
        const pose = new Pose(skeleton).copy(relaxed);
        solveChain({ current: pose }, 'leftArm', { tip: goal, pole });
        expect(pose.position(tip).distanceTo(goal.position)).toBeLessThan(1e-3);
        const off = pose.rotation(tip).angleTo(goal.quaternion);
        const key = pole ? 'pole' : 'none';
        worst[key] = Math.max(worst[key], off);
        if (!pole && off > Math.PI / 180) missed++;
      }
    }
    expect(worst.pole).toBeLessThan(Math.PI / 180);
    // (without a pole the swivel is searched with the twist split by the joints' twist ranges: a few poses need another split)
    expect(missed).toBeLessThanOrEqual(6);
  });
});
