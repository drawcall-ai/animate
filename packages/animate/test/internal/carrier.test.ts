import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { MovingFrame } from '../../src/kernel/moving-frame';
import { SUBSTEP } from '../../src/kernel/frame';
import { turn } from './rigs';

describe('Carrier', () => {
  it('keeps its last placements, is moved once a sub-step, and stood still through a sub-step it was not moved in', () => {
    const cart = new MovingFrame(new Vector3());
    cart.move(SUBSTEP, new Vector3(1, 0, 0));
    expect(() => cart.move(SUBSTEP, new Vector3(2, 0, 0))).toThrow(/twice/);
    cart.move(2 * SUBSTEP, new Vector3(2, 0, 0));
    expect([cart.prev2, cart.prev, cart.current].map((p) => p.position.x)).toEqual([0, 1, 2]);
    cart.move(5 * SUBSTEP, new Vector3(3, 0, 0));
    expect([cart.prev2, cart.prev, cart.current].map((p) => p.position.x)).toEqual([2, 2, 3]);
  });

  it('carries a point of it into the world, moving with it: v + ω × r', () => {
    const cart = new MovingFrame(new Vector3(), new Quaternion());
    const spin = 0.6;
    cart.move(SUBSTEP, new Vector3(0, 0, 0.01), turn(0, 1, 0, spin * SUBSTEP));
    const out = { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() };
    cart.toWorld({ position: new Vector3(1, 0, 0) }, out);
    expect(out.spin.y).toBeCloseTo(spin, 9);
    const expected = new Vector3(0, 0, 0.01 / SUBSTEP).add(new Vector3(0, spin, 0).cross(new Vector3(1, 0, 0).applyQuaternion(cart.current.quaternion)));
    expect(out.velocity.distanceTo(expected)).toBeLessThan(1e-9);
  });
});
