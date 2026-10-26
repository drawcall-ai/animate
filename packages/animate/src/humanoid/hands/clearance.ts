import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../../core/frame';
import type { Local, Thing } from '../../body/things';
import { worn } from '../../body/hold';
import { forwardOf, leftOf } from '../../core/math';
import { INDEX } from '../bones';
import type { Person } from '../person';

// Inherited trunk capsule proxy from examples/test/clearance.ts: 6% of stature.
// Uncalibrated; no verified anatomical source.
export const BODY_RADIUS = 0.06;
// Inherited 4 cm reserve, verified against mesh clearance; no empirical calibration recorded.
export const LOAD_RESERVE = 0.04;

/** Clear a load position against the trunk and neck→head chain, in place; returns how far the neck and head moved it (m). */
export function clearBody(h: Person, f: Frame, item: Thing, at: Vector3, rotation: Quaternion, current: Local): number {
  if (worn(item)) return 0;
  const center = item.bounds.getCenter(_center), half = item.bounds.getSize(_half).multiplyScalar(0.5);
  const forward = forwardOf(h.locomotion.facing, _forward), left = leftOf(h.locomotion.facing, _left);
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
  const head = f.prev.point(INDEX.head, h.proportions.headCenter, _head).sub(f.prev.position(INDEX.neck))
    .applyQuaternion(_inverse.copy(f.prev.rotation(INDEX.chest)).invert().premultiply(pose.rotation(INDEX.chest))).add(neck);
  const radius = BODY_RADIUS * h.proportions.height;
  let face = 0;
  for (let i = 0; i < 2; i++) {
    const start = i === 0 ? hips : neck, end = i === 0 ? neck : head;
    if (at.y + bottom > Math.max(start.y, end.y) + radius || at.y + top < Math.min(start.y, end.y) - radius) continue;
    const padding = radius + LOAD_RESERVE * h.scale;
    const side = at.dot(left), a = start.dot(left), b = end.dot(left);
    if (side + near > Math.max(a, b) + padding || side + far < Math.min(a, b) - padding) continue;
    const span = end.y - start.y;
    const low = span === 0 ? 0 : Math.max(0, Math.min(1, (at.y + bottom - radius - start.y) / span));
    const high = span === 0 ? 1 : Math.max(0, Math.min(1, (at.y + top + radius - start.y) / span));
    const from = start.dot(forward), along = end.dot(forward) - from;
    const front = Math.max(from + along * low, from + along * high);
    const push = Math.max(0, front + padding - at.dot(forward) - back);
    at.addScaledVector(forward, push);
    if (i === 1) face = push;
  }
  return face;
}

function extent(half: Vector3, axis: Vector3): number {
  return Math.abs(axis.x) * half.x + Math.abs(axis.y) * half.y + Math.abs(axis.z) * half.z;
}

const _head = new Vector3();
const _center = new Vector3();
const _half = new Vector3();
const _forward = new Vector3();
const _axis = new Vector3();
const _left = new Vector3();
const _inverse = new Quaternion();
