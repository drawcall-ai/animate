import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { beyondRange } from '@prohuman/core';
import { BONES, CHILD_BONES, INDEX } from '../src/bones';
import { caps } from '../src/profile/caps';
import { ranges, type Range } from '../src/profile/limits';
import { relaxedPose } from '../src/profile/relaxed';
import { rng, turnUpTo } from './fixtures';

const DEG = Math.PI / 180;

/** a swing this far round opens the old core's twist range up (its TWIST_FADE): compared only short of it */
const TWIST_FADE = 0.75 * Math.PI;

/**
 * How far `q` is beyond `r` (rad), splitting `q · neutral⁻¹` into swing · twist about the axis
 * as the old core does; null where the old core's twist range opens up.
 */
function beyond(r: Range, q: Quaternion): number | null {
  const p = q.clone();
  if (r.neutral) p.multiply(r.neutral.clone().invert());
  const sg = p.w < 0 ? -1 : 1;
  const c = [sg * p.x, sg * p.y, sg * p.z];
  const w = sg * p.w;
  const i = r.axis;
  const j = (i + 1) % 3;
  const k = (i + 2) % 3;
  const tl = Math.hypot(c[i], w);
  const a = tl > 1e-9 ? c[i] / tl : 0;
  const b = tl > 1e-9 ? w / tl : 1;
  const sj = b * c[j] - a * c[k];
  const sk = b * c[k] + a * c[j];
  const sl = Math.hypot(sj, sk);
  const phi = 2 * Math.atan2(sl, w * b + c[i] * a);
  if (phi >= TWIST_FADE) return null;
  const f = sl > 1e-9 ? phi / sl : 2;
  const out = (v: number, [lo, hi]: [number, number]) => Math.max(0, v - hi, lo - v);
  return Math.max(out(sj * f, r.swing[0]), out(sk * f, r.swing[1]), out(2 * Math.atan2(a, b), r.twist));
}

describe('ranges of motion', () => {
  const all = ranges();

  it('limit every joint but the root, once', () => {
    expect(all.map((r) => r.bone).sort((a, b) => a - b)).toEqual(CHILD_BONES.map((b) => INDEX[b]).sort((a, b) => a - b));
    for (const r of all) {
      expect(r.twist[0]).toBeLessThan(r.twist[1]);
      for (const s of r.swing) expect(s[0]).toBeLessThan(s[1]);
    }
  });

  it("are the old core's, mirrored to the right side", () => {
    const rand = rng(7);
    let compared = 0;
    let outside = 0;
    for (const r of all) {
      const name = BONES[r.bone];
      for (let n = 0; n < 400; n++) {
        const q = turnUpTo(rand, 2.4);
        const ours = beyond(r, q);
        if (ours === null) continue;
        expect(ours, name).toBeCloseTo(beyondRange(name, q), 9);
        compared++;
        if (ours > 0) outside++;
      }
    }
    expect(compared).toBeGreaterThan(4000);
    expect(outside).toBeGreaterThan(1000);
  });
});

describe('caps', () => {
  it('cap every joint, the root too, distal ones faster', () => {
    const all = caps();
    expect(all.map((c) => c.bone)).toEqual(BONES.map((b) => INDEX[b]));
    for (const c of all) expect(c.acceleration).toBeGreaterThan(0);
    const of = (b: (typeof BONES)[number]) => all[INDEX[b]].acceleration;
    expect(of('leftHand')).toBeGreaterThan(of('leftLowerArm'));
    expect(of('leftLowerArm')).toBeGreaterThan(of('leftUpperArm'));
    expect(of('leftUpperArm')).toBeGreaterThan(of('spine'));
  });
});

describe('the relaxed pose', () => {
  it('is within every range of motion, the arms hanging and the feet level', () => {
    const relaxed = relaxedPose();
    expect(relaxed.map((r) => r.bone)).toEqual(CHILD_BONES.map((b) => INDEX[b]));
    const pose = BONES.map((_, i) => relaxed.find((r) => r.bone === i)?.rotation ?? new Quaternion());
    for (const r of ranges()) expect(beyond(r, pose[r.bone]), BONES[r.bone]).toBe(0);
    // the upper arm hangs 8° out from the side; the foot's world rotation is the hips'
    for (const side of ['left', 'right'] as const) {
      const at = (b: string) => pose[BONES.findIndex((n) => n === `${side}${b}`)];
      const arm = new Quaternion().multiply(at('Shoulder')).multiply(at('UpperArm'));
      const dir = new Vector3(side === 'left' ? 1 : -1, 0, 0).applyQuaternion(arm);
      expect(dir.angleTo(new Vector3(0, -1, 0)) / DEG).toBeCloseTo(8, 9);
      expect(dir.x * (side === 'left' ? 1 : -1)).toBeGreaterThan(0);
      const foot = at('UpperLeg').clone().multiply(at('LowerLeg')).multiply(at('Foot'));
      expect(foot.angleTo(new Quaternion())).toBeLessThan(1e-9);
    }
  });
});
