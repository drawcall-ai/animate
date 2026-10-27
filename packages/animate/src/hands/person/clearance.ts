import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../../kernel/frame';
import type { Thing } from '../../things/thing';
import type { Placement } from '../../kernel/goal';
import { worn } from '../../things/hold';
import { forwardOf, leftOf } from '../../kernel/math';
import { INDEX } from '../../species/humanoid/bones';
import type { Reacher } from './reacher';

/** Tuned, uncalibrated: the trunk as a capsule this thick (× stature) */
export const BODY_RADIUS = 0.06;
/** Tuned (checked against a mesh's clearance): the room a load is kept from the body (m) */
export const LOAD_RESERVE = 0.04;

/** Clear a load position against the trunk and neck→head chain, in place; returns how far the neck and head moved it (m). */
export function clearBody(person: Reacher, f: Frame, item: Thing, at: Vector3, rotation: Quaternion, current: Placement): number {
  if (worn(item)) return 0;
  const center = item.bounds.getCenter(_center), half = item.bounds.getSize(_half).multiplyScalar(0.5);
  const forward = forwardOf(person.locomotion.facing, _forward), left = leftOf(person.locomotion.facing, _left);
  let back = Infinity, bottom = Infinity, top = -Infinity, near = Infinity, far = -Infinity;
  for (let i = 0; i < 2; i++) {
    const turn = i === 0 ? rotation : current.quaternion;
    const inverse = _inverse.copy(turn).invert();
    const axis = _axis.copy(forward).applyQuaternion(inverse);
    back = Math.min(back, center.dot(axis) - extent(half, axis));
    axis.set(0, 1, 0).applyQuaternion(inverse);
    bottom = Math.min(bottom, center.dot(axis) - extent(half, axis));
    top = Math.max(top, center.dot(axis) + extent(half, axis));
    axis.copy(left).applyQuaternion(inverse);
    near = Math.min(near, center.dot(axis) - extent(half, axis));
    far = Math.max(far, center.dot(axis) + extent(half, axis));
  }
  const pose = f.current;
  const hips = pose.position(0), neck = pose.position(INDEX.neck);
  // Read the last final gaze, carried with the chest, before this step's task gaze.
  const head = f.prev.point(INDEX.head, person.proportions.headCenter, _head).sub(f.prev.position(INDEX.neck))
    .applyQuaternion(_inverse.copy(f.prev.rotation(INDEX.chest)).invert().premultiply(pose.rotation(INDEX.chest))).add(neck);
  const radius = BODY_RADIUS * person.proportions.height, padding = radius + LOAD_RESERVE * person.scale;
  let face = 0;
  for (let i = 0; i < 2; i++) {
    const start = i === 0 ? hips : neck, end = i === 0 ? neck : head;
    const beyond = Math.max(0, Math.min(start.y, end.y) - at.y - top, at.y + bottom - Math.max(start.y, end.y));
    // (rounded caps: a rising load meets the capsule continuously, not its full width in one sub-step)
    if (beyond >= padding) continue;
    const rim = Math.sqrt(padding ** 2 - beyond ** 2);
    const side = at.dot(left), a = start.dot(left), b = end.dot(left);
    if (side + near > Math.max(a, b) + padding || side + far < Math.min(a, b) - padding) continue;
    const span = end.y - start.y;
    const low = span === 0 ? 0 : Math.max(0, Math.min(1, (at.y + bottom - radius - start.y) / span));
    const high = span === 0 ? 1 : Math.max(0, Math.min(1, (at.y + top + radius - start.y) / span));
    const from = start.dot(forward), along = end.dot(forward) - from;
    const front = Math.max(from + along * low, from + along * high);
    const push = Math.max(0, front + rim - at.dot(forward) - back);
    at.addScaledVector(forward, push);
    if (i === 1) face = push;
  }
  return face;
}

function extent(half: Vector3, axis: Vector3): number {
  return Math.abs(axis.x) * half.x + Math.abs(axis.y) * half.y + Math.abs(axis.z) * half.z;
}

const _head = new Vector3(), _center = new Vector3(), _half = new Vector3(), _forward = new Vector3(), _axis = new Vector3(), _left = new Vector3();
const _inverse = new Quaternion();
