import { Quaternion, Vector3 } from 'three';
import type { Merged } from './board';
import { inertia } from './jacobian';
import { capJoint, type Joint } from './joints';
import { clampRotation, coordinates, coordinatesOf } from './limits';
import { backward, factor, forward, solve, substitute } from './linear';
import { exp, log } from './rotation';
import { contactRows, targetRows, type Rows } from './rows';
import { STIFFNESS } from './skeleton';
import type { BodyState } from './state';

/** how fast a coordinate no goal pulls slows on its own (1/s): a coasting joint halves its speed in ~0.7 s */
export const DAMPING = 1;
/**
 * how much a coordinate's inertia weighs in the soft solve (per kg m², against a row of weight
 * 1): among coordinates that reach the goals equally well, the closest pose takes more of the
 * light ones than of the heavy ones, and singular limbs stay calm. It slows nothing: each
 * coordinate's own share is anchored to its pace toward that pose.
 */
export const INERTIA_WEIGHT = 1e-3;
/** how much more a contact's row weighs in the soft solve than a target's of weight 1 */
const CONTACT_WEIGHT = 1e4;
/** how often the soft solve re-fits around joints that it drove past their limit */
const PASSES = 4;

/** A linear condition on a joint's displacement: `n · Δq[d…d+2] = value`; `z` caches L⁻¹ nᵀ (L the fit's factor). */
interface Pin {
  d: number;
  n: Vector3;
  value: number;
  z?: Float64Array;
}

/** A goal linearized for the fit: its rows, its weight and how much of its way it goes this step. */
interface Pull {
  rows: Rows;
  weight: number;
  /** `1 − e^(−ω dt)` of a target at stiffness ω; 1 for a contact (met at once) */
  part: number;
  /** how many of its rows (the first) are a position's */
  positions: number;
}

/**
 * The velocity each coordinate takes this step from `start` toward the pose the targets and
 * contacts ask, within the limits and caps (`v` its velocity so far; `scratch` a state to work
 * in). One inertia-regularized least-squares system, solved for: the closest pose (each goal's
 * whole error: where goals in conflict settle, by their weights alone); the goals' own motion
 * this step (within the limits too: a goal moving past one carries no joint into it); and this step's share of the way to the closest pose (each goal's part of it: its
 * own motion whole, so a moving goal is followed without lag, and the rest at its stiffness,
 * `1 − e^(−ω dt)` of it, which never overshoots; a contact's at once). A stiffer goal gets there
 * sooner, not more of its way. A capped joint goes no faster than its goal moves on plus what
 * still stops it at the closest pose under its cap, so it brakes in time instead of
 * overshooting; the joint its cap holds back most is pinned and the rest re-fit around it, until
 * none is. Joints driven past their limit are pinned along the way they went past. Last, the
 * step is fit once more where it takes the body (see `correction`).
 */
