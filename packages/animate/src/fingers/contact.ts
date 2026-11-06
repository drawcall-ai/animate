import { Quaternion, Vector3 } from 'three';
import type { Joints } from './joints';
import { DIGITS, LIFTED, SPLAYED, type Digit, type Shape } from './shape';

/**
 * A digit's pad on a thing (world): the point of its fingertip `round` off its length (`Joints.pad`) at `at`, facing `facing` where given.
 */
export interface Contact {
  part: Digit;
  at: Vector3;
  facing?: Vector3;
  round?: number;
}

/** Where a hand is in the world as its contacts are met: its node's position, turn and scale. */
export interface Placed {
  position: Vector3;
  quaternion: Quaternion;
  scale: number;
}

/**
 * `shape` (in place) solved so that each contact's digit meets it, the hand where `hand` places it — the hand is placed by its hold, as
 * the arm keeps it on its grip; moved here too, for its digits, it went through the rifle on a flick, chasing what the arm had left: damped
 * least squares over the touching digits' values, each pulled toward `preferred` (relaxed, pointing, the shape a grip closed to) and kept
 * in range every iteration. Returns the contacts' miss (m) as it is left.
 */
export function meet(joints: Joints, hand: Placed, contacts: readonly Contact[], shape: Shape, preferred: Shape): number {
  if (!contacts.length) return 0;
  const digits = (['thumb', ...DIGITS] as const).filter((digit) => contacts.some((c) => c.part === digit));
  const values = digits.flatMap((digit) => keysOf(digit).map((key) => ({ digit, key, least: digit === 'thumb' ? (key === 'curl' ? 0 : SPLAYED) : key === 'curl' ? LIFTED : 0 })));
  const n = values.length, x = new Float64Array(n);
  values.forEach((v, j) => (x[j] = read(shape, v.digit, v.key)));
  const pulled = values.map((v) => read(preferred, v.digit, v.key));
  // (how far each contact's pad is off it, in the world)
  const off = (c: Contact, facing: Vector3) => joints.pad(c.part, shape, _at, facing, c.round).multiplyScalar(hand.scale).applyQuaternion(hand.quaternion).add(hand.position).sub(c.at);
  const residual = (x: Float64Array, out: number[]) => {
    out.length = 0;
    values.forEach((v, j) => write(shape, v.digit, v.key, x[j]));
    for (const c of contacts) {
      const at = off(c, _facing);
      out.push(at.x, at.y, at.z);
      if (!c.facing) continue;
      const turned = _facing.applyQuaternion(hand.quaternion).sub(c.facing).multiplyScalar(TURN);
      out.push(turned.x, turned.y, turned.z);
    }
    values.forEach((_, j) => out.push((x[j] - pulled[j]) * PULL));
  };
  const r: number[] = [], moved: number[] = [];
  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    residual(x, r);
    const m = r.length, jacobian = new Float64Array(m * n);
    for (let j = 0; j < n; j++) {
      const was = x[j];
      x[j] = was + STEP;
      residual(x, moved);
      x[j] = was;
      for (let i = 0; i < m; i++) jacobian[i * n + j] = (moved[i] - r[i]) / STEP;
    }
    // (JᵀJ + λ) Δ = −Jᵀ r
    const a = new Float64Array(n * n), b = new Float64Array(n);
    for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) {
      const jij = jacobian[i * n + j];
      if (jij === 0) continue;
      b[j] -= jij * r[i];
      for (let k = 0; k < n; k++) a[j * n + k] += jij * jacobian[i * n + k];
    }
    for (let j = 0; j < n; j++) a[j * n + j] += DAMPING;
    const step = solved(a, b, n);
    if (!step.every(Number.isFinite)) break;
    values.forEach((v, j) => (x[j] = Math.min(1, Math.max(v.least, x[j] + step[j]))));
  }
  values.forEach((v, j) => write(shape, v.digit, v.key, x[j]));
  return Math.max(...contacts.map((c) => off(c, _facing).length()));
}

/** how much a unit of a pad's facing off its contact's weighs against a metre off it: as 1 cm, so it presses with its flat */
const TURN = 0.01;
/** how much a unit of a digit's value off its preferred weighs against a metre off a contact (pulled toward it, not held to it) */
const PULL = 0.008;
/** the solve's iterations each sub-step, its finite step and its damping */
const ITERATIONS = 4, STEP = 1e-3, DAMPING = 1e-7;

function keysOf(digit: Digit) {
  return digit === 'thumb' ? (['curl', 'oppose', 'spread'] as const) : (['curl', 'hook', 'spread'] as const);
}

function read(shape: Shape, digit: Digit, key: 'curl' | 'hook' | 'spread' | 'oppose'): number {
  if (digit === 'thumb') return key === 'hook' ? 0 : shape.thumb[key];
  return key === 'oppose' ? 0 : shape[digit][key];
}

function write(shape: Shape, digit: Digit, key: 'curl' | 'hook' | 'spread' | 'oppose', value: number): void {
  if (digit === 'thumb') {
    if (key !== 'hook') shape.thumb[key] = value;
  } else if (key !== 'oppose') shape[digit][key] = value;
}

/** `a` x = `b` (`n` × `n`, row-major) by Gaussian elimination with partial pivoting, in place */
function solved(a: Float64Array, b: Float64Array, n: number): Float64Array {
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r * n + c]) > Math.abs(a[pivot * n + c])) pivot = r;
    if (pivot !== c) {
      for (let k = 0; k < n; k++) [a[c * n + k], a[pivot * n + k]] = [a[pivot * n + k], a[c * n + k]];
      [b[c], b[pivot]] = [b[pivot], b[c]];
    }
    const d = a[c * n + c];
    if (Math.abs(d) < 1e-15) continue;
    for (let r = c + 1; r < n; r++) {
      const f = a[r * n + c] / d;
      if (f === 0) continue;
      for (let k = c; k < n; k++) a[r * n + k] -= f * a[c * n + k];
      b[r] -= f * b[c];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r];
    for (let k = r + 1; k < n; k++) sum -= a[r * n + k] * x[k];
    const d = a[r * n + r];
    x[r] = Math.abs(d) < 1e-15 ? 0 : sum / d;
  }
  return x;
}

const _at = new Vector3(), _facing = new Vector3();
