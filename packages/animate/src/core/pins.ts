import { Quaternion, Vector3 } from 'three';
import type { Merged } from './board';
import type { Joint } from './joints';
import { clampRotation } from './limits';
import { backward, forward, solve, substitute } from './linear';
import { exp, log } from './rotation';
import type { BodyState } from './state';

/** how often the soft solve re-fits around joints that it drove past their limit */
const PASSES = 4;

/**
 * A linear condition on the soft solve's displacement, `column · Δq = value`: a joint held along a
 * way (`joint`: its first coordinate and the way, in its coordinates), or the centre of mass along
 * an axis. `column` is zero before `from`; `z` caches `L⁻¹ column` (L the fit's factor).
 */
export interface Pin {
  column: Float64Array;
  from: number;
  value: number;
  joint?: { d: number; n: Vector3 };
  z?: Float64Array;
}

/** joint `d` (its first coordinate) held to `value` along the way `n`, over `size` coordinates */
export function jointPin(d: number, n: Vector3, value: number, size: number): Pin {
  const column = new Float64Array(size);
  column[d] = n.x;
  column[d + 1] = n.y;
  column[d + 2] = n.z;
  return { column, from: d, value, joint: { d, n } };
}

/**
 * the displacement `L`'s system gives for `b` under the `fixed` pins, re-fit with the joints it
 * drives past their limits pinned there; and all the pins it was fit under
 */
export function within(L: Float64Array, b: Float64Array, joints: readonly Joint[], merged: Merged, start: BodyState, fixed: readonly Pin[]): { displacement: Float64Array; pins: Pin[] } {
  const n = start.skeleton.dofs;
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
      if (was.length === 3 || fixed.some((p) => p.joint?.d === joint.d)) continue;
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
  for (const p of was) if (p.joint) cut.addScaledVector(p.joint.n, -p.joint.n.dot(cut));
  if (cut.length() < 1e-9) return was;
  const n = cut.normalize();
  return [...was, jointPin(d, n, n.dot(r), displacement.length)];
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

/**
 * the displacement `free` (= A⁻¹ `b`, `L` A's factor) under the pins: the least-squares fit's
 * minimum with every pin's condition `C Δq = c` met, by Lagrange multipliers:
 * (C A⁻¹ Cᵀ) λ = C free − c, Δq = A⁻¹ (b − Cᵀ λ), with C A⁻¹ Cᵀ = (L⁻¹ Cᵀ)ᵀ (L⁻¹ Cᵀ)
 */
export function pinned(L: Float64Array, b: Float64Array, free: Float64Array, pins: readonly Pin[], n: number): Float64Array {
  const k = pins.length;
  if (k === 0) return Float64Array.from(free);
  const zs = pins.map((p) => (p.z ??= forward(L, Float64Array.from(p.column), n, p.from)));
  const S = new Float64Array(k * k);
  const rhs = new Float64Array(k);
  let trace = 0;
  pins.forEach((p, i) => {
    for (let j = 0; j <= i; j++) {
      // (both zero before the later pin's first coordinate)
      let s = 0;
      for (let d = Math.max(p.from, pins[j].from); d < n; d++) s += zs[i][d] * zs[j][d];
      S[i * k + j] = S[j * k + i] = s;
    }
    trace += S[i * k + i];
    let c = 0;
    for (let d = p.from; d < n; d++) c += p.column[d] * free[d];
    rhs[i] = c - p.value;
  });
  // (pins that ask the same twice stay solvable)
  for (let i = 0; i < k; i++) S[i * k + i] += 1e-12 * (trace / k);
  const lambda = solve(S, rhs, k);
  const pushed = Float64Array.from(b);
  pins.forEach((p, i) => {
    for (let d = p.from; d < n; d++) pushed[d] -= lambda[i] * p.column[d];
  });
  return backward(L, forward(L, pushed, n), n);
}

const _p = new Quaternion();
const _q = new Quaternion();
