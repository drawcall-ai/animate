import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Board, merge, type Limit } from '../../src';
import { arm, tip } from './rigs';

const at = (x: number, y = 0, z = 0) => new Vector3(x, y, z);
const limit = (twist: [number, number], a: [number, number], b: [number, number]): Limit => ({ bone: 2, axis: 0, twist, swing: [a, b] });

describe('merge', () => {
  it('adds main targets and gives fallbacks only the weight they leave on their bone, by sort', () => {
    const board = new Board();
    board.target({ kind: 'local', point: tip(), value: new Quaternion(), weight: 0.4 });
    board.target({ kind: 'orientation', point: tip(), value: new Quaternion(), weight: 0.3 });
    board.target({ kind: 'local', point: tip(), value: new Quaternion(), weight: 0.5, tier: 'fallback' });
    board.target({ kind: 'local', point: { bone: 1, at: at(0) }, value: new Quaternion(), weight: 0.5, tier: 'fallback' });
    // (a position fallback yields only to positions: the rotations above leave it whole)
    board.target({ kind: 'position', point: tip(), value: at(1), weight: 0.8, tier: 'fallback' });
    const m = merge(board, arm());
    expect(m.targets.map((t) => t.weight)).toEqual([0.4, 0.3, expect.closeTo(0.15, 12), 0.5, 0.8]);
    // main targets taking the bone fully drop its fallback
    board.target({ kind: 'local', point: tip(), value: new Quaternion(), weight: 0.6 });
    expect(merge(board, arm()).targets.map((t) => t.weight)).toEqual([0.4, 0.3, 0.5, 0.8, 0.6]);
  });

  it('yields fallbacks on the bones a main target claims', () => {
    const board = new Board();
    board.target({ kind: 'position', point: tip(), value: at(1), weight: 0.6, claims: [1, 2, 3] });
    for (const bone of [0, 1, 2]) board.target({ kind: 'local', point: { bone, at: at(0) }, value: new Quaternion(), weight: 1, tier: 'fallback' });
    expect(merge(board, arm()).targets.map((t) => t.weight)).toEqual([0.6, 1, 0.4, 0.4]);
    board.target({ kind: 'position', point: tip(), value: at(1), weight: 0.5, claims: [9] });
    expect(() => merge(board, arm())).toThrow(/claim on bone 9/);
  });

  it("counts a position of the centre of mass as one of the root's for fallbacks", () => {
    const board = new Board();
    board.target({ kind: 'position', point: 'com', value: at(1), weight: 0.8 });
    board.target({ kind: 'position', point: 'com', value: at(0), weight: 1, tier: 'fallback' });
    board.target({ kind: 'position', point: { bone: 0, at: at(0) }, value: at(0), weight: 1, tier: 'fallback' });
    board.target({ kind: 'orientation', point: { bone: 0, at: at(0) }, value: new Quaternion(), weight: 1, tier: 'fallback' });
    expect(merge(board, arm()).targets.map((t) => t.weight)).toEqual([0.8, expect.closeTo(0.2, 12), expect.closeTo(0.2, 12), 1]);
  });

  it('gives a position fallback what the main positions leave along each axis it holds', () => {
    const board = new Board();
    const across = new Vector3(1, 0, 1);
    board.target({ kind: 'position', point: 'com', value: at(1), mask: across, weight: 1 });
    board.target({ kind: 'position', point: { bone: 0, at: at(0) }, value: at(0), mask: new Vector3(0, 1, 0), weight: 1, tier: 'fallback' });
    board.target({ kind: 'position', point: 'com', value: at(0), mask: across, weight: 1, tier: 'fallback' });
    board.target({ kind: 'position', point: { bone: 0, at: at(0) }, value: at(0), weight: 0.5, tier: 'fallback' });
    const m = merge(board, arm());
    expect(m.targets.map((t) => t.weight)).toEqual([1, 1, 0.5]);
    // (the one held along every axis keeps only its height)
    expect(m.targets[2].target).toMatchObject({ mask: new Vector3(0, 1, 0) });
  });

    it('copies proposals so behaviours may reuse their vectors', () => {
    const board = new Board();
    const v = at(1);
    board.target({ kind: 'position', point: tip(), value: v, weight: 1 });
    v.set(5, 5, 5);
    expect(board.targets[0].value).toEqual(at(1));
  });

  it('keeps contacts exclusive per point: the highest priority wins, whatever the order', () => {
    const low = { point: tip(), position: at(1), priority: 1, owner: 'low' };
    const high = { point: tip(), position: at(2), priority: 2, owner: 'high' };
    const other = { point: { bone: 3, at: at(0) }, position: at(3), priority: 0, owner: 'low' };
    for (const order of [[low, high, other], [other, high, low]]) {
      const board = new Board();
      order.forEach((c) => board.contact(c));
      const m = merge(board, arm());
      expect(m.contacts.map((c) => c.owner).sort()).toEqual(['high', 'low']);
      expect(m.outcomes.get('high')?.won.length).toBe(1);
      expect(m.outcomes.get('low')?.won.map((c) => c.position.x)).toEqual([3]);
      expect(m.outcomes.get('low')?.lost.map((c) => c.position.x)).toEqual([1]);
    }
  });

  it('throws on contacts of equal priority that disagree, and lets identical ones share', () => {
    const board = new Board();
    board.contact({ point: tip(), position: at(1), priority: 1, owner: 'a' });
    board.contact({ point: tip(), position: at(1), priority: 1, owner: 'b' });
    const m = merge(board, arm());
    expect(m.contacts.length).toBe(1);
    expect(m.outcomes.get('b')?.won.length).toBe(1);
    board.contact({ point: tip(), position: at(2), priority: 1, owner: 'c' });
    expect(() => merge(board, arm())).toThrow(/equal priority/);

    const com = new Board();
    com.contact({ point: 'com', position: at(1), priority: 1 });
    com.contact({ point: 'com', position: at(1, 1), priority: 1 });
    expect(() => merge(com, arm())).toThrow(/equal priority/);
  });

  it('intersects limits and takes the largest cap', () => {
    const board = new Board();
    board.limit(limit([-1, 1], [-0.5, 0.5], [-2, 0]));
    board.limit(limit([-0.2, 2], [-1, 0.1], [-1, 1]));
    board.cap({ bone: 2, acceleration: 5 });
    board.cap({ bone: 2, acceleration: 10 });
    const m = merge(board, arm());
    expect(m.limits[2]).toEqual(limit([-0.2, 1], [-0.5, 0.1], [-1, 0]));
    expect(m.limits[1]).toBeUndefined();
    expect(m.caps).toEqual([Infinity, Infinity, 10, Infinity]);
  });

  it('fails on empty intersections, mixed twist axes and proposals off the skeleton', () => {
    const board = new Board();
    board.limit(limit([0, 1], [0, 1], [0, 1]));
    board.limit(limit([2, 3], [0, 1], [0, 1]));
    expect(() => merge(board, arm())).toThrow(/empty/);
    const axes = new Board();
    axes.limit(limit([0, 1], [0, 1], [0, 1]));
    axes.limit({ ...limit([0, 1], [0, 1], [0, 1]), axis: 1 });
    expect(() => merge(axes, arm())).toThrow(/different axes/);
    const off = new Board();
    off.target({ kind: 'position', point: { bone: 9, at: at(0) }, value: at(0), weight: 1 });
    expect(() => merge(off, arm())).toThrow(/bone 9/);
    const weight = new Board();
    weight.target({ kind: 'position', point: tip(), value: at(0), weight: 2 });
    expect(() => merge(weight, arm())).toThrow(/weight/);
  });
});
