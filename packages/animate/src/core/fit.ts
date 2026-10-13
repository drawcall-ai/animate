import { Quaternion, Vector3 } from 'three';
import type { Merged } from './board';
import { inertia } from './jacobian';
import type { Joint } from './joints';
import { clampRotation } from './limits';
import { backward, factor, forward, solve, substitute } from './linear';
import { exp, log } from './rotation';
import { contactRows, targetRows, type Rows } from './rows';
import { STIFFNESS } from './skeleton';
import type { BodyState } from './state';

/** how fast a coordinate no goal pulls slows on its own (1/s): a coasting joint halves its speed in ~0.7 s */
export const DAMPING = 1;
/**
 * how much a coordinate's inertia resists changing its velocity (per kg m², against a row of
 * weight 1): small enough that targets are followed, large enough that light segments move
 * before heavy ones and singular limbs stay calm
 */
export const INERTIA_WEIGHT = 1e-3;
/** how much more a contact's row weighs in the soft solve than a target's of weight 1 */
const CONTACT_WEIGHT = 1e4;
/** how often the soft solve re-fits around joints that reached a limit or their cap */
const PASSES = 4;

/** A linear condition on a joint's displacement: `n · Δq[d…d+2] = value`; `z` caches L⁻¹ nᵀ (L the fit's factor). */
interface Pin {
  d: number;
  n: Vector3;
  value: number;
  z?: Float64Array;
}

/**
 * The velocity each coordinate takes this step from `start` toward the pose the targets and
 * contacts ask, within the limits and caps (`v` its velocity so far). One inertia-regularized
 * least-squares system, solved for: the closest pose (each goal's whole error); this step's
 * share of it (a moving goal's own motion whole, so it is followed without lag, and the rest of a
 * target's error closed at its stiffness, `1 − e^(−ω dt)` of it, which never overshoots; a
 * contact's at once); and the goals' own motion. A capped joint goes no faster than its goal
 * moves on plus what still stops it at the closest pose under its cap (`√(2 cap distance)`), so
 * it brakes in time instead of overshooting; one its cap still holds back is pinned and the rest
 * re-fit. Joints driven past their limit are pinned along the way they went past.
 */
export function fit(merged: Merged, start: BodyState, joints: readonly Joint[], v: Float64Array, dt: number): Float64Array {
  const { skeleton } = start;
  const n = skeleton.dofs;
  const A = new Float64Array(n * n);
  // the right-hand sides for the closest pose and for this step's share of it (displacements)
  const whole = new Float64Array(n);
  const share = new Float64Array(n);
  // and for the goals' own motion this step (how far they move on by themselves)
  const motion = new Float64Array(n);
  const pulled = new Uint8Array(n);
  let count = 0;
  // (`at`: how far the goal is from `start`; `now`: how much of that to go this step)
  const add = ({ rows, nz }: Rows, r: number, weight: number, at: number, now: number, on = 0) => {
    count++;
    const row = rows[r];
    for (let a = 0; a < nz.length; a++) {
      const wi = weight * row[a];
      if (wi === 0) continue;
      const i = nz[a];
      pulled[i] = 1;
      whole[i] += wi * at;
      share[i] += wi * now;
      motion[i] += wi * on;
      for (let c = 0; c < nz.length; c++) A[i * n + nz[c]] += wi * row[c];
    }
  };
  for (const { target, weight, velocity } of merged.targets) {
    const bone = target.point === 'com' ? 0 : target.point.bone;
    const w = 2 * Math.PI * (target.stiffness ?? skeleton.bones[bone].stiffness ?? STIFFNESS);
    const part = 1 - Math.exp(-w * dt);
    const rows = targetRows(start, target, velocity);
    // (the goal is where it will be at the step's end: of the way there, its own motion is gone whole, the rest at the stiffness)
    rows.error.forEach((error, r) => add(rows, r, weight, error, (error - rows.rate[r] * dt) * part + rows.rate[r] * dt, rows.rate[r] * dt));
  }
  for (const c of merged.contacts) {
    const rows = contactRows(start, c);
    rows.error.forEach((error, r) => add(rows, r, CONTACT_WEIGHT, error, error));
  }
  const decay = Math.exp(-DAMPING * dt);
  if (count === 0) return v.map((x) => x * decay);

  const M = inertia(start, new Float64Array(n));
  for (let i = 0; i < n; i++) A[i * n + i] += INERTIA_WEIGHT * M[i];
  const L = factor(A, n);
  const closest = within(L, whole, joints, merged, start, n, []);
  const onward = substitute(L, motion, n);

  // this step's way, braked in time for the caps; a joint its cap still holds back is pinned at
  // what it can do and the rest re-fit around it, so free joints make up for it
  const capped: Pin[] = [];
  let next = v;
  for (let pass = 0; pass < PASSES; pass++) {
    const step = within(L, share, joints, merged, start, n, capped);
    next = v.map((x, i) => (pulled[i] ? step[i] / dt : x * decay));
    let more = false;
    for (const joint of joints) {
      const { d, cap } = joint;
      if (cap === Infinity || (!pulled[d] && !pulled[d + 1] && !pulled[d + 2]) || capped.some((p) => p.d === d)) continue;
      brake(joint, next, closest, onward, dt);
      const a = Math.hypot(next[d] - v[d], next[d + 1] - v[d + 1], next[d + 2] - v[d + 2]) / dt;
      if (a <= cap * (1 + 1e-9)) continue;
      for (let k = d; k < d + 3; k++) next[k] = v[k] + ((next[k] - v[k]) * cap) / a;
      capped.push(...AXES.map((n) => ({ d, n, value: (n.x * next[d] + n.y * next[d + 1] + n.z * next[d + 2]) * dt })));
      more = true;
    }
    if (!more) break;
  }
  return next;
}

/**
 * slows `joint`'s velocity in `rates` to what still stops it at its closest pose under its cap:
 * as fast as its goal moves on by itself (`onward` this step) and `√(2 cap distance)` faster
 */
function brake({ d, cap }: Joint, rates: Float64Array, closest: Float64Array, onward: Float64Array, dt: number): void {
  const speed = Math.hypot(rates[d], rates[d + 1], rates[d + 2]);
  const stop = Math.hypot(onward[d], onward[d + 1], onward[d + 2]) / dt + Math.sqrt(2 * cap * Math.hypot(closest[d], closest[d + 1], closest[d + 2]));
  if (speed <= stop) return;
  for (let k = d; k < d + 3; k++) rates[k] *= stop / speed;
}

/** the displacement `L`'s system gives for `b` under the `fixed` pins, re-fit with the joints it drives past their limits pinned there */
function within(L: Float64Array, b: Float64Array, joints: readonly Joint[], merged: Merged, start: BodyState, n: number, fixed: readonly Pin[]): Float64Array {
  const free = substitute(L, Float64Array.from(b), n);
  const pins = new Map<number, Pin[]>();
  let displacement = free;
  for (let pass = 0; pass < PASSES; pass++) {
    displacement = pinned(L, b, free, [...fixed, ...[...pins.values()].flat()], n);
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
  return displacement;
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
const _q = new Quaternion();