export function fit(merged: Merged, start: BodyState, joints: readonly Joint[], v: Float64Array, dt: number, scratch: BodyState): Float64Array {
  const n = start.skeleton.dofs;
  const pulls = pullsAt(merged, start, dt);
  const decay = Math.exp(-DAMPING * dt);
  if (!pulls.some((p) => p.rows.error.length > 0)) return v.map((x) => x * decay);

  // the system, and the right-hand sides for the closest pose and for the goals' own motion; each
  // coordinate's pace, its goals' parts weighed as they pull it
  const { A, M, pulled } = system(pulls, start);
  const whole = new Float64Array(n);
  const motion = new Float64Array(n);
  const pace = new Float64Array(n);
  const norm = new Float64Array(n);
  for (const { rows: { rows, nz, error, rate }, weight, part } of pulls) {
    rows.forEach((row, r) => {
      for (let a = 0; a < nz.length; a++) {
        const wi = weight * row[a];
        whole[nz[a]] += wi * error[r];
        motion[nz[a]] += wi * rate[r] * dt;
        pace[nz[a]] += wi * row[a] * part;
        norm[nz[a]] += wi * row[a];
      }
    });
  }
  for (let i = 0; i < n; i++) if (norm[i] > 0) pace[i] /= norm[i];
  const L = factor(A, n);
  const closest = within(L, whole, joints, merged, start, n, []).displacement;
  const onward = within(L, motion, joints, merged, start, n, []).displacement;

  // this step's share: along each row, its part of the way to the closest pose, its own motion
  // whole; the inertia holds each coordinate to its own pace of it (or the regularization would
  // shorten every step once more)
  const share = new Float64Array(n);
  for (let i = 0; i < n; i++) share[i] = INERTIA_WEIGHT * M[i] * (onward[i] + pace[i] * (closest[i] - onward[i]));
  for (const { rows: { rows, nz }, weight, part } of pulls) {
    for (const row of rows) {
      let there = 0;
      let on = 0;
      for (let a = 0; a < nz.length; a++) {
        there += row[a] * closest[nz[a]];
        on += row[a] * onward[nz[a]];
      }
      const now = (there - on) * part + on;
      for (let a = 0; a < nz.length; a++) share[nz[a]] += weight * row[a] * now;
    }
  }

  // this step's way, braked in time for the caps; the joint its cap holds back most is pinned at
  // what it can do and the rest re-fit around it (the others' fit with it free was no fit at
  // all), until none is
  const capped: Pin[] = [];
  let next = v;
  let held: Pin[] = [];
  for (let pass = 0; pass <= joints.length; pass++) {
    const step = within(L, share, joints, merged, start, n, capped);
    held = step.pins;
    next = v.map((x, i) => (pulled[i] ? step.displacement[i] / dt : x * decay));
    let worst: { joint: Joint; by: number; rates: number[] } | undefined;
    for (const joint of joints) {
      const { d, cap } = joint;
      if (cap === Infinity || (!pulled[d] && !pulled[d + 1] && !pulled[d + 2]) || capped.some((p) => p.d === d)) continue;
      const was = [next[d], next[d + 1], next[d + 2]];
      brake(joint, next, closest, onward, dt);
      capJoint(joint, next, v, dt);
      const by = Math.hypot(next[d] - was[0], next[d + 1] - was[1], next[d + 2] - was[2]) / (cap * dt);
      if (by > 1e-9 && (!worst || by > worst.by)) worst = { joint, by, rates: [next[d], next[d + 1], next[d + 2]] };
    }
    if (!worst) break;
    const { joint: { d }, rates } = worst;
    capped.push(...AXES.map((n) => ({ d, n, value: (n.x * rates[0] + n.y * rates[1] + n.z * rates[2]) * dt })));
  }
  const more = correction(pulls, merged, start, scratch, next, dt, held);
  return next.map((x, i) => (pulled[i] ? x + more[i] / dt : x));
}

/** `merged`'s targets and then its contacts, linearized at `state` */
function pullsAt(merged: Merged, state: BodyState, dt: number): Pull[] {
  const { skeleton } = state;
  const pulls: Pull[] = merged.targets.map(({ target, weight, velocity }) => {
    const bone = target.point === 'com' ? 0 : target.point.bone;
    const w = 2 * Math.PI * (target.stiffness ?? skeleton.bones[bone].stiffness ?? STIFFNESS);
    const rows = targetRows(state, target, velocity);
    return { rows, weight, part: 1 - Math.exp(-w * dt), positions: target.kind === 'position' ? rows.rows.length : 0 };
  });
  for (const c of merged.contacts) {
    const rows = contactRows(state, c, c.velocity, c.spin);
    pulls.push({ rows, weight: CONTACT_WEIGHT, part: 1, positions: rows.rows.length - (c.rotation && c.point !== 'com' ? 3 : 0) });
  }
  return pulls;
}

/** `pulls`' weighted normal matrix, regularized by `state`'s inertia (`M`); and which coordinates any of them pulls */
function system(pulls: readonly Pull[], state: BodyState): { A: Float64Array; M: Float64Array; pulled: Uint8Array } {
  const n = state.skeleton.dofs;
  const A = new Float64Array(n * n);
  const pulled = new Uint8Array(n);
  for (const { rows: { rows, nz }, weight } of pulls) {
    for (const row of rows) {
      for (let a = 0; a < nz.length; a++) {
        const wi = weight * row[a];
        if (wi === 0) continue;
        pulled[nz[a]] = 1;
        for (let c = 0; c < nz.length; c++) A[nz[a] * n + nz[c]] += wi * row[c];
      }
    }
  }
  const M = inertia(state, new Float64Array(n));
  for (let i = 0; i < n; i++) A[i * n + i] += INERTIA_WEIGHT * M[i];
  return { A, M, pulled };
}

