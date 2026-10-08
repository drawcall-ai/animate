import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { BONES, perBone } from '../src/pose/bones';
import { beyondRange, limitRotations } from '../src/pose/limits';
import { createRotations } from '../src/pose/rotations';
import { rng } from './fixtures';

describe('limitRotations', () => {
  it('keeps every joint in its range, leaves the rest pose alone, eases in continuously', () => {
    const rand = rng(5);
    const q = createRotations();
    const all = perBone(() => 1);
    const moved = perBone(() => false);
    limitRotations(q, all, moved);
    for (const b of BONES) expect(q[b].angleTo(new Quaternion()), b).toBeLessThan(1e-9);
    for (let i = 0; i < 2000; i++) {
      for (const b of BONES) q[b].set(rand() - 0.5, rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
      limitRotations(q, all, moved);
      for (const b of BONES) expect(beyondRange(b, q[b]), b).toBeLessThan(1e-9);
    }
    // a joint swung on past its limit slows into it, never faster than the swing driving it
    const r = createRotations();
    const flexion = new Vector3(-1, 0, 0);
    const last = new Quaternion();
    for (let deg = 0; deg <= 180; deg++) {
      r.leftUpperLeg.setFromAxisAngle(flexion, (deg * Math.PI) / 180);
      limitRotations(r, all, moved);
      if (deg > 0) expect(r.leftUpperLeg.angleTo(last)).toBeLessThan((1.01 * Math.PI) / 180);
      last.copy(r.leftUpperLeg);
    }
    // (the hip flexes 120° at most)
    expect(2 * Math.acos(Math.min(1, Math.abs(last.w))) * (180 / Math.PI)).toBeLessThan(120);
  });
});
