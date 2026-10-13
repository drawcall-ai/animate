import { Quaternion, Vector3 } from 'three';
import { angularBlock, positionBlock, type Block } from './jacobian';
import { log } from './rotation';
import { dof } from './skeleton';
import type { BodyState } from './state';
import type { Contact, Point, Residual, Target } from './types';

/**
 * A goal linearized at a state: Jacobian rows over the coordinates `nz` (see `Block`), the
 * errors `J · Δq` should close, and how fast the goal itself moves along each row (`rate`, per
 * s). A position's rows count in the skeleton's `length` (so they weigh about as a rotation's,
 * in rad), each scaled by the square root of its mask's weight.
 */
export interface Rows extends Block {
  error: number[];
  rate: number[];
}

const NO_RATE = new Vector3();
const NONE: Rows = { nz: [], rows: [], error: [], rate: [] };

/** a soft target's rows (none for an aim at its own point), moving at `velocity` (m/s or rad/s) */
export function targetRows(state: BodyState, target: Target, velocity = NO_RATE): Rows {
  switch (target.kind) {
    case 'position':
      return positionGoal(state, target.point, target.value, target.mask, velocity);
    case 'orientation': {
      const bone = target.point.bone;
      return { ...angularBlock(state, bone), error: rotationError(state.rotations[bone], target.value), rate: velocity.toArray() };
    }
    case 'local': {
      const d = dof(target.point.bone);
      const rows = [new Float64Array([1, 0, 0]), new Float64Array([0, 1, 0]), new Float64Array([0, 0, 1])];
      return { nz: [d, d + 1, d + 2], rows, error: rotationError(state.local[target.point.bone], target.value), rate: velocity.toArray() };
    }
    case 'aim': {
      const bone = target.point.bone;
      const to = target.value.clone().sub(state.point(target.point, _x));
      const distance = to.length();
      if (distance < 1e-9) return NONE;
      const a = target.axis.clone().applyQuaternion(state.rotations[bone]).normalize();
      to.divideScalar(distance);
      // the axis turns by ω × a: only ω across it counts; the aim turns as its point moves across it
      const { nz, rows: J } = angularBlock(state, bone);
      const rows = J.map(() => new Float64Array(nz.length));
      for (let k = 0; k < 3; k++) {
        for (let l = 0; l < 3; l++) {
          const p = (k === l ? 1 : 0) - a.getComponent(k) * a.getComponent(l);
          J[l].forEach((x, c) => (rows[k][c] += p * x));
        }
      }
      const rate = new Vector3().crossVectors(to, velocity).divideScalar(distance);
      rate.addScaledVector(a, -a.dot(rate));
      return { nz, rows, error: turn(a, to).toArray(), rate: rate.toArray() };
    }
  }
}

/**
 * a contact's rows: one per axis its mask holds, 3 more for its rotation when it holds one;
 * moving at `velocity` (m/s) and turning at `spin` (rad/s, world)
 */
export function contactRows(state: BodyState, contact: Contact, velocity = NO_RATE, spin = NO_RATE): Rows {
  const goal = positionGoal(state, contact.point, contact.position, contact.mask, velocity);
  if (!contact.rotation || contact.point === 'com') return goal;
  // (over the same coordinates: the bone's drivers)
  const bone = contact.point.bone;
  goal.rows.push(...angularBlock(state, bone).rows);
  goal.error.push(...rotationError(state.rotations[bone], contact.rotation));
  goal.rate.push(spin.x, spin.y, spin.z);
  return goal;
}

/** how far `state` is off `target` (its masked position, or its rotation) */
export function targetResidual(state: BodyState, target: Target): Residual {
  switch (target.kind) {
    case 'position':
      return { position: masked(target.value.clone().sub(state.point(target.point, _x)), target.mask), rotation: 0 };
    case 'orientation':
      return { position: 0, rotation: state.rotations[target.point.bone].angleTo(target.value) };
    case 'local':
      return { position: 0, rotation: state.local[target.point.bone].angleTo(target.value) };
    case 'aim': {
      const to = target.value.clone().sub(state.point(target.point, _x));
      const a = target.axis.clone().applyQuaternion(state.rotations[target.point.bone]);
      return { position: 0, rotation: to.lengthSq() > 0 ? a.angleTo(to) : 0 };
    }
  }
}

/** how far `state` is off `contact` (its masked position, and its rotation) */
export function contactResidual(state: BodyState, contact: Contact): Residual {
  const position = masked(contact.position.clone().sub(state.point(contact.point, _x)), contact.mask);
  const rotation = contact.rotation && contact.point !== 'com' ? state.rotations[contact.point.bone].angleTo(contact.rotation) : 0;
  return { position, rotation };
}

/** the length of `e` under the axis weights `mask` */
const masked = (e: Vector3, mask: Vector3 | undefined) =>
  mask ? Math.sqrt(mask.x * e.x * e.x + mask.y * e.y * e.y + mask.z * e.z * e.z) : e.length();

/** the rows taking `point` to `to` (moving at `velocity`), in lengths of the skeleton, per masked axis */
function positionGoal(state: BodyState, point: Point, to: Vector3, mask: Vector3 | undefined, velocity: Vector3): Rows {
  const { nz, rows: J } = positionBlock(state, point);
  const e = to.clone().sub(state.point(point, _x));
  const goal: Rows = { nz, rows: [], error: [], rate: [] };
  for (let k = 0; k < 3; k++) {
    const weight = mask ? mask.getComponent(k) : 1;
    if (weight === 0) continue;
    const s = Math.sqrt(weight) / state.skeleton.length;
    goal.rows.push(J[k].map((x) => x * s));
    goal.error.push(e.getComponent(k) * s);
    goal.rate.push(velocity.getComponent(k) * s);
  }
  return goal;
}

/** the rotation vector (world or parent frame, as `from`) turning `from` onto `to` */
const rotationError = (from: Quaternion, to: Quaternion) => log(_q.copy(from).invert().premultiply(to), new Vector3()).toArray();

/** the rotation vector (rad) turning unit vector `a` onto unit vector `b` the short way */
function turn(a: Vector3, b: Vector3): Vector3 {
  const axis = new Vector3().crossVectors(a, b);
  const s = axis.length();
  const angle = Math.atan2(s, a.dot(b));
  if (s > 1e-12) return axis.multiplyScalar(angle / s);
  if (angle < 1) return axis.set(0, 0, 0);
  // opposite: any axis across `a`
  axis.set(1, 0, 0).cross(a);
  if (axis.lengthSq() < 1e-6) axis.set(0, 1, 0).cross(a);
  return axis.normalize().multiplyScalar(Math.PI);
}

const _q = new Quaternion();
const _x = new Vector3();