/**
 * What a second Gauss–Newton step adds to the displacement `next` · `dt` (`pulls` linearized at
 * `start`), linearized where it takes the body (in `scratch`), the joints it was fit under `held`
 * held: each position goal's miss of where the linear step foresaw it. A fast-turning limb's
 * goals lie on a curve its linear step misses, and the miss would otherwise go to the cheapest
 * coordinate, the root, instead of the limb. (A rotation's error is linear in the coordinates but
 * for how it is written: it misses nothing.)
 */
function correction(pulls: readonly Pull[], merged: Merged, start: BodyState, scratch: BodyState, next: Float64Array, dt: number, held: readonly Pin[]): Float64Array {
  const n = start.skeleton.dofs;
  scratch.copyPose(start).move(next, dt);
  const there = pullsAt(merged, scratch, dt);
  const { A } = system(there, scratch);
  const missed = new Float64Array(n);
  pulls.forEach(({ rows: { rows: was, nz: from, error } }, k) => {
    const { rows: { rows, nz, error: now }, weight, positions } = there[k];
    // (an aim at its own point has no rows where it is reached: nothing to compare)
    if (rows.length !== was.length) return;
    for (let r = 0; r < positions; r++) {
      let foreseen = 0;
      for (let a = 0; a < from.length; a++) foreseen += was[r][a] * next[from[a]] * dt;
      const miss = now[r] - error[r] + foreseen;
      for (let a = 0; a < nz.length; a++) missed[nz[a]] += weight * rows[r][a] * miss;
    }
  });
  const L = factor(A, n);
  return pinned(L, missed, substitute(L, Float64Array.from(missed), n), held.map(({ d, n }) => ({ d, n, value: 0 })), n);
}

/**
 * slows `joint`'s velocity in `rates` to what still stops it at its closest pose under its cap:
 * as fast as its goal moves on by itself (`onward` this step), and as much faster as slowing by
 * `cap dt` every step from then on still stops it within the distance left beyond that motion
 * (`u` with `u dt + (u − cap dt) dt + … ≤ distance`: the sub-step's version of `√(2 cap
 * distance)`, which overshoots by a step and chatters about the pose at the cap)
 */
