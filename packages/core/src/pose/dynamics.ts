import { Matrix4, Quaternion, Vector3 } from 'three';
import { framePoint } from '../math';
import { BONES, CHILD_BONES, PARENT, REST_HINGE, SIDE_BONES, perBone, type BoneName, type ChildBone, type LimbBone } from './bones';
import type { Landmark, Pose } from './pose';
import { beyondRange, limitRotations, zzParts } from './limits';
export const zzLogD: string[] = [];
export const zzRaw: { t: number; on: boolean; worst: Record<string, { v: number; t: number; p: number[] }> } = { t: 0, on: false, worst: {} };
const zzPrev = new Quaternion();
import { createRotations, type Rotations } from './rotations';

const DEG = Math.PI / 180;

/**
 * Each joint as a torque-limited servo: the most it speeds up or slows down (°/s²) and how
 * quickly a jump it did not follow settles back onto the solved pose (1/s). Heavier, proximal
 * segments are slower than distal ones; nothing human reaches its top speed (an elite throw's
 * ~2000–7000°/s) in much less than the ~50 ms around a release.
 */
const JOINT = {
  trunk: { accel: 10e3, settle: 8 },
  neck: { accel: 15e3, settle: 10 },
  clavicle: { accel: 15e3, settle: 10 },
  shoulder: { accel: 20e3, settle: 10 },
  elbow: { accel: 30e3, settle: 13 },
  wrist: { accel: 40e3, settle: 16 },
  hip: { accel: 20e3, settle: 9 },
  knee: { accel: 30e3, settle: 12 },
  ankle: { accel: 30e3, settle: 15 },
} as const;
const JOINT_OF: Record<BoneName, keyof typeof JOINT> = {
  hips: 'trunk',
  spine: 'trunk',
  chest: 'trunk',
  neck: 'neck',
  head: 'neck',
  leftShoulder: 'clavicle',
  rightShoulder: 'clavicle',
  leftUpperArm: 'shoulder',
  rightUpperArm: 'shoulder',
  leftLowerArm: 'elbow',
  rightLowerArm: 'elbow',
  leftHand: 'wrist',
  rightHand: 'wrist',
  leftUpperLeg: 'hip',
  rightUpperLeg: 'hip',
  leftLowerLeg: 'knee',
  rightLowerLeg: 'knee',
  leftFoot: 'ankle',
  rightFoot: 'ankle',
  leftToes: 'ankle',
  rightToes: 'ankle',
};

/**
 * how far a limb's end is held where the solver put it (0 free … 1 exactly): its position and
 * rotation; and how far it bears weight where it stands (a planted foot: its joints as solved,
 * whatever their ranges — the stance keeps it in them, not a foot sliding off its hold)
 */
export interface Hold {
  at: number;
  turn: number;
  bear: number;
}

/** what the dynamics keep as solved: [left, right] arms and legs, and the trunk, neck and head (tracked) */
export interface Holds {
  arms: [Hold, Hold];
  legs: [Hold, Hold];
  body: number;
}

export const createHolds = (): Holds => ({ arms: [newHold(), newHold()], legs: [newHold(), newHold()], body: 0 });
const newHold = (): Hold => ({ at: 0, turn: 0, bear: 0 });

/**
 * Each joint's state, in one array (no three.js call takes a number, which V8 would box on
 * every tick): the solved rotation last tick (quaternion) and its angular velocity (rad/s, in
 * its own frame); the output's offset off the solve (rotation vector, rad) and how fast that
 * changes; the output, the one before, and how fast it turns.
 */
const RAW = 0;
const W = 4;
const O = 7;
const U = 10;
const OUT = 13;
const PREV = 17;
const V = 21;
const STATE = 24;
type State = Float64Array;

const LIMBS = [0, 1].flatMap((s) => {
  const b = SIDE_BONES[s];
  return [
    { side: s, arm: true, root: b.shoulder, upper: b.upperArm, lower: b.lowerArm, end: b.hand },
    { side: s, arm: false, root: null, upper: b.upperLeg, lower: b.lowerLeg, end: b.foot },
  ] as const;
});

