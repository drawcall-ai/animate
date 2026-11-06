import { Matrix4, Quaternion, Vector3 } from 'three';
import { limited } from '../kernel/limits';
import type { Pose } from '../kernel/pose';
import type { Joints } from './joints';
import { DIGITS, LIFTED, SPLAYED, type Digit, type Shape } from './shape';

/**
 * A part of a hand on a thing (world): the palm's middle, the handle's line (where a handle of `radius` lies across the palm in its grasp), or a
 * digit's pad — the point of its fingertip `round` off its length (`Joints.pad`) — at `at`, facing `facing` and its grasp line along `axis`
 * (toward the thumb), where given.
 */
export interface Contact {
  part: Digit | 'palm' | 'handle';
  at: Vector3;
  facing?: Vector3;
  axis?: Vector3;
  radius?: number;
  round?: number;
}

/** The arm a contact solve moves with the fingers: its bones in `pose` from the upper arm to the hand, and the hand node's rest turn and
 * scale (its rotation is the hand bone's times `rest`). None: the hand stays where its node is (a hand its app poses). */
export interface Arm {
  pose: Pose;
  /** the hand's bone, and the bones it moves from the upper arm down to it (none: the hand stays as the pose has it) */
  hand: number;
  bones: readonly number[];
  rest: Readonly<Quaternion>;
  scale: number;
  /** how much of the solved turns its joints take (0 … 1: the pose's as it stands … met), eased in as a hold begins (default 1) */
  weight?: number;
}

/**
 * `shape` (in place) and `arm`'s joints (in its pose) solved together so that every contact is met, as one chain from the shoulder to
 * each fingertip: damped least squares over the arm's joints' turns and the touching digits' values, each pulled toward where it starts
 * — the arm as its reach posed it, a digit toward `preferred` (relaxed, pointing, the shape a grip closed to) — so the arm gives a little
 * where the fingers cannot reach and the fingers take up the rest; each joint kept within its range every iteration. Returns the
 * contacts' miss (m) as it is left.
 */
