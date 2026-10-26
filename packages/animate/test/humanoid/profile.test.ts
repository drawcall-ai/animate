import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { beyond } from '../../src/core/limits';
import { BONES, CHILD_BONES, INDEX } from '../../src/humanoid/bones';
import { ranges } from '../../src/humanoid/profile/limits';
import { relaxedPose } from '../../src/humanoid/profile/relaxed';
import { rng, turnUpTo } from '../random';

const DEG = Math.PI / 180;

describe('ranges of motion', () => {
  const all = ranges();

  it('limit every joint but the root, once', () => {
    expect(all.map((r) => r.bone).sort((a, b) => a - b)).toEqual(CHILD_BONES.map((b) => INDEX[b]).sort((a, b) => a - b));
    for (const r of all) {
      expect(r.twist[0]).toBeLessThan(r.twist[1]);
      for (const s of r.swing) expect(s[0]).toBeLessThan(s[1]);
    }
  });

  it('mirror the left side to the right', () => {
    const rand = rng(7);
    const of = (bone: string) => {
      const r = all.find((x) => BONES[x.bone] === bone);
      if (!r) throw new Error(`no range for ${bone}`);
      return r;
    };
    let outside = 0;
    for (const left of CHILD_BONES.filter((b) => b.startsWith('left'))) {
      const right = left.replace('left', 'right');
      for (let n = 0; n < 200; n++) {
        const q = turnUpTo(rand, 2.4);
        // (the reflection across x)
        const mirrored = new Quaternion(q.x, -q.y, -q.z, q.w);
        const b = beyond(q, of(left));
        expect(beyond(mirrored, of(right)), left).toBeCloseTo(b, 9);
        if (b > 0) outside++;
      }
    }
    expect(outside).toBeGreaterThan(500);
  });
});

describe('the relaxed pose', () => {
  it('is within every range of motion, the arms hanging and the feet level', () => {
    const relaxed = relaxedPose();
    expect(relaxed.map((r) => r.bone)).toEqual(CHILD_BONES.map((b) => INDEX[b]));
    const pose = BONES.map((_, i) => relaxed.find((r) => r.bone === i)?.rotation ?? new Quaternion());
    for (const r of ranges()) expect(beyond(pose[r.bone], r), BONES[r.bone]).toBe(0);
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