/**
 * The joints' dynamics, after the solve: each joint follows its solved rotation exactly while
 * that moves like a body can, and absorbs what it cannot follow — a solved pose that jumps
 * (a mode switch, a pole flip, a clamp) or speeds up faster than the joint's limit — as an
 * offset that settles on a critically damped spring (inertialization, Bollo 2018, run per
 * joint on every tick instead of at known switches). What is held stays put: the limbs are
 * bent back onto their held ends (two-bone, keeping the joints' swivel and twist), and the
 * tracked trunk and head follow the solve.
 */
export class Dynamics {
  private readonly state = perBone((): State => new Float64Array(STATE));
  private started = false;
  /** the solved world rotations, each bone's origin in its parent's solved frame, and the output's world rotations */
  private readonly rawWorld = createRotations();
  private readonly offsets = perBone(() => new Vector3());
  private readonly world = createRotations();
  private readonly out = createRotations();
  /** how far each joint is kept in its range (0 … 1), and whether the output was moved into it */
  private readonly range = perBone(() => 1);
  private readonly limited = perBone(() => false);

  /**
   * Moves `pose` (as solved) by the joints' dynamics over `dt` into the joints' ranges
   * (limits.ts), keeping `holds`; `dt` 0 restarts them (on the next tick's pose).
   */
  apply(pose: Pose, holds: Holds, landmarks: readonly Landmark[], dt: number) {
    const { rotations: raw, joints } = pose;
    const { world, state, out, limited } = this;
    // (the first tick on input starts on its pose: whatever the body was before has not been seen)
    const start = dt <= 0 || !this.started;
    if (start) this.started = dt > 0;
    zzLogD.push(`raw ${(beyondRange('leftUpperArm', raw.leftUpperArm) * 57.3).toFixed(0)} d ${(raw.leftUpperArm.angleTo(zzPrev) * 57.3).toFixed(1)} o ${(Math.hypot(state.leftUpperArm[O], state.leftUpperArm[O+1], state.leftUpperArm[O+2]) * 57.3).toFixed(0)}`); zzPrev.copy(raw.leftUpperArm);
    if (zzRaw.on) for (const b of CHILD_BONES) { const v = beyondRange(b, raw[b]) * 57.3; if (v > (zzRaw.worst[b]?.v ?? 0.5)) zzRaw.worst[b] = { v, t: zzRaw.t, p: zzParts().map((x) => Math.round(x * 57.3)) }; }
    const moved = !start && this.follow(raw, dt);
    zzLogD.push(`fol ${(beyondRange('leftUpperArm', this.out.leftUpperArm) * 57.3).toFixed(0)}`);
    if (start) for (const b of BONES) out[b].copy(raw[b]);
    if (holds.body > 0) for (const b of BODY) out[b].slerp(raw[b], holds.body);
    // into the joints' ranges, all but a weight-bearing leg's: a held limb is bent back onto its end
    // and kept in its ranges, missing what it cannot reach in them; a limb taking weight or letting
    // go of it comes into or out of its ranges over LET_GO s
    const { range } = this;
    for (const b of BONES) {
      _free[b] = 1;
      limited[b] = false;
    }
    for (const l of LIMBS) {
      const h = l.arm ? holds.arms[l.side] : holds.legs[l.side];
      _free[l.upper] = _free[l.lower] = _free[l.end] = 1 - h.bear;
    }
    for (const b of BONES) range[b] = start ? _free[b] : range[b] + Math.max(-dt / LET_GO, Math.min(dt / LET_GO, _free[b] - range[b]));
    const changed = limitRotations(out, range, limited) || moved;
    if (changed) {
      this.hold(raw, joints, holds);
      if (limitRotations(out, range, limited)) {
        chain(out, world);
        place(world, this.offsets, joints.hips, joints);
      }
      for (const l of landmarks) {
        world[l.bone].toArray(_s, 0);
        rotate(joints[l.name].copy(l.at)).add(joints[l.bone]);
      }
    }
    zzLogD.push(`out ${(beyondRange('leftUpperArm', out.leftUpperArm) * 57.3).toFixed(0)}`);
    if (!start) {
      if (changed) this.keep(raw, holds, dt);
      return;
    }
    for (const b of BONES) {
      const st = state[b];
      st.fill(0);
      raw[b].toArray(st, RAW);
      out[b].toArray(st, OUT);
      raw[b].copy(out[b]);
    }
  }

