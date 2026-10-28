import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Pose } from '../../src/kernel/pose';
import { solveChain } from '../../src/kernel/chain';
import { beyond, clampRotation } from '../../src/kernel/limits';
import { CHAINS } from '../../src/species/humanoid/skeleton';
import { relaxedPose } from '../../src/species/humanoid/relaxed';
import { INDEX } from '../../src/species/humanoid/bones';
import { humanoid } from '../../src/index';
import { rng, turnUpTo } from '../random';
import { claim, dt, insides, person } from '../bodies';
import { PERSON } from '../../skills/animate/references/person';

/** where bone `name` of a body is in the scene, as its last update wrote it */
const at = (body: ReturnType<typeof person>, name: keyof typeof body.bones) => {
  body.object.updateMatrixWorld(true);
  return body.bones[name].getWorldPosition(new Vector3());
};

describe('a person', () => {
  it('stands where it is put, relaxed, the soles on the floor, still', () => {
    const body = person({ at: new Vector3(1, 0, 2), face: 0.5 }), h = insides(body), p = h.proportions;
    // (it settles its weight over its feet' rear half within its first half second, then stands, breathing)
    for (let i = 0; i < 60; i++) body.update(dt);
    expect(body.facing).toBeCloseTo(0.5, 9);
    expect(body.velocity.length()).toBeLessThan(0.005);
    for (const side of ['left', 'right'] as const) expect(at(body, `${side}Foot`).y).toBeCloseTo(p.ankleHeight, 3);
    expect(at(body, 'hips').distanceTo(new Vector3(1, p.hips.y, 2))).toBeLessThan(0.04);
    // the arms hang
    for (const side of ['left', 'right'] as const) expect(at(body, `${side}UpperArm`).y - at(body, `${side}Hand`).y).toBeGreaterThan(0.95 * p.armLength);
    expect(body.pose.position(INDEX.head).distanceTo(at(body, 'head'))).toBeLessThan(1e-6);
  });

  it('solves its named chains within its ranges of motion: a wrist onto a point in reach', () => {
    const target = new Vector3(-0.25, 1.2, 0.3), body = person();
    claim(body, 'hand.right', (f) => solveChain(f, 'rightArm', { tip: { position: target }, pole: new Vector3(-0.6, 0.8, -0.3) }));
    body.update(dt);
    expect(at(body, 'rightHand').distanceTo(target)).toBeLessThan(1e-6);
    for (const bone of [INDEX.rightUpperArm, INDEX.rightLowerArm]) {
      const limit = body.pose.skeleton.limits[bone];
      if (!limit) throw new Error('no limit');
      expect(beyond(body.pose.local(bone), limit)).toBeLessThan(1e-9);
    }
  });

  /** random poses of `chain` within its ranges, the elbow or knee a hinge bent `bent(degrees)` and twisted: where the tip is and how it is turned, and where the middle joint is */
  function* limbPoses(chain: 'leftArm' | 'rightLeg', bent: (degrees: number) => boolean, n: number) {
    const skeleton = humanoid(PERSON).skeleton;
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
