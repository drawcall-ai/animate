import type { Vector3 } from 'three';
import type { Merged } from './board';
import { inertia, type Block } from './jacobian';
import type { Joint } from './joints';
import { clampRotation } from './limits';
import { solve } from './linear';
import { contactRows } from './rows';
import type { BodyState } from './state';
import type { Contact } from './types';

/**
 * how much heavier, in the projection, a joint at its cap is than a free one, and the root's
 * coordinates than any joint: the free joints meet a contact first, those at their caps next,
 * and the whole body moves last
 */
const STUCK_WEIGHT = 10;
const ROOT_WEIGHT = 100;
/** the projection's damped Gauss–Newton iterations, and the contact error it stops at (in `length`s, rad) */
const ITERATIONS = 12;
const TOLERANCE = 1e-9;

/**
 * Moves `state` onto the winning contacts as closely as they can be met, by damped
 * (Levenberg–Marquardt) Gauss–Newton steps of least mass-weighted change: joints at their caps
 * (`stuck`) heavier, the root the last resort; every joint clamped into its limit and the root
 * within `root` (its translation cap's reach) after each. `trial` is scratch.
 */
export function project(state: BodyState, trial: BodyState, merged: Merged, stuck: readonly Joint[], root: { center: Vector3; radius: number }): void {
  const { contacts, limits } = merged;
  const keep = (s: BodyState) => {
    let moved = clampLimits(s, limits);
    const off = s.position.distanceTo(root.center);
    if (off > root.radius) {
      s.position.sub(root.center).multiplyScalar(root.radius / off).add(root.center);
      moved = true;
    }
    if (moved) s.forward();
  };
  keep(state);
  if (contacts.length === 0) return;
  const M = inertia(state, new Float64Array(state.skeleton.dofs));
  for (const { d } of stuck) for (let k = d; k < d + 3; k++) M[k] *= STUCK_WEIGHT;
  for (let d = 0; d < 6; d++) M[d] *= ROOT_WEIGHT;
  let rows = gather(state, contacts);
  let cost = squares(rows.error);
  let damping = 1e-6;
  for (let it = 0; it < ITERATIONS && cost > TOLERANCE * TOLERANCE; it++) {
    trial.copyPose(state).move(weighted(rows, M, rows.error, damping), 1);
    keep(trial);
    const tried = gather(trial, contacts);
    const c = squares(tried.error);
    if (!(c < cost)) {
      damping *= 10;
      continue;
    }
    state.copyPose(trial);
    rows = tried;
    cost = c;
    damping = Math.max(damping / 10, 1e-9);
  }
}

/**
 * the least mass-weighted change `M⁻¹ Jᵀ (J M⁻¹ Jᵀ + μ I)⁻¹ c` that changes `J`'s rows by `c`,
 * damped by `damping` (μ, relative to the system's mean diagonal)
 */
export function weighted({ rows: J, nz }: Block, M: Float64Array, c: number[], damping: number): Float64Array {
  const m = J.length;
  const inverse = nz.map((d) => 1 / M[d]);
  const S = new Float64Array(m * m);
  let trace = 0;
  for (let i = 0; i < m; i++) {
    for (let j = 0; j <= i; j++) {
      let s = 0;
      for (let a = 0; a < nz.length; a++) s += J[i][a] * J[j][a] * inverse[a];
      S[i * m + j] = S[j * m + i] = s;
    }
    trace += S[i * m + i];
  }
  const mu = damping * (trace / m || 1);
  for (let i = 0; i < m; i++) S[i * m + i] += mu;
  const y = solve(S, Float64Array.from(c), m);
  const out = new Float64Array(M.length);
  for (let i = 0; i < m; i++) for (let a = 0; a < nz.length; a++) out[nz[a]] += J[i][a] * y[i] * inverse[a];
  return out;
}

/** all `contacts`' rows, over the coordinates any of them depends on */
function gather(state: BodyState, contacts: readonly Contact[]): Block & { error: number[] } {
  const all = contacts.map((c) => contactRows(state, c));
  const nz = [...new Set(all.flatMap((r) => r.nz))];
  // each coordinate's place in `nz`
  const at = new Int32Array(state.skeleton.dofs);
  nz.forEach((d, a) => (at[d] = a));
  const rows = all.flatMap((r) =>
    r.rows.map((row) => {
      const wide = new Float64Array(nz.length);
      row.forEach((x, a) => (wide[at[r.nz[a]]] = x));
      return wide;
    }),
  );
  return { nz, rows, error: all.flatMap((r) => r.error) };
}

const squares = (xs: number[]) => xs.reduce((s, x) => s + x * x, 0);

/** clamps every joint into its limit; whether any moved (the positions are left to the caller) */
function clampLimits(state: BodyState, limits: Merged['limits']): boolean {
  let moved = false;
  limits.forEach((l, bone) => {
    if (l && clampRotation(state.local[bone], l)) moved = true;
  });
  return moved;
}

