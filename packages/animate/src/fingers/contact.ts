import { Matrix4, Vector3 } from 'three';
import type { Triangles } from '../kernel/triangles';
import type { Joints } from './joints';
import { PAD_DEPTH } from './closing';
import type { Placed } from '../kernel/scene';
import { DIGITS, LIFTED, SPLAYED, type Digit, type Shape } from './shape';

/**
 * A digit's pad on a thing: the point of its fingertip `round` off its length (`Joints.pad`) at `at`, facing `facing` where given.
 */
export interface Contact {
  part: Digit;
  at: Vector3;
  facing?: Vector3;
  round?: number;
}

/**
 * `shape` (in place) solved so that each contact's digit meets it, the hand where `hand` places it (in the frame the contacts are given
 * in), staying out of `near` (the thing's triangles there): damped least squares over the touching digits' values, each pulled toward
 * `preferred` (the shape the hand closed to) and kept in range every iteration, every ball of their flesh (`Joints.flesh`) pushed out of
 * `near` as its skin gives (`PAD_DEPTH`). The hand is not moved: a digit reaches what it can from where the hand is. `swept`: digits
 * whose contacts have moved, started afresh. Returns the contacts' miss (m) as it is left.
 */
export function meet(joints: Joints, hand: Placed, contacts: readonly Contact[], shape: Shape, { preferred, near, swept = [] }: Meeting): number {
  const digits = (['thumb', ...DIGITS] as const).filter((digit) => contacts.some((c) => c.part === digit));
  if (!digits.length) return 0;
  const values = digits.flatMap((digit) => keysOf(digit).map((key) => ({ digit, key, least: leastOf(digit, key) })));
  const n = values.length, x = new Float64Array(n);
  const pulled = values.map((v) => read(preferred, v.digit, v.key));
  const matrix = new Matrix4().compose(hand.position, hand.quaternion, new Vector3().setScalar(hand.scale));
  // (how far each contact's pad is off it)
  const off = (c: Contact, facing: Vector3) => joints.pad(c.part, shape, _at, facing, c.round).multiplyScalar(hand.scale).applyQuaternion(hand.quaternion).add(hand.position).sub(c.at);
  // (how far `digit`'s flesh sinks into `near`, each ball's depth)
  // (its last segment's balls left out: its pad is pressed on the contact's face, the segment lying along it)
  const sunk = (digit: Digit) => joints.flesh(digit, shape).slice(0, -3).map((ball) => near ? Math.max(0, near.depth(ball.at.applyMatrix4(matrix), ball.radius * hand.scale * PAD_DEPTH, WITHIN)) : 0);
  // (for `swept`, each touching digit started from the best of where it is and a sweep of all three of its values — by its own contacts'
  // miss and its flesh sunk in: from where it last lay, along a receiver, a trigger finger could not come round the guard onto the
  // trigger without passing through it; swept in its curl and hook alone, its fan held as it lay, it stopped 2 cm short on the receiver)
  for (const digit of digits) {
    if (!swept.includes(digit)) continue;
    const cost = () => contacts.reduce((sum, c) => c.part === digit ? sum + off(c, _facing).lengthSq() + (c.facing ? _facing.applyQuaternion(hand.quaternion).distanceToSquared(c.facing) * TURN * TURN : 0) : sum, 0)
      + sunk(digit).reduce((sum, d) => sum + d * d * KEEP * KEEP, 0);
    const keys = keysOf(digit), steps = (key: (typeof keys)[number]) => Array.from({ length: SWEEP + 1 }, (_, i) => leastOf(digit, key) + ((1 - leastOf(digit, key)) * i) / SWEEP);
    let best = { cost: cost(), values: keys.map((key) => read(shape, digit, key)) };
    for (const u of steps(keys[0])) for (const v of steps(keys[1])) for (const w of steps(keys[2])) {
      [u, v, w].forEach((value, k) => write(shape, digit, keys[k], value));
      const now = cost();
      if (now < best.cost) best = { cost: now, values: [u, v, w] };
    }
    best.values.forEach((value, k) => write(shape, digit, keys[k], value));
  }
  values.forEach((v, j) => (x[j] = read(shape, v.digit, v.key)));
  // (a finger already on its contact, followed on: fanned as it was, its joints taking up how the contact moves, so a small move of the
  // contact does not swing the tip sideways)
  const weights = values.map((v, j) => {
    const held = v.key === 'spread' && v.digit !== 'thumb' && !swept.includes(v.digit);
    if (held) pulled[j] = x[j];
    return held ? PULL * FAN : PULL;
  });
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
    values.forEach((_, j) => out.push((x[j] - pulled[j]) * weights[j]));
    for (const digit of digits) for (const depth of sunk(digit)) out.push(depth * KEEP);
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
  residual(x, r);
  return Math.max(...contacts.map((c) => off(c, _facing).length()));
}

/** How `meet` solves: the shape the touching digits are pulled toward, what the hand stays out of, and the digits started afresh. */
interface Meeting {
  preferred: Shape;
  near: Triangles | null;
  swept?: readonly Digit[];
}

/** how much a unit of a pad's facing off its contact's weighs against a metre off it: as 1 cm, so it presses with its flat */
const TURN = 0.01;
/** how much a unit of a digit's value off its preferred weighs against a metre off a contact (pulled toward it, not held to it) */
const PULL = 0.008;
/** how much more a finger's fan off where it was weighs, followed on along its contact (see `meet`) */
const FAN = 8;
/** how much a metre of flesh sunk into what the hand touches weighs against a metre off a contact (a contact the digits cannot meet
 * clear of it pulls them in a hundredth of its miss), and how far in from a surface a ball is still found inside it (m) */
const KEEP = 10, WITHIN = 0.03;
/** how many steps across its range each of a digit's values is swept in, to start it from */
const SWEEP = 8;
/** the solve's iterations each sub-step; its finite step (a digit's value) and its damping */
const ITERATIONS = 4, STEP = 1e-3, DAMPING = 1e-7;

/** the least `key` of `digit` goes (see `Finger`, `Thumb`) */
function leastOf(digit: Digit, key: 'curl' | 'hook' | 'spread' | 'oppose'): number {
  return digit === 'thumb' ? (key === 'curl' ? 0 : SPLAYED) : key === 'curl' ? LIFTED : 0;
}

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
