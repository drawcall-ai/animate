import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Carrier } from '../../src';
import { STEP } from '../../src/core/body';
import { turn } from './rigs';

describe('Carrier', () => {
  it('keeps its last placements, is moved once a sub-step, and stood still through a sub-step it was not moved in', () => {
    const cart = new Carrier(new Vector3());
    cart.move(STEP, new Vector3(1, 0, 0));
    expect(() => cart.move(STEP, new Vector3(2, 0, 0))).toThrow(/twice/);
    cart.move(2 * STEP, new Vector3(2, 0, 0));
    expect([cart.prev2, cart.prev, cart.current].map((p) => p.position.x)).toEqual([0, 1, 2]);
    cart.move(5 * STEP, new Vector3(3, 0, 0));
    expect([cart.prev2, cart.prev, cart.current].map((p) => p.position.x)).toEqual([2, 2, 3]);
  });

  it('carries a point of it into the world, moving with it: v + ω × r', () => {
    const cart = new Carrier(new Vector3(), new Quaternion());
    const spin = 0.6;
    cart.move(STEP, new Vector3(0, 0, 0.01), turn(0, 1, 0, spin * STEP));
    const out = { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() };
    cart.toWorld({ position: new Vector3(1, 0, 0) }, out);
    expect(out.spin.y).toBeCloseTo(spin, 9);
    const expected = new Vector3(0, 0, 0.01 / STEP).add(new Vector3(0, spin, 0).cross(new Vector3(1, 0, 0).applyQuaternion(cart.current.quaternion)));
    expect(out.velocity.distanceTo(expected)).toBeLessThan(1e-9);
  });
});
