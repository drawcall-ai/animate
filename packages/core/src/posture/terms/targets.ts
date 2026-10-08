import { Quaternion, Vector3 } from 'three';
import type { OrientedTask } from '../../intent/tasks';
import { hypot } from '../../math';
import { raised, type PostureCost } from '../cost';
import { P } from '../trunk';

const _a = new Vector3();
const _b = new Vector3();

/**
 * Tracked body parts (head 3, chest and hips 3 for a position + 5 for a rotation), the
 * seat (3), and lifted/kicking feet (1 per foot: reachable; 2 more while raised: the
 * trunk leans away to balance the leg).
 */
export function targetRows(c: PostureCost, p: Float64Array, r: Float64Array, n: number): number {
  const { d, tasks: t, frame: fk, tracked } = c;
  const head = tracked.head;
  if (head) n = pointRows(head.pos, fk.eyes, 25 * head.weight, r, n);
  n = orientedRows(tracked.chest, fk.chest, fk.qChest, r, n);
  n = orientedRows(tracked.hips, fk.hips, fk.qHips, r, n);
  // seat: the chair carries the pelvis, so balance and leg effort fade out as it takes
  // the weight — sitting down leans the trunk forward over the feet on the way, by itself
  if (c.sit > 0 && t.seat) n = pointRows(t.seat.pos, fk.hips, 30 * c.sit, r, n);

  for (let s = 0; s < 2; s++) {
    const ft = t.feet[s];
    if (!ft) continue;
    const hip = fk.upperLegs[s];
    r[n++] = 10 * ft.weight * Math.max(0, ft.pos.distanceTo(hip) - 0.97 * d.legLength);
    const raise = raised(ft.pos.y, d);
    if (raise <= 0) continue;
    const dx = ft.pos.x - hip.x;
    const dz = ft.pos.z - hip.z;
    const hl = hypot(dx, dz);
    if (hl <= 0.05) {
      r[n++] = 0;
      r[n++] = 0;
      continue;
    }
    const fx = fk.forward;
    const along = (dx * fx.x + dz * fx.z) / hl;
    const lat = (dx * fx.z - dz * fx.x) / hl; // + = toward the character's left
    const w = c.lift(s) * raise;
    r[n++] = 7 * w * (p[P.HIP] + p[P.SPINE] * 0.5 + 0.4 * along);
    // roll + tilts the trunk to the right: lean away from the kicking side
    r[n++] = 7 * w * (p[P.ROLL] - 0.8 * lat);
  }
  return n;
}

/** 3 rows: `weight · (at − target)` */
function pointRows(target: Vector3, at: Vector3, weight: number, r: Float64Array, n: number): number {
  r[n++] = weight * (at.x - target.x);
  r[n++] = weight * (at.y - target.y);
  r[n++] = weight * (at.z - target.z);
  return n;
}

/** position (3 rows) and orientation as forward (3) + up (2) axis differences, as far as the target gives them */
function orientedRows(t: OrientedTask | null, pos: Vector3, q: Quaternion, r: Float64Array, n: number): number {
  if (!t) return n;
  if (t.pos) n = pointRows(t.pos, pos, 10 * t.weight, r, n);
  if (!t.rot) return n;
  const w = 3 * t.weight;
  _a.set(0, 0, 1).applyQuaternion(q);
  _b.set(0, 0, 1).applyQuaternion(t.rot);
  r[n++] = w * (_a.x - _b.x);
  r[n++] = w * (_a.y - _b.y);
  r[n++] = w * (_a.z - _b.z);
  _a.set(0, 1, 0).applyQuaternion(q);
  _b.set(0, 1, 0).applyQuaternion(t.rot);
  r[n++] = w * (_a.x - _b.x);
  r[n++] = w * (_a.z - _b.z);
  return n;
}