export function meet(joints: Joints, arm: Arm | null, contacts: readonly Contact[], shape: Shape, preferred: Shape): number {
  if (!contacts.length) return 0;
  const digits = (['thumb', ...DIGITS] as const).filter((digit) => contacts.some((c) => c.part === digit));
  const values = digits.flatMap((digit) => keysOf(digit).map((key) => ({ digit, key, least: digit === 'thumb' ? (key === 'curl' ? 0 : SPLAYED) : key === 'curl' ? LIFTED : 0 })));
  const turns = arm ? arm.bones.length * 3 : 0, n = turns + values.length;
  const start = arm ? arm.bones.map((bone) => arm.pose.local(bone).clone()) : [];
  const locals = start.map((q) => q.clone());
  const x = new Float64Array(n);
  values.forEach((v, j) => (x[turns + j] = read(shape, v.digit, v.key)));
  const pulled = values.map((v) => read(preferred, v.digit, v.key));
  // (the hand node in the world as `x` has the arm: from the pose, or where its node stands)
  const hand = { position: new Vector3(), rotation: new Quaternion(), scale: 1 };
  const node = new Matrix4();
  const place = (x: Float64Array) => {
    if (!arm) {
      joints.hand.updateWorldMatrix(true, false);
      node.copy(joints.hand.matrixWorld).decompose(hand.position, hand.rotation, _s);
      hand.scale = _s.x;
      return;
    }
    const { pose, bones } = arm, skeleton = pose.skeleton;
    if (!bones.length) {
      hand.position.copy(pose.position(arm.hand));
      hand.rotation.copy(pose.rotation(arm.hand)).multiply(arm.rest);
      hand.scale = arm.scale;
      return;
    }
    hand.position.copy(pose.position(bones[0]));
    hand.rotation.copy(pose.rotation(skeleton.bones[bones[0]].parent));
    bones.forEach((bone, k) => {
      if (k > 0) hand.position.add(_v.copy(skeleton.bones[bone].offset).applyQuaternion(hand.rotation));
      hand.rotation.multiply(_q.copy(locals[k]).multiply(spin(x, 3 * k, _r)));
    });
    hand.rotation.multiply(arm.rest);
    hand.scale = arm.scale;
  };
  const residual = (x: Float64Array, out: number[]) => {
    out.length = 0;
    values.forEach((v, j) => write(shape, v.digit, v.key, x[turns + j]));
    place(x);
    for (const c of contacts) {
      const part = partOf(joints, c, shape, hand.scale);
      const at = part.at.multiplyScalar(hand.scale).applyQuaternion(hand.rotation).add(hand.position).sub(c.at);
      out.push(at.x, at.y, at.z);
      if (c.facing) {
        const off = part.facing.applyQuaternion(hand.rotation).sub(c.facing).multiplyScalar(c.part === 'palm' || c.part === 'handle' ? TURN.hand : TURN.pad);
        out.push(off.x, off.y, off.z);
      }
      if (c.axis) {
        const off = part.axis.applyQuaternion(hand.rotation).sub(c.axis).multiplyScalar(TURN.hand);
        out.push(off.x, off.y, off.z);
      }
    }
    for (let j = 0; j < turns; j++) out.push(x[j] * (j >= turns - 3 ? PULL.wrist : PULL.arm));
    values.forEach((_, j) => out.push((x[turns + j] - pulled[j]) * PULL.finger));
  };
  const r: number[] = [], moved: number[] = [];
  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    residual(x, r);
    const m = r.length, jacobian = new Float64Array(m * n);
    for (let j = 0; j < n; j++) {
      const was = x[j], h = j < turns ? 1e-4 : 1e-3;
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
    for (let j = 0; j < n; j++) x[j] += step[j];
    // (each joint within its range: an arm's turn clamped into its limit, folded into its rest, a digit's value into its own)
    if (arm) arm.bones.forEach((bone, k) => {
      locals[k].multiply(spin(x, 3 * k, _r)).normalize();
      limited(arm.pose.skeleton, bone, locals[k]);
      x[3 * k] = x[3 * k + 1] = x[3 * k + 2] = 0;
    });
    values.forEach((v, j) => (x[turns + j] = Math.min(1, Math.max(v.least, x[turns + j]))));
  }
  residual(x, r);
  if (arm) arm.bones.forEach((bone, k) => arm.pose.setLocal(bone, locals[k], arm.weight ?? 1));
  // (the miss: the contacts' positions alone)
  place(x);
  return Math.max(...contacts.map((c) => {
    const part = partOf(joints, c, shape, hand.scale);
    const at = part.at.multiplyScalar(hand.scale).applyQuaternion(hand.rotation).add(hand.position).sub(c.at);
    return at.length();
  }));
}

/** where `contact`'s part of the hand is as `shape` has it, the way it faces and its grasp line, in the hand's frame (`scale`: the hand's
 * world scale, a handle's radius given in the world's metres) */
function partOf(joints: Joints, contact: Contact, shape: Shape, scale: number) {
  if (contact.part === 'handle') return joints.handle((contact.radius ?? 0) / scale);
  return joints.touch(contact.part === 'palm' ? null : contact.part, shape, contact.round);
}

/** how much a unit of a part's facing or grasp line off its contact's weighs against a metre off it: the hand's as 2 mm, so it turns only
 * as far as the arm lets it; a pad's as 1 cm, so it presses with its flat */
const TURN = { hand: 0.002, pad: 0.01 } as const;
/** how much a radian of an arm's joint (its hand's, `wrist`), or a unit of a digit's value, off where it starts weighs against a metre
 * off a contact (each joint pulled toward its preferred pose, not held to it) */
const PULL = { arm: 0.05, wrist: 0.02, finger: 0.008 } as const;
/** the solve's iterations each sub-step, and its damping */
const ITERATIONS = 4, DAMPING = 1e-7;

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

/** the turn of the rotation vector at `x[k]` (into `out`) */
function spin(x: Float64Array, k: number, out: Quaternion): Quaternion {
  const angle = Math.hypot(x[k], x[k + 1], x[k + 2]);
  if (angle < 1e-12) return out.identity();
  return out.setFromAxisAngle(_axis.set(x[k] / angle, x[k + 1] / angle, x[k + 2] / angle), angle);
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

const _v = new Vector3(), _q = new Quaternion(), _r = new Quaternion(), _s = new Vector3(), _axis = new Vector3();