  /** each joint follows its solve (into `out`); whether any is off it */
  private follow(raw: Rotations, dt: number): boolean {
    let moved = false;
    for (const b of BONES) moved = follow(this.state[b], raw[b], JOINT[JOINT_OF[b]], dt, this.out[b]) || moved;
    return moved;
  }

  /** the solved world rotations, and each bone's origin in its parent's solved frame */
  private measure(raw: Rotations, joints: Pose['joints']) {
    const { rawWorld, offsets } = this;
    chain(raw, rawWorld);
    for (const b of CHILD_BONES) offsets[b].subVectors(joints[b], joints[PARENT[b]]).applyQuaternion(_q.copy(rawWorld[PARENT[b]]).invert());
  }

  /** the output with what is held put back where solved (`world`, and the bones' origins into `joints`) */
  private hold(raw: Rotations, joints: Pose['joints'], holds: Holds) {
    const { offsets, out, world } = this;
    this.measure(raw, joints);
    chain(out, world);
    place(world, offsets, joints.hips, _pos);
    for (const l of LIMBS) {
      const h = l.arm ? holds.arms[l.side] : holds.legs[l.side];
      if (h.at <= 0 && h.turn <= 0) continue;
      this.bend(l.upper, l.lower, l.end, h, joints[l.end]);
      toLocal(world, l.upper, out);
      toLocal(world, l.lower, out);
      toLocal(world, l.end, out);
    }
    chain(out, world);
    place(world, offsets, joints.hips, joints);
  }

  /** the state is the output, written into `raw`: a held or limited joint goes on from where and as fast as it was put */
  private keep(raw: Rotations, holds: Holds, dt: number) {
    const { out, state, limited } = this;
    _k[1] = 1 / dt;
    _k[0] = 0;
    for (const b of BONES) if (limited[b]) keep(state[b], raw[b], out[b]);
    for (const l of LIMBS) {
      const h = l.arm ? holds.arms[l.side] : holds.legs[l.side];
      if (h.at <= 0 && h.turn <= 0) continue;
      _k[0] = h.at;
      keep(state[l.upper], raw[l.upper], out[l.upper]);
      keep(state[l.lower], raw[l.lower], out[l.lower]);
      _k[0] = h.turn;
      keep(state[l.end], raw[l.end], out[l.end]);
    }
    _k[0] = holds.body;
    if (holds.body > 0) for (const b of BODY) keep(state[b], raw[b], out[b]);
    for (const b of BONES) raw[b].copy(out[b]);
  }

  /**
   * Bends a limb of the output (world rotations, its joints at `_pos`) back toward its held end
   * (`solved`: where the solve put it): the limb swung about its root and its middle joint
   * folded about its hinge to reach it, the end's rotation turned toward the solved one.
   */
  private bend(upper: LimbBone, lower: LimbBone, end: BoneName, h: Hold, solved: Vector3) {
    const { world, rawWorld, offsets } = this;
    const root = _pos[upper];
    const mid = _pos[lower];
    const tip = _pos[end];
    const target = _target.copy(tip).lerp(solved, h.at);
    const l1 = offsets[lower].length();
    const l2 = offsets[end].length();
    const d0 = _d0.subVectors(tip, root).normalize();
    const d = _d.subVectors(target, root);
    const dist = Math.min(l1 + l2 - 1e-6, Math.max(Math.abs(l1 - l2) + 1e-6, d.length()));
    d.normalize();
    // the hinge, swung with the limb onto its new line
    const hinge = _n0.copy(REST_HINGE[upper]).applyQuaternion(world[upper]);
    const n = _n.copy(hinge).applyQuaternion(_swing.setFromUnitVectors(d0, d));
    n.addScaledVector(d, -n.dot(d)).normalize();
    const side = _b.crossVectors(n, d);
    const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const mid2 = _mid2.copy(root).addScaledVector(d, cosA * l1).addScaledVector(side, sinA * l1);
    const tip2 = _tip2.copy(root).addScaledVector(d, dist);
    turnBone(world[upper], _a.subVectors(mid, root), hinge, _c.subVectors(mid2, root), n);
    // (the lower bone turns with the upper's hinge: its own twist — a forearm's — stays)
    world[end].premultiply(turnBone(world[lower], _a.subVectors(tip, mid), hinge, _c.subVectors(tip2, mid2), n));
    if (h.turn > 0) world[end].slerp(rawWorld[end], h.turn);
  }
}

