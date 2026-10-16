import { Quaternion, Vector3 } from 'three';
import type { Item } from '../../core/carrier';
import type { ReadonlyPose } from '../../core/pose';
import { forwardOf, leftOf } from '../../core/math';
import { INDEX } from '../bones';
import type { Humanoid } from '../humanoid';

// Conservative trunk capsule, as a share of stature (the same proxy as the head).
const BODY_RADIUS = 0.06;
// Inherited unchanged from iteration 11 (3cad1b6): load clearance reserve (m).
export const LOAD_RESERVE = 0.04;

/** Keep a known solid envelope in front of the trunk, including the item's fitted rotation lag. */
export function clearBody<W>(h: Humanoid<W>, pose: ReadonlyPose, item: Item, at: Vector3, rotation: Quaternion): Vector3 {
  const bounds = item.bounds;
  if (!bounds || item.wornBy) return at;
  const center = bounds.getCenter(_center), half = bounds.getSize(_half).multiplyScalar(0.5);
  const forward = forwardOf(h.gait.facing, _forward), left = leftOf(h.gait.facing, _left);
  let back = Infinity, bottom = Infinity, top = -Infinity, near = Infinity, far = -Infinity;
  for (let i = 0; i < 2; i++) {
    const turn = i === 0 ? rotation : item.current.quaternion;
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
  const hips = pose.position(0), neck = pose.position(INDEX.neck);
  const radius = BODY_RADIUS * h.proportions.height;
  if (at.y + bottom > neck.y + radius || at.y + top < hips.y - radius) return at;
  const padding = radius + LOAD_RESERVE * h.scale;
  const side = at.dot(left), a = hips.dot(left), b = neck.dot(left);
  if (side + near > Math.max(a, b) + padding || side + far < Math.min(a, b) - padding) return at;
  const span = Math.max(Number.EPSILON, neck.y - hips.y);
  const low = Math.max(0, Math.min(1, (at.y + bottom - radius - hips.y) / span));
  const high = Math.max(0, Math.min(1, (at.y + top + radius - hips.y) / span));
  const from = hips.dot(forward), along = neck.dot(forward) - from;
  const front = Math.max(from + along * low, from + along * high);
  return at.addScaledVector(forward, Math.max(0, front + padding - at.dot(forward) - back));
}

function extent(half: Vector3, axis: Vector3): number {
  return Math.abs(axis.x) * half.x + Math.abs(axis.y) * half.y + Math.abs(axis.z) * half.z;
}

const _center = new Vector3();
const _half = new Vector3();
const _forward = new Vector3();
const _axis = new Vector3();
const _left = new Vector3();
const _inverse = new Quaternion();
