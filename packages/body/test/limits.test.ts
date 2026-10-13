import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Board, BodyState, beyond, clampRotation, merge, type Limit } from '../src/index.js';
import { arm } from './rigs.js';

const about = (x: number, y: number, z: number, angle: number) => new Quaternion().setFromAxisAngle(new Vector3(x, y, z).normalize(), angle);
// an upper arm along +x, hanging when turned -90° about z; measured off hanging, its own axis is
// the parent's -y: twist ±0.3 about y, swing ±0.5 about z and x
const hanging = about(0, 0, 1, -Math.PI / 2);
const shoulder: Limit = { bone: 1, axis: 1, neutral: hanging, twist: [-0.3, 0.3], swing: [[-0.5, 0.5], [-0.5, 0.5]] };

describe('limits from a neutral', () => {
  it('keep the neutral itself inside', () => {
    expect(beyond(hanging, shoulder)).toBe(0);
    expect(clampRotation(hanging.clone(), shoulder)).toBe(false);
    // the identity (the arm straight out) is 90° off hanging
    expect(beyond(new Quaternion(), shoulder)).toBeCloseTo(Math.PI / 2 - 0.5, 9);
  });

  it('clamp relative to the neutral', () => {
    // swung 0.8 rad forward off hanging (about the parent's x): clamped to 0.5 off it
    const q = about(1, 0, 0, 0.8).multiply(hanging);
    expect(clampRotation(q, shoulder)).toBe(true);
    const off = q.clone().multiply(hanging.clone().invert());
    expect(2 * Math.acos(Math.min(1, Math.abs(off.w)))).toBeCloseTo(0.5, 9);
    expect(beyond(q, shoulder)).toBeLessThan(1e-9);
    // a twist about the hanging arm's own axis stays within ±0.3
    const t = hanging.clone().multiply(about(1, 0, 0, 0.6));
    clampRotation(t, shoulder);
    expect(t.angleTo(hanging)).toBeCloseTo(0.3, 9);
  });

  it('intersect only when measured from the same neutral', () => {
    const board = new Board();
    board.limit(shoulder);
    board.limit({ ...shoulder, twist: [-0.1, 1] });
    expect(merge(board, arm()).limits[1]).toEqual({ ...shoulder, twist: [-0.1, 0.3] });
    board.limit({ ...shoulder, neutral: undefined });
    expect(() => merge(board, arm())).toThrow(/different neutrals/);
  });
});

describe('BodyState.copy', () => {
  it('copies from a read-only snapshot', () => {
    const from: Readonly<BodyState> = new BodyState(arm());
    from.position.set(1, 2, 3);
    const to = new BodyState(arm()).copy(from);
    expect(to.positions[3].toArray()).toEqual([1.75, 2, 3]);
  });
});
