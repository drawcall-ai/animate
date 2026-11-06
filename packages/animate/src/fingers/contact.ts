import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Triangles } from '../kernel/triangles';
import type { Joints } from './joints';
import { PRESSED } from './closing';
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

/** Where a hand is as its contacts are met (the frame they are given in): its node's position, turn and scale. */
export interface Placed {
  position: Vector3;
  quaternion: Quaternion;
  scale: number;
}

/**
 * `shape` (in place) solved so that each contact's digit meets it and the hand stays out of `near` (the thing's triangles, in the frame
 * the contacts are given in): damped least squares over the touching digits' values, each pulled toward `preferred` (relaxed, pointing,
 * the shape a grip closed to) and kept in range every iteration, every ball of their flesh (`Joints.flesh`) pushed out of `near` as its
 * skin gives (`PRESSED`). `seat`: the hand itself is solved too, from where `hand` places it (moved there, in place), pulled back toward
 * it, its palm and each knuckle kept out of `near` with the touching digits — where the hand sits on what it holds, the arm bringing it
 * there, so a fingertip's contact moves the wrist, the elbow and the shoulder. `swept`: digits whose contacts have moved, started afresh.
 * Returns the contacts' miss (m) as it is left.
 */
export function meet(joints: Joints, hand: Placed, contacts: readonly Contact[], shape: Shape, preferred: Shape, near: Triangles | null, seat = false, swept: readonly Digit[] = []): number {
  const digits = (['thumb', ...DIGITS] as const).filter((digit) => contacts.some((c) => c.part === digit));
  if (!digits.length && !seat) return 0;
  const values = digits.flatMap((digit) => keysOf(digit).map((key) => ({ digit, key, least: leastOf(digit, key) })));
  const free = seat ? 6 : 0, n = free + values.length, x = new Float64Array(n);
  const pulled = values.map((v) => read(preferred, v.digit, v.key));
  const base = { position: hand.position.clone(), quaternion: hand.quaternion.clone() }, matrix = new Matrix4(), scale = new Vector3().setScalar(hand.scale);
  // (how far each contact's pad is off it)
  const off = (c: Contact, facing: Vector3) => joints.pad(c.part, shape, _at, facing, c.round).multiplyScalar(hand.scale).applyQuaternion(hand.quaternion).add(hand.position).sub(c.at);
  // (how far `digit`'s flesh sinks into `near` where `matrix` places the hand, each ball's depth)
  const sunk = (digit: Digit | null, all = true) => {
    const balls = joints.flesh(digit, shape);
    return (all ? balls : balls.slice(0, 1)).map((ball) => near ? Math.max(0, near.depth(ball.at.applyMatrix4(matrix), ball.radius * hand.scale * PRESSED, WITHIN)) : 0);
  };
  // (seating, or for `swept`, each touching digit started from the best of where it is and a sweep of its two main values — a finger's curl
  // and hook, a thumb's oppose and spread — by its own contacts' miss and its flesh sunk in: from where it last lay, along a receiver, a
  // trigger finger could not come round the guard onto the trigger without passing through it)
  matrix.compose(hand.position, hand.quaternion, scale);
  for (const digit of digits) {
    if (!seat && !swept.includes(digit)) continue;
    const cost = () => contacts.reduce((sum, c) => c.part === digit ? sum + off(c, _facing).lengthSq() + (c.facing ? _facing.applyQuaternion(hand.quaternion).distanceToSquared(c.facing) * TURN * TURN : 0) : sum, 0)
      + sunk(digit).reduce((sum, d) => sum + d * d * KEEP * KEEP, 0);
    const [a, b] = digit === 'thumb' ? (['oppose', 'spread'] as const) : (['curl', 'hook'] as const);
    let best = { cost: cost(), a: read(shape, digit, a), b: read(shape, digit, b) };
    for (let i = 0; i <= SWEEP; i++) for (let j = 0; j <= SWEEP; j++) {
      const u = leastOf(digit, a) + ((1 - leastOf(digit, a)) * i) / SWEEP, v = leastOf(digit, b) + ((1 - leastOf(digit, b)) * j) / SWEEP;
      write(shape, digit, a, u);
      write(shape, digit, b, v);
      const now = cost();
      if (now < best.cost) best = { cost: now, a: u, b: v };
    }
    write(shape, digit, a, best.a);
    write(shape, digit, b, best.b);
  }
  values.forEach((v, j) => (x[free + j] = read(shape, v.digit, v.key)));
  // (the hand as `x` places it: moved and turned off where it started)
  const place = (x: Float64Array) => {
    if (!seat) return;
    hand.position.copy(base.position).add(_move.set(x[0], x[1], x[2]));
    const angle = Math.hypot(x[3], x[4], x[5]);
    hand.quaternion.copy(base.quaternion);
    if (angle > 1e-12) hand.quaternion.premultiply(_turn.setFromAxisAngle(_axis.set(x[3] / angle, x[4] / angle, x[5] / angle), angle));
  };
  const residual = (x: Float64Array, out: number[]) => {
    out.length = 0;
    values.forEach((v, j) => write(shape, v.digit, v.key, x[free + j]));
    place(x);
    for (const c of contacts) {
      const at = off(c, _facing);
      out.push(at.x, at.y, at.z);
      if (!c.facing) continue;
      const turned = _facing.applyQuaternion(hand.quaternion).sub(c.facing).multiplyScalar(TURN);
      out.push(turned.x, turned.y, turned.z);
    }
    values.forEach((_, j) => out.push((x[free + j] - pulled[j]) * PULL));
    if (seat) for (let j = 0; j < 6; j++) out.push(x[j] * (j < 3 ? HELD.move : HELD.turn));
    matrix.compose(hand.position, hand.quaternion, scale);
    for (const part of seat ? [null, 'thumb', ...DIGITS] as const : digits) for (const depth of sunk(part, part === null || digits.includes(part))) out.push(depth * KEEP);
  };
  const r: number[] = [], moved: number[] = [];
  for (let iteration = 0; iteration < (seat ? SEATING : ITERATIONS); iteration++) {
    residual(x, r);
    const m = r.length, jacobian = new Float64Array(m * n);
    for (let j = 0; j < n; j++) {
      const was = x[j], h = j >= free ? STEP.digit : j < 3 ? STEP.move : STEP.turn;
      x[j] = was + h;
      residual(x, moved);
      x[j] = was;
      for (let i = 0; i < m; i++) jacobian[i * n + j] = (moved[i] - r[i]) / h;
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
    for (let j = 0; j < free; j++) x[j] += step[j];
    values.forEach((v, j) => (x[free + j] = Math.min(1, Math.max(v.least, x[free + j] + step[free + j]))));
  }
  residual(x, r);
  return contacts.length ? Math.max(...contacts.map((c) => off(c, _facing).length())) : 0;
}

/** how much a unit of a pad's facing off its contact's weighs against a metre off it: as 1 cm, so it presses with its flat */
const TURN = 0.01;
/** how much a unit of a digit's value off its preferred weighs against a metre off a contact (pulled toward it, not held to it) */
const PULL = 0.008;
/** how much a metre and a radian of a seated hand off where its grip put it weigh against a metre off a contact: it moves for what its
 * digits cannot reach and what it would sink into, not on its own */
const HELD = { move: 0.5, turn: 0.1 } as const;
/** how much a metre of flesh sunk into what the hand touches weighs against a metre off a contact (a contact the digits cannot meet
 * clear of it pulls them in a hundredth of its miss), and how far in from a surface a ball is still found inside it (m) */
const KEEP = 10, WITHIN = 0.03;
/** how many steps across its range each of a digit's two main values is swept in, to start it from */
const SWEEP = 5;
/** the solve's iterations each sub-step, and seating a hand; its finite steps (m, rad, a digit's value) and its damping */
const ITERATIONS = 4, SEATING = 12, STEP = { move: 1e-4, turn: 1e-3, digit: 1e-3 } as const, DAMPING = 1e-7;

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

const _at = new Vector3(), _facing = new Vector3(), _move = new Vector3(), _axis = new Vector3(), _turn = new Quaternion();
