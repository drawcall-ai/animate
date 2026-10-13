import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { BodyState, Skeleton } from '../../src';
import { arm, biped } from './rigs';

const def = (name: string, parent: number) => ({ name, parent, offset: new Vector3(), mass: 1, com: new Vector3() });

describe('Skeleton', () => {
  it('derives chains, subtrees and subtree masses', () => {
    const s = biped();
    expect(s.dofs).toBe(3 + 3 * 8);
    expect(s.chains[4]).toEqual([0, 2, 3, 4]);
    expect(s.subtrees[2]).toEqual([2, 3, 4]);
    expect(s.masses[2]).toBe(13);
    expect(s.mass).toBe(71);
    expect(s.index('rightShin')).toBe(6);
  });

  it('fails visibly on a bad rig', () => {
    expect(() => new Skeleton([])).toThrow();
    expect(() => new Skeleton([def('a', -1), def('b', 2), def('c', 0)])).toThrow(/parents must come before/);
    expect(() => new Skeleton([def('a', -1), def('b', -1)])).toThrow();
    expect(() => new Skeleton([def('a', 0)])).toThrow(/root/);
    expect(() => new Skeleton([def('a', -1), def('a', 0)])).toThrow(/twice/);
    expect(() => arm().index('foot')).toThrow(/no bone/);
  });
});

describe('BodyState', () => {
  it('derives world transforms, the centre of mass and point velocities', () => {
    const s = new BodyState(arm());
    expect(s.positions[3].toArray()).toEqual([0.75, 1, 0]);
    // (10·0 + 2·0.35 + 1.5·0.62 + 0.5·0.8) / 14
    expect(s.com.x).toBeCloseTo((2 * 0.35 + 1.5 * 0.62 + 0.5 * 0.8) / 14, 12);
    s.rates[1].set(0, 0, 2);
    s.velocity.set(1, 0, 0);
    s.derive();
    const v = s.pointVelocity({ bone: 3, at: new Vector3(0.1, 0, 0) }, new Vector3());
    // ω × r: 2 rad/s about z at 0.65 m along x → 1.3 m/s up
    expect(v.x).toBeCloseTo(1, 12);
    expect(v.y).toBeCloseTo(1.3, 12);
    expect(s.comVelocity.y).toBeCloseTo((2 * 0.15 + 1.5 * 0.42 + 0.5 * 0.6) * 2 / 14, 12);
  });

  it('counts loads in the centre of mass', () => {
    const s = new BodyState(arm());
    s.loads = [{ bone: 3, mass: 6, at: new Vector3(0, 0, 0) }];
    s.forward();
    expect(s.mass).toBe(20);
    expect(s.com.x).toBeCloseTo((2 * 0.35 + 1.5 * 0.62 + 0.5 * 0.8 + 6 * 0.75) / 20, 12);
  });

  it('copies from a read-only snapshot', () => {
    const from: Readonly<BodyState> = new BodyState(arm());
    from.position.set(1, 2, 3);
    const to = new BodyState(arm()).copy(from);
    expect(to.positions[3].toArray()).toEqual([1.75, 2, 3]);
  });
});