function brake({ d, cap }: Joint, rates: Float64Array, closest: Float64Array, onward: Float64Array, dt: number): void {
  const speed = Math.hypot(rates[d], rates[d + 1], rates[d + 2]);
  const slowing = cap * dt;
  const distance = Math.hypot(closest[d] - onward[d], closest[d + 1] - onward[d + 1], closest[d + 2] - onward[d + 2]);
  const stop = Math.hypot(onward[d], onward[d + 1], onward[d + 2]) / dt + Math.sqrt((slowing * slowing) / 4 + 2 * cap * distance) - slowing / 2;
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
    for (let m = 0; m < 3; m++) J[3 * m + n] = (wrap(moved[m] - value[m])) / PROBE;
  }
  const r = [rates[d], rates[d + 1], rates[d + 2]];
  const go = [0, 1, 2].map((m) => J[3 * m] * r[0] + J[3 * m + 1] * r[1] + J[3 * m + 2] * r[2]);
  const slowing = cap * dt;
  let braked = false;
  for (let m = 0; m < 3; m++) {
    const speed = Math.abs(go[m]);
    if (speed < 1e-9) continue;
    const room = go[m] > 0 ? range[m][1] - value[m] : value[m] - range[m][0];
    // (at or past its bound already: the pins hold it)
    if (room <= 0) continue;
    const stop = Math.sqrt((slowing * slowing) / 4 + 2 * cap * room) - slowing / 2;
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

/**
 * the displacement `L`'s system gives for `b` under the `fixed` pins, re-fit with the joints it
 * drives past their limits pinned there; and all the pins it was fit under
 */
function within(L: Float64Array, b: Float64Array, joints: readonly Joint[], merged: Merged, start: BodyState, n: number, fixed: readonly Pin[]): { displacement: Float64Array; pins: Pin[] } {
  const free = substitute(L, Float64Array.from(b), n);
  const pins = new Map<number, Pin[]>();
  let displacement = free;
  let all: Pin[] = [...fixed];
  for (let pass = 0; pass < PASSES; pass++) {
    all = [...fixed, ...[...pins.values()].flat()];
    displacement = pinned(L, b, free, all, n);
    let more = false;
    for (const joint of joints) {
      const was = pins.get(joint.d) ?? [];
      if (was.length === 3 || fixed.some((p) => p.d === joint.d)) continue;
      const now = admit(joint, displacement, was, merged, start);
      if (now === was) continue;
      pins.set(joint.d, now);
      more = true;
    }
    if (!more) break;
  }
  return { displacement, pins: all };
}

/** `joint`'s pins after this fit (`was` when it stays within its limit): pinned along the way it went past its limit */
function admit(joint: Joint, displacement: Float64Array, was: Pin[], merged: Merged, start: BodyState): Pin[] {
  const { d, bone } = joint;
  if (bone === undefined) return was;
  const r = new Vector3(displacement[d], displacement[d + 1], displacement[d + 2]);
  const cut = r.clone();
  if (!limited(bone, r, merged, start)) return was;
  // the way it went past, across the ways already pinned
  cut.sub(r);
  for (const p of was) cut.addScaledVector(p.n, -p.n.dot(cut));
  if (cut.length() < 1e-9) return was;
  const n = cut.normalize();
  return [...was, { d, n, value: n.dot(r) }];
}

/** clamps `r`, bone `bone`'s turn from `start` (rotation vector), to what keeps it in its limit; whether it did */
function limited(bone: number, r: Vector3, merged: Merged, start: BodyState): boolean {
  const limit = merged.limits[bone];
  if (!limit) return false;
  const was = start.local[bone];
  const q = exp(r.x, r.y, r.z, _q).multiply(was);
  if (!clampRotation(q, limit)) return false;
  log(q.multiply(_p.copy(was).invert()), r);
  return true;
}


const AXES = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];

/**
 * the velocity change `free` (= A⁻¹ `b`, `L` A's factor) under the pins: the least-squares
 * fit's minimum with every pin's condition `C Δv = c` met, by Lagrange multipliers:
 * (C A⁻¹ Cᵀ) λ = C free − c, Δv = A⁻¹ (b − Cᵀ λ), with C A⁻¹ Cᵀ = (L⁻¹ Cᵀ)ᵀ (L⁻¹ Cᵀ)
 */
function pinned(L: Float64Array, b: Float64Array, free: Float64Array, pins: Pin[], n: number): Float64Array {
  const k = pins.length;
  if (k === 0) return Float64Array.from(free);
  const zs = pins.map((p) => (p.z ??= forward(L, column(p, n), n, p.d)));
  const S = new Float64Array(k * k);
  const rhs = new Float64Array(k);
  let trace = 0;
  pins.forEach((p, i) => {
    for (let j = 0; j <= i; j++) {
      // (both zero before the later pin's coordinate)
      let s = 0;
      for (let d = Math.max(p.d, pins[j].d); d < n; d++) s += zs[i][d] * zs[j][d];
      S[i * k + j] = S[j * k + i] = s;
    }
    trace += S[i * k + i];
    rhs[i] = p.n.x * free[p.d] + p.n.y * free[p.d + 1] + p.n.z * free[p.d + 2] - p.value;
  });
  // (pins that ask the same twice stay solvable)
  for (let i = 0; i < k; i++) S[i * k + i] += 1e-12 * (trace / k);
  const lambda = solve(S, rhs, k);
  const pushed = Float64Array.from(b);
  pins.forEach((p, i) => {
    pushed[p.d] -= lambda[i] * p.n.x;
    pushed[p.d + 1] -= lambda[i] * p.n.y;
    pushed[p.d + 2] -= lambda[i] * p.n.z;
  });
  return backward(L, forward(L, pushed, n), n);
}

/** the pin's condition as a column over the coordinates */
function column(p: Pin, n: number): Float64Array {
  const c = new Float64Array(n);
  c[p.d] = p.n.x;
  c[p.d + 1] = p.n.y;
  c[p.d + 2] = p.n.z;
  return c;
}

const _p = new Quaternion();
const _at = coordinates();
const _probe = coordinates();
const _q = new Quaternion();
