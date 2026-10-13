import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { action } from '@pmndrs/timeline';
import { beyond, solveChain, type Frame } from '../../src';
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
  it('stands where it is put, relaxed, the soles on the floor and the feet planted at the ankles, still', () => {
    const h = new Humanoid(createSkeletonModel(), () => every(() => {}), { position: { x: 1, z: 2 }, yaw: 0.5 });
    for (let i = 0; i < 10; i++) h.update(1 / 60);
    expect(h.yaw).toBeCloseTo(0.5, 9);
    expect(h.velocity.length()).toBe(0);
    h.model.scene.updateMatrixWorld(true);
    for (const [s, side] of (['left', 'right'] as const).entries()) {
      expect(h.feet[s].phase).toBe('planted');
      expect(h.feet[s].position.distanceTo(at(h, `${side}Foot`)), side).toBeLessThan(1e-6);
      expect(at(h, `${side}Foot`).y).toBeCloseTo(h.proportions.ankleHeight, 9);
    }
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
});