const BODY = ['hips', 'spine', 'chest', 'neck', 'head'] as const;
/** how long a joint takes to come into its range, or out of it bearing weight (s) */
const LET_GO = 0.2;
const _free = perBone(() => 1);

/** world rotations from parent-relative ones */
function chain(local: Rotations, out: Rotations) {
  out.hips.copy(local.hips);
  for (const b of CHILD_BONES) out[b].multiplyQuaternions(out[PARENT[b]], local[b]);
}

/** the bones' origins from the world rotations, each at its solved offset in its parent's frame */
function place(world: Rotations, offsets: Record<BoneName, Vector3>, hips: Vector3, out: Record<BoneName, Vector3>) {
  out.hips.copy(hips);
  for (const b of CHILD_BONES) framePoint(out[b], out[PARENT[b]], world[PARENT[b]], offsets[b]);
}
const _pos = perBone(() => new Vector3());

/**
 * One joint's step: it follows the solved rotation `raw` exactly unless that would change its
 * angular velocity faster than `accel`; what it cannot follow goes into the offset, which a
 * critically damped spring settles (`settle`, 1/s). Writes the output rotation.
 */
function follow(st: State, raw: Quaternion, j: { accel: number; settle: number }, dt: number, out: Quaternion): boolean {
  // the solved rotation's angular velocity: its turn since last tick
  raw.toArray(_s, 0);
  turnLog(st, RAW, _s, 0, st, W, 1 / dt);
  raw.toArray(st, RAW);
  // the offset settles
  const k = j.settle;
  const e = Math.exp(-k * dt);
  for (let i = 0; i < 3; i++) {
    const c = st[U + i] + k * st[O + i];
    st[O + i] = (st[O + i] + c * dt) * e;
    st[U + i] = (st[U + i] - k * c * dt) * e;
  }
  // the output's angular velocity changes at most by the joint's limit; the rest is absorbed
  let len = 0;
  for (let i = 0; i < 3; i++) len += (st[W + i] + st[U + i] - st[V + i]) ** 2;
  len = Math.sqrt(len);
  const most = j.accel * DEG * dt;
  const f = len > most ? 1 - most / len : 0;
  for (let i = 0; i < 3; i++) {
    const v = st[W + i] + st[U + i];
    const excess = (v - st[V + i]) * f;
    st[O + i] -= excess * dt;
    st[V + i] = v - excess;
  }
  st.copyWithin(PREV, OUT, OUT + 4);
  // the output: raw · exp(o)
  const ox = st[O], oy = st[O + 1], oz = st[O + 2];
  const a2 = ox * ox + oy * oy + oz * oz;
  const moved = a2 > 1e-16;
  if (moved) {
    const ang = Math.sqrt(a2);
    const sn = Math.sin(ang / 2) / ang;
    const qx = ox * sn, qy = oy * sn, qz = oz * sn, qw = Math.cos(ang / 2);
    const bx = _s[0], by = _s[1], bz = _s[2], bw = _s[3];
    st[OUT] = bw * qx + bx * qw + by * qz - bz * qy;
    st[OUT + 1] = bw * qy - bx * qz + by * qw + bz * qx;
    st[OUT + 2] = bw * qz + bx * qy - by * qx + bz * qw;
    st[OUT + 3] = bw * qw - bx * qx - by * qy - bz * qz;
    out.fromArray(st, OUT);
  } else {
    raw.toArray(st, OUT);
    out.copy(raw);
  }
  return moved;
}

