import { Quaternion, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { angleOf } from '../../src/kernel/rotation';

it('measures coincident and tiny rotations without acos cancellation, including opposite quaternion signs', () => {
  const axis = new Vector3(1, 2, 3).normalize();
  for (let k = 0; k < 100; k++) {
    const from = new Quaternion().setFromAxisAngle(axis, k / 20);
    expect(angleOf(from, from)).toBeLessThan(1e-15);
    const opposite = new Quaternion(-from.x, -from.y, -from.z, -from.w);
    expect(angleOf(from, opposite)).toBeLessThan(1e-15);
    for (const angle of [1e-10, 1e-8, 0.1, Math.PI]) {
      const to = new Quaternion().setFromAxisAngle(axis, angle).multiply(from);
      expect(Math.abs(angleOf(from, to) - angle)).toBeLessThan(2e-15);
    }
  }
});
