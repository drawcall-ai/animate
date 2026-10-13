import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { action, parallel } from '@pmndrs/timeline';
import type { Ctx } from '@prohuman/body';
import { createOpenPoseModel } from '@prohuman/openpose';
import { INDEX } from '../src/bones';
import { Humanoid } from '../src/humanoid';
import { relaxedPose } from '../src/profile/relaxed';
import { defaultStance, footYaw } from '../src/stance';
import { Hints } from '../src/hints';
import { look } from '../src/behaviours/look';
import { humanoid } from '../src/behaviours/humanoid';

/** a behaviour proposing `propose` every sub-step, forever */
const every = (propose: (ctx: Ctx) => void) =>
  function* () {
    yield* action<Ctx>({ update: (ctx) => void propose(ctx) });
  };

const at = (h: Humanoid, name: string) => h.model.scene.getObjectByName(name)?.getWorldPosition(new Vector3()) ?? new Vector3(NaN);

describe('Humanoid', () => {
  it('stands where it is put, relaxed, the feet planted at its ankles and turned out as the stance has them, still', () => {
    const h = new Humanoid(createOpenPoseModel(), () => every(() => {}), { position: { x: 1, z: 2 }, yaw: 0.5 });
    for (let i = 0; i < 10; i++) h.update(1 / 60);
    expect(h.yaw).toBeCloseTo(0.5, 9);
    expect(h.velocity.length()).toBeLessThan(1e-9);
    expect(h.seated).toBe(0);
    expect(h.mounted).toBe(false);
    h.model.scene.updateMatrixWorld(true);
    for (const [s, side] of (['left', 'right'] as const).entries()) {
      const foot = h.feet[s];
      expect(foot.phase).toBe('planted');
      expect(foot.yaw).toBeCloseTo(footYaw(0.5, s === 0 ? 1 : -1, defaultStance(h.proportions)), 9);
      expect(foot.position.distanceTo(at(h, `${side}Foot`)), side).toBeLessThan(1e-6);
    }
    expect(at(h, 'hips').distanceTo(new Vector3(1, h.proportions.hips.y, 2))).toBeLessThan(0.02);
    const snap = h.snapshot();
    expect(snap.positions[INDEX.head].distanceTo(at(h, 'head'))).toBeLessThan(1e-6);
  });

  it('poses the model as its body moves: the arms come down to the relaxed pose, the facing kept', () => {
    const relaxed = relaxedPose();
    const h = new Humanoid(
      createOpenPoseModel(),
      () =>
        every((ctx) => {
          for (const { bone, rotation } of relaxed) ctx.propose.target({ kind: 'local', point: { bone, at: new Vector3() }, value: rotation, weight: 1 });
        }),
      { yaw: -1 },
    );
    for (let i = 0; i < 120; i++) h.update(1 / 60);
    h.model.scene.updateMatrixWorld(true);
    expect(h.yaw).toBeCloseTo(-1, 6);
    // the wrists hang below the shoulders now
    for (const side of ['left', 'right']) expect(at(h, `${side}UpperArm`).y - at(h, `${side}Hand`).y).toBeGreaterThan(0.8 * h.proportions.armLength);
    expect(h.state.comVelocity.length()).toBeLessThan(0.05);
  });

  it('looks at a point: the head turns to it, the chest less', () => {
    const target = new Vector3(2, 1.5, 1);
    const h = new Humanoid(
      createOpenPoseModel(),
      (h) =>
        function* () {
          yield* parallel<Ctx>(
            'all',
            humanoid(h),
            look(h, () => target),
          );
        },
    );
    for (let i = 0; i < 120; i++) h.update(1 / 60);
    const yaw = (bone: number) => {
      const fwd = new Vector3(0, 0, 1).applyQuaternion(h.state.rotations[bone]);
      return Math.atan2(fwd.x, fwd.z);
    };
    const want = Math.atan2(target.x - h.state.positions[INDEX.head].x, target.z - h.state.positions[INDEX.head].z);
    expect(yaw(INDEX.head)).toBeCloseTo(want, 1);
    expect(yaw(INDEX.chest)).toBeLessThan(0.6 * yaw(INDEX.head));
    expect(h.velocity.length()).toBeLessThan(0.05);
    expect(h.status.intent.lookAt?.equals(target)).toBe(true);
  });
});

describe('Hints', () => {
  it('reads what was asked in the sub-step before, merged by kind, whatever the order', () => {
    const hints = new Hints();
    hints.crouch(1, 0.1);
    hints.facing(1, 0.3, 1);
    hints.armSwing(1, 0.5);
    hints.crouch(1, 0.2);
    hints.facing(1, -0.4, 2);
    hints.facing(1, 0.9, 2, 0.5);
    hints.armSwing(1, 0.8);
    expect(hints.read(1)).toEqual({ crouch: 0, facing: null, armSwing: 1 });
    expect(hints.read(2)).toEqual({ crouch: 0.2, facing: -0.4, armSwing: 0.5 });
    expect(hints.read(3)).toEqual({ crouch: 0, facing: null, armSwing: 1 });
    expect(() => hints.read(2)).toThrow(/after/);
  });
});
