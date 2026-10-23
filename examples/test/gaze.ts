import { Euler, Quaternion, Vector3 } from 'three';

/**
 * The fastest gaze shift of a head, from its world rotation every step (`dt` apart), in degrees: the movement around its peak speed
 * (from and to a tenth of it), how far it turned, its peak angular speed (°/s), how far its speed fell between two higher speeds as a
 * share of the peak (a single bell: 0; slowing, then a second shift: more), and the most its turn's axis swung from one step to the
 * next (turning back: > 90°); and the head's most roll in the world over all of them.
 */
export function headShift(heads: readonly Quaternion[], dt: number) {
  const deg = 180 / Math.PI;
  const speeds = heads.slice(1).map((q, k) => q.angleTo(heads[k]) / dt);
  const peak = Math.max(...speeds);
  let from = speeds.indexOf(peak), to = from;
  while (from > 0 && speeds[from - 1] >= peak / 10) from--;
  while (to < speeds.length - 1 && speeds[to + 1] >= peak / 10) to++;
  const moving = speeds.slice(from, to + 1);
  let valley = 0;
  moving.forEach((v, k) => {
    valley = Math.max(valley, Math.min(Math.max(...moving.slice(0, k + 1)), Math.max(...moving.slice(k))) - v);
  });
  let swing = 0;
  for (let k = from + 1; k <= to; k++) swing = Math.max(swing, spin(heads[k], heads[k + 1]).angleTo(spin(heads[k - 1], heads[k])) * deg);
  const roll = Math.max(...heads.map((q) => Math.abs(new Euler().setFromQuaternion(q, 'YXZ').z) * deg));
  return { amplitude: heads[from].angleTo(heads[to + 1]) * deg, peak: peak * deg, valley: valley / peak, swing, roll };
}

/** the world turn from `a` to `b`: its axis times its angle */
function spin(a: Quaternion, b: Quaternion): Vector3 {
  const q = b.clone().multiply(a.clone().invert());
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const s = Math.hypot(q.x, q.y, q.z);
  return s < 1e-12 ? new Vector3() : new Vector3(q.x, q.y, q.z).multiplyScalar(2 * Math.atan2(s, q.w) / s);
}

/**
 * How people's heads shift gaze. Its peak speed (°/s) in a shift of `amplitude` (°): the main sequence, 100°/s and 2.3°/s more per
 * degree (the library's `HEAD_SEQUENCE`, recalled from Guitton & Volle 1987, J Neurophysiol 58:427, not checked against the paper), a
 * fifth over it at most — single shifts scatter about it, and the trunk turning beneath adds to the head's speed in the world (recalled,
 * not a measured spread). Its speed a single bell, near minimum jerk (recalled: Zangemeister et al. 1981, Biol Cybern 41:19, a head
 * movement's velocity single-peaked): not falling by a tenth of its peak before rising again (tuned, for a body standing still: one
 * stepping round beneath the head carries it on at its range after the shift). Never turning back: its axis within a right angle of the step before's. And
 * upright: its roll in the world within a few degrees, as the head is held in walking and turning (recalled: Pozzo, Berthoz & Lefort
 * 1990, Exp Brain Res 82:97, head roll within a few degrees in locomotor tasks; Fick's strategy in gaze shifts, Glenn & Vilis 1992,
 * J Neurophysiol 68:309).
 */
export const SHIFT_BOUNDS = { peak: (amplitude: number) => 1.2 * (100 + 2.3 * amplitude), valley: 0.1, swing: 90, roll: 5 };
