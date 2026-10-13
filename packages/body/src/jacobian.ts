import { Vector3 } from 'three';
import { dof } from './skeleton.js';
import type { BodyState } from './state.js';
import type { BonePoint, Point } from './types.js';

/**
 * Analytic Jacobians of a body's points and bones with respect to its generalized coordinates
 * (see `BodyState`): a rotation's column about a bone's joint at `p` along world axis `ω` moves
 * a point `x` by `ω × (x − p)`, its bone and every bone below by `ω`.
 */

/** the inertia under no mass a coordinate is given, so every one stays movable (kg m²) */
const FLOOR = 1e-4;

/** bone `bone`'s three rotation axes (world): its parent's frame's, the world's for the root */
function axes(state: BodyState, bone: number, out: Vector3[]): Vector3[] {
  const parent = state.skeleton.bones[bone].parent;
  out[0].set(1, 0, 0);
  out[1].set(0, 1, 0);
  out[2].set(0, 0, 1);
  if (parent >= 0) for (const a of out) a.applyQuaternion(state.rotations[parent]);
  return out;
}

/**
 * Rows of a Jacobian over a few coordinates: `rows[k][a]` is row k's derivative by coordinate
 * `nz[a]` (a point or bone depends only on the root's position and its ancestors' rotations).
 */
export interface Block {
  nz: readonly number[];
  rows: Float64Array[];
}

/**
 * adds `scale` × the Jacobian of `point`'s world position into `rows` (3): over all the
 * coordinates when `whole`, else over the point's bone's drivers
 */
function addBonePoint(state: BodyState, point: BonePoint, scale: number, rows: Float64Array[], whole: boolean): void {
  const x = state.point(point, _x);
  for (let k = 0; k < 3; k++) rows[k][k] += scale;
  state.skeleton.chains[point.bone].forEach((j, c) => {
    axes(state, j, _a);
    _r.subVectors(x, state.positions[j]);
    // (on the whole body's coordinates, or on the bone's drivers: the root's position, then its chain's)
    const at = whole ? dof(j) : 3 + 3 * c;
    _a.forEach((a, m) => {
      _c.crossVectors(a, _r);
      rows[0][at + m] += scale * _c.x;
      rows[1][at + m] += scale * _c.y;
      rows[2][at + m] += scale * _c.z;
    });
  });
}

/** the Jacobian of `point`'s world position (3 rows); the centre of mass's is its masses' mean */
export function positionBlock(state: BodyState, point: Point): Block {
  if (point !== 'com') {
    const nz = state.skeleton.drivers[point.bone];
    const rows = block(nz.length);
    addBonePoint(state, point, 1, rows, false);
    return { nz, rows };
  }
  if (!(state.mass > 0)) throw new Error('the centre of mass of a massless body cannot be moved');
  const rows = block(state.skeleton.dofs);
  state.masses((p, m) => addBonePoint(state, p, m / state.mass, rows, true));
  return { nz: state.skeleton.coordinates, rows };
}

/** the Jacobian of bone `bone`'s world angular velocity (3 rows, over its drivers) */
export function angularBlock(state: BodyState, bone: number): Block {
  const nz = state.skeleton.drivers[bone];
  const rows = block(nz.length);
  state.skeleton.chains[bone].forEach((j, c) => {
    axes(state, j, _a);
    _a.forEach((a, m) => {
      rows[0][3 + 3 * c + m] = a.x;
      rows[1][3 + 3 * c + m] = a.y;
      rows[2][3 + 3 * c + m] = a.z;
    });
  });
  return { nz, rows };
}

const block = (width: number) => [new Float64Array(width), new Float64Array(width), new Float64Array(width)];

/**
 * Each coordinate's inertia (a diagonal mass matrix): the mass for the root's position, the
 * moment of inertia of the masses below a joint about each of its axes for a rotation.
 */
export function inertia(state: BodyState, out: Float64Array): Float64Array {
  out.fill(FLOOR);
  for (let k = 0; k < 3; k++) out[k] += state.mass;
  const { chains } = state.skeleton;
  state.masses((p, mass) => {
    const x = state.point(p, _x);
    for (const j of chains[p.bone]) {
      axes(state, j, _a);
      _r.subVectors(x, state.positions[j]);
      const r2 = _r.lengthSq();
      _a.forEach((a, m) => {
        const along = a.dot(_r);
        out[dof(j) + m] += mass * (r2 - along * along);
      });
    }
  });
  return out;
}

const _a = [new Vector3(), new Vector3(), new Vector3()];
const _c = new Vector3();
const _r = new Vector3();
const _x = new Vector3();