/**
 * A held joint's state from its output (`out`, held `_k[0]` of the way to the solve; `_k[1]` =
 * 1 / dt): its offset off the solve, how fast it turns, and its offset's velocity damped as far
 * as it is held.
 */
function keep(st: State, raw: Quaternion, out: Quaternion) {
  raw.toArray(_s, 0);
  out.toArray(_s, 4);
  turnLog(_s, 0, _s, 4, st, O, 1);
  turnLog(st, PREV, _s, 4, st, V, _k[1]);
  out.toArray(st, OUT);
  for (let i = 0; i < 3; i++) st[U + i] *= 1 - _k[0];
}

/** `out[o…o+2]` = the rotation vector of a[ai]⁻¹ · b[bi] (unit quaternions, the shorter way round) × `scale` */
function turnLog(a: Float64Array, ai: number, b: Float64Array, bi: number, out: Float64Array, o: number, scale: number) {
  const ax = -a[ai], ay = -a[ai + 1], az = -a[ai + 2], aw = a[ai + 3];
  const bx = b[bi], by = b[bi + 1], bz = b[bi + 2], bw = b[bi + 3];
  const x = aw * bx + ax * bw + ay * bz - az * by;
  const y = aw * by - ax * bz + ay * bw + az * bx;
  const z = aw * bz + ax * by - ay * bx + az * bw;
  const w = aw * bw - ax * bx - ay * by - az * bz;
  const sgn = w < 0 ? -1 : 1;
  const s = Math.sqrt(x * x + y * y + z * z);
  const k = (s < 1e-9 ? 2 : (2 * Math.atan2(s, sgn * w)) / s) * sgn * scale;
  out[o] = x * k;
  out[o + 1] = y * k;
  out[o + 2] = z * k;
}

/** `v` turned by the quaternion in `_s` (read once from it: its getters, called, would box each number) */
function rotate(v: Vector3): Vector3 {
  const qx = _s[0], qy = _s[1], qz = _s[2], qw = _s[3];
  const tx = 2 * (qy * v.z - qz * v.y);
  const ty = 2 * (qz * v.x - qx * v.z);
  const tz = 2 * (qx * v.y - qy * v.x);
  v.x += qw * tx + qy * tz - qz * ty;
  v.y += qw * ty + qz * tx - qx * tz;
  v.z += qw * tz + qx * ty - qy * tx;
  return v;
}

/** scratch quaternions, and numbers handed on (passed as arguments, V8 boxes them) */
const _s = new Float64Array(8);
const _k = new Float64Array(2);

/** `b`'s parent-relative rotation from the world rotations */
const toLocal = (world: Rotations, b: ChildBone, out: Rotations) => out[b].copy(world[PARENT[b]]).invert().multiply(world[b]);

/**
 * Turns `q` (a bone's world rotation) as the bone goes from direction `dir` and hinge `hinge` to
 * `dir2` and `hinge2`; returns the turn (premultiplied).
 */
function turnBone(q: Quaternion, dir: Vector3, hinge: Vector3, dir2: Vector3, hinge2: Vector3): Quaternion {
  basis(dir2, hinge2, _turn);
  basis(dir, hinge, _q).invert();
  _turn.multiply(_q);
  q.premultiply(_turn);
  return _turn;
}

function basis(dir: Vector3, hinge: Vector3, out: Quaternion): Quaternion {
  const d = _x.copy(dir).normalize();
  const h = _y.copy(hinge).addScaledVector(d, -hinge.dot(d)).normalize();
  const t = _z.crossVectors(d, h);
  return out.setFromRotationMatrix(_m.makeBasis(d, h, t));
}

const _q = new Quaternion();
const _turn = new Quaternion();
const _swing = new Quaternion();
const _m = new Matrix4();
const _a = new Vector3();
const _c = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _target = new Vector3();
const _d0 = new Vector3();
const _d = new Vector3();
const _n0 = new Vector3();
const _n = new Vector3();
const _b = new Vector3();
const _mid2 = new Vector3();
const _tip2 = new Vector3();
