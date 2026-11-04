import { Quaternion } from 'three';
import type { Merged } from './board';
import type { Joint } from './joints';
import { coordinates, coordinatesOf } from './limits';
import { exp } from './rotation';
import type { BodyState } from './state';

/**
 * the speed (per s) from which slowing by `cap · dt` every step still stops within `distance`:
 * `u` with `u dt + (u − cap dt) dt + … ≤ distance`, the sub-step's version of `√(2 cap distance)`
 * (which overshoots by a step and chatters about the stop at the cap)
 */
export function stopping(cap: number, distance: number, dt: number): number {
  const slowing = cap * dt;
  return Math.sqrt((slowing * slowing) / 4 + 2 * cap * distance) - slowing / 2;
}

/**
 * slows `joint`'s velocity in `rates` to what still stops it at its closest pose under its cap: as
 * fast as its goal moves on by itself (`onward` this step), and as much faster as still stops it
 * within the distance left beyond that motion
 */
export function brake({ d, cap }: Joint, rates: Float64Array, closest: Float64Array, onward: Float64Array, dt: number): void {
  const speed = Math.hypot(rates[d], rates[d + 1], rates[d + 2]);
  const distance = Math.hypot(closest[d] - onward[d], closest[d + 1] - onward[d + 1], closest[d + 2] - onward[d + 2]);
  const stop = Math.hypot(onward[d], onward[d + 1], onward[d + 2]) / dt + stopping(cap, distance, dt);
  if (speed <= stop) return;
  for (let k = d; k < d + 3; k++) rates[k] *= stop / speed;
}

/**
 * slows `joint` so that each of its limit's coordinates (the swing's two, the twist) still stops
 * at its bound under the cap, as `brake` does for the closest pose: a joint whose way there is
 * long in one coordinate may near its bound in another first, and would slam into it. Each
 * coordinate's rate is braked on its own, the turn's others left as they are.
 */
export function brakeAtLimit({ d, cap, bone }: Joint, rates: Float64Array, merged: Merged, start: BodyState, dt: number): void {
  const limit = bone === undefined ? undefined : merged.limits[bone];
  if (bone === undefined || !limit || cap === Infinity) return;
  if (Math.hypot(rates[d], rates[d + 1], rates[d + 2]) < 1e-9) return;
  const q = start.local[bone];
  const { value, range } = coordinatesOf(q, limit, _at);
  // (how each coordinate moves with each coordinate of the turn: d coordinates / d turn)
  const J = new Float64Array(9);
  for (let n = 0; n < 3; n++) {
    const e = [0, 0, 0];
    e[n] = PROBE;
    const moved = coordinatesOf(exp(e[0], e[1], e[2], _q).multiply(q), limit, _probe).value;
    for (let m = 0; m < 3; m++) J[3 * m + n] = wrap(moved[m] - value[m]) / PROBE;
  }
  const r = [rates[d], rates[d + 1], rates[d + 2]];
  const go = [0, 1, 2].map((m) => J[3 * m] * r[0] + J[3 * m + 1] * r[1] + J[3 * m + 2] * r[2]);
  let braked = false;
  for (let m = 0; m < 3; m++) {
    const speed = Math.abs(go[m]);
    if (speed < 1e-9) continue;
    const room = go[m] > 0 ? range[m][1] - value[m] : value[m] - range[m][0];
    // (at or past its bound already: the pins hold it)
    if (room <= 0) continue;
    const stop = stopping(cap, room, dt);
    if (speed <= stop) continue;
    go[m] = Math.sign(go[m]) * stop;
    braked = true;
  }
  if (!braked) return;
  const turn = solve3(J, go);
  if (!turn) return;
  for (let n = 0; n < 3; n++) rates[d + n] = turn[n];
}

/** how far the coordinates are probed (rad) */
const PROBE = 1e-4;
const wrap = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

/** `x` with `J x = b` (3×3, row-major), by Cramer's rule; none where `J` is all but singular (at the swing's turn opposite its axis) */
function solve3(J: Float64Array, b: number[]): number[] | null {
  const det = (m: ArrayLike<number>) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  const D = det(J);
  if (Math.abs(D) < 1e-6) return null;
  return [0, 1, 2].map((n) => {
    const m = Float64Array.from(J);
    for (let row = 0; row < 3; row++) m[3 * row + n] = b[row];
    return det(m) / D;
  });
}

const _at = coordinates();
const _probe = coordinates();
const _q = new Quaternion();
