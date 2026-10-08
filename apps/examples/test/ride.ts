import { Vector3 } from 'three';
import type { Humanoid } from '@prohuman/core';
import { jointOf } from '../src/joints';
import { FIXED_DT, type Part, type Prop } from '../src/scenario';
import { comOf } from './balance';
import { Peak, type Frame } from './frame';

const DEG = 180 / Math.PI;
const UP = new Vector3(0, 1, 0);
/** mounting settles the body onto the mount (the contacts take hold): its measures count from this long after (s) */
const SETTLE = 1;
/** the vehicle's own vertical jolts (a pop, a landing: m/s²) whose frames, and this long after (s), aren't judged for spikes */
const JOLT = { accel: 15, after: 0.15 };
/** the joints whose acceleration is watched for spikes (pops) */
const WATCHED = ['hips', 'chest', 'neck', 'head', 'leftLowerLeg', 'rightLowerLeg', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand'] as const;
/** the limbs kept clear of the vehicle's tubes and wheels: [from, to, radius × height] (the feet stand on it, the hands hold it) */
export const LIMBS: readonly (readonly [string, string, number])[] = [
  ['spine', 'neck', 0.065],
  ['leftUpperLeg', 'leftLowerLeg', 0.034],
  ['rightUpperLeg', 'rightLowerLeg', 0.034],
  ['leftLowerLeg', 'leftFoot', 0.025],
  ['rightLowerLeg', 'rightFoot', 0.025],
  ['leftUpperArm', 'leftLowerArm', 0.022],
  ['rightUpperArm', 'rightLowerArm', 0.022],
] as const;
/** the soles' points kept out of the vehicle's boxes (a deck, the pedals) */
const SOLE = ['Heel', 'BigToe', 'SmallToe', 'Toes'] as const;

/** mean, min and max of a series */
export class Series {
  private sum = 0;
  n = 0;
  min = Infinity;
  max = -Infinity;
  add(x: number) {
    this.sum += x;
    this.n++;
    this.min = Math.min(this.min, x);
    this.max = Math.max(this.max, x);
  }
  get mean() {
    return this.sum / (this.n || 1);
  }
  toString() {
    return this.n ? `${this.mean.toFixed(1)} (${this.min.toFixed(1)}…${this.max.toFixed(1)})` : '–';
  }
}

/**
 * Riding (the first actor, mounted): the feet on their targets; knee flexion and the trunk's
 * angle above the horizontal, seated and standing; the whole body's lean into the mount's
 * sideways acceleration against a balanced lean (atan(a / g)), and the head kept level;
 * joint accelerations (spikes: pops; not through the vehicle's own jolts); limbs into the vehicle's tubes and
 * wheels, soles into its boxes.
 */
export class Riding {
  frames = 0;
  readonly foot = new Peak();
  readonly knee = { seated: new Series(), standing: new Series() };
  readonly trunk = { seated: new Series(), standing: new Series() };
  /** in a turn, the whole body's lean (its centre of mass over the vehicle's ground point) off a balanced lean (°); the most balanced lean seen */
  readonly leanError = new Series();
  readonly leanMax = new Peak();
  /** the eyes' line off level (°), over the trunk's lean off vertical (°) */
  readonly headRoll = new Series();
  /** facing the travel, in a turn (a balanced lean over 5°): how far the face turns off it into the turn (°) */
  readonly gazeInto = new Series();
  /** in a turn: how far the chest (spine to neck) leans toward its inside (°, − = swaying outward) */
  readonly swayInto = new Series();
  /** the hip joints over the seat's target, seated (m) */
  readonly seatGap = new Series();
  /** elbow flexion with a hand on a target (°) */
  readonly elbow = new Series();
  /** standing sideways to the travel (a board): how far the face is off it, over the shoulder (°) */
  readonly faceOff = new Series();
  readonly trunkRoll = new Series();
  readonly spike = new Peak();
  private spiked = '';
  readonly depth = new Peak();
  /** which limb into which part, at the deepest */
  private deepest = '';
  readonly soleDepth = new Peak();
  private since = Infinity;
  private jolted = -Infinity;
  /** where the vehicle was on the ground the last three frames */
  private readonly mount: Vector3[] = [];
  private readonly joints = new Map<string, Vector3[]>();

  see({ t, h, input, props }: Frame) {
    // (getting on is judged by its own measures: riding counts once the mount carries the body fully)
    if (!h.mounted || !input.mount || (input.mount.weight ?? 1) < 1) {
      this.since = Infinity;
      this.mount.length = 0;
      this.joints.clear();
      return;
    }
    this.since = Math.min(this.since, t);
    // (the mount's way over the ground, where it carries the body)
    const history = this.mount;
    history.push(input.mount.position.clone());
    if (history.length > 3) history.shift();
    if (history.length === 3 && Math.abs(history[2].y - 2 * history[1].y + history[0].y) / FIXED_DT ** 2 > JOLT.accel) this.jolted = t;
    for (const n of WATCHED) {
      const js = this.joints.get(n) ?? [];
      this.joints.set(n, js);
      js.push(jointOf(h, n));
      if (js.length > 3) js.shift();
    }
    if (t - this.since < SETTLE) return;
    this.frames++;
    const j = (n: string) => jointOf(h, n);
    for (const s of ['left', 'right'] as const) {
      const target = input[`${s}Foot`];
      if (target && (target.weight ?? 1) > 0.99) this.foot.see(j(`${s}Foot`).distanceTo(target.position), t);
    }
    const seated = h.seated > 0.95;
    if (seated && input.seat) this.seatGap.add(j('hips').y - input.seat.position.y);
    for (const s of ['left', 'right'] as const)
      if (input[`${s}Hand`]) this.elbow.add(180 - j(`${s}UpperArm`).sub(j(`${s}LowerArm`)).angleTo(j(`${s}Hand`).sub(j(`${s}LowerArm`))) * DEG);
    for (const s of ['left', 'right'] as const) {
      const knee = 180 - j(`${s}UpperLeg`).sub(j(`${s}LowerLeg`)).angleTo(j(`${s}Foot`).sub(j(`${s}LowerLeg`))) * DEG;
      (seated ? this.knee.seated : this.knee.standing).add(knee);
    }
    const trunk = j('neck').sub(j('hips'));
    const travel = new Vector3(h.velocity.x, 0, h.velocity.z);
    const speed = travel.length();
    (seated ? this.trunk.seated : this.trunk.standing).add(Math.atan2(trunk.y, Math.hypot(trunk.x, trunk.z)) * DEG);
    // leaning into the turn: the trunk's roll about the travel against atan(a / g)
    if (speed > 1 && history.length === 3) {
      travel.divideScalar(speed);
      const left = UP.clone().cross(travel);
      const a = history[2].clone().sub(history[1].clone().multiplyScalar(2)).add(history[0]).divideScalar(FIXED_DT * FIXED_DT).setY(0);
      // (the body's own share of it: the rest sways a body held in place outward)
      const balanced = Math.atan(((input.mount.lean ?? 1) * a.dot(left)) / 9.81) * DEG;
      // (the whole body's lean: its centre of mass off the vehicle's ground point)
      const body = comOf(h).sub(history[2]);
      const lean = Math.atan2(body.dot(left), body.y) * DEG;
      const roll = Math.atan2(trunk.dot(left), trunk.y) * DEG;
      this.leanMax.see(Math.abs(balanced), t);
      const face = j('nose').sub(j('head'));
      const off = Math.atan2(face.dot(left), face.dot(travel)) * DEG;
      const sideways = Math.abs(h.velocity.x * Math.cos(h.yaw) - h.velocity.z * Math.sin(h.yaw)) > 0.7 * speed;
      if (sideways) this.faceOff.add(Math.abs(off));
      // in a turn (sideways acceleration over 1.5 m/s²; not glancing elsewhere): the lean against the balanced
      // one, the face turned into it, and the chest's roll toward it (a body held in place sways outward instead)
      const sideAccel = a.dot(left);
      if (Math.abs(sideAccel) > 1.5 && !input.lookAt) {
        this.leanError.add(lean - balanced);
        if (!sideways) this.gazeInto.add(Math.sign(sideAccel) * off);
        this.swayInto.add(Math.sign(sideAccel) * Math.atan2(j('neck').sub(j('spine')).dot(left), 1) * DEG);
      }
      const eyes = j('leftEye').sub(j('rightEye'));
      this.headRoll.add(Math.abs(Math.atan2(eyes.y, Math.hypot(eyes.x, eyes.z))) * DEG);
      this.trunkRoll.add(Math.abs(roll));
    }
    for (const n of WATCHED) {
      const [a, b, c] = this.joints.get(n) ?? [];
      if (!c || t - this.jolted < JOLT.after) continue;
      const acc = c.clone().sub(b.clone().multiplyScalar(2)).add(a).divideScalar(FIXED_DT * FIXED_DT).length();
      if (acc > this.spike.value) this.spiked = n;
      this.spike.see(acc, t);
    }
    const into = intoVehicles(h, props);
    if (into.limbs > this.depth.value) this.deepest = into.what;
    this.depth.see(into.limbs, t);
    this.soleDepth.see(into.soles, t);
  }

  toString() {
    if (!this.frames) return 'riding: never';
    const f = (x: number) => x.toFixed(1);
    return [
      `riding ${(this.frames * FIXED_DT).toFixed(1)} s: foot off its target ${this.foot}; knee flexion seated ${this.knee.seated}°, standing ${this.knee.standing}°; trunk above horizontal seated ${this.trunk.seated}°, standing ${this.trunk.standing}°`,
      `  body lean off balanced (atan a/g, up to ${f(this.leanMax.value)}°) ${this.leanError}°; trunk roll ${this.trunkRoll}°, head roll ${this.headRoll}°, face into the turn ${this.gazeInto}°, chest sway into the turn ${this.swayInto}°, elbow ${this.elbow}°, sideways face off the travel ${this.faceOff}°; joint acceleration peak ${this.spike.value.toFixed(1)} m/s² @${this.spike.at.toFixed(2)}s (${this.spiked}); limbs into the vehicle ${this.depth} (${this.deepest}), soles into its boxes ${this.soleDepth}`,
    ].join('\n');
  }
}

/**
 * How deep the body is in the vehicles among `props` (m): `limbs` into their tubes and wheels
 * (`what` into which, at the deepest), its soles into their boxes.
 */
export function intoVehicles(h: Humanoid, props: readonly Prop[], limbs = LIMBS) {
  const H = h.proportions.height;
  const out = { limbs: 0, what: '', soles: 0 };
  for (const v of props) {
    if (v.kind !== 'vehicle') continue;
    const world = (p: Vector3) => p.clone().applyQuaternion(v.quaternion).add(v.position);
    v.parts.forEach((part, i) => {
      // (straps lie against the body)
      if (part.kind === 'rod' && part.contact) return;
      if (part.kind === 'box') {
        for (const s of ['left', 'right']) for (const n of SOLE) out.soles = Math.max(out.soles, boxDepth(part, v, jointOf(h, `${s}${n}`)));
        return;
      }
      for (const [a, b, r] of limbs) {
        const p = jointOf(h, a);
        const q = jointOf(h, b);
        const depth = part.kind === 'rod' ? r * H + part.radius - segmentDistance(p, q, world(part.from), world(part.to)) : wheelDepth(part, v, p, q, r * H);
        if (depth <= out.limbs) continue;
        out.limbs = depth;
        out.what = `${a}–${b} into ${part.kind} ${i}`;
      }
    });
  }
  return out;
}

/** how deep `p` is inside a box part of vehicle `v` (0 outside) */
function boxDepth(part: Extract<Part, { kind: 'box' }>, v: Extract<Prop, { kind: 'vehicle' }>, p: Vector3): number {
  const l = p.clone().sub(v.position).applyQuaternion(v.quaternion.clone().invert()).sub(part.center);
  if (part.quaternion) l.applyQuaternion(part.quaternion.clone().invert());
  const { x, y, z } = part.size;
  return Math.max(0, Math.min(x / 2 - Math.abs(l.x), y / 2 - Math.abs(l.y), z / 2 - Math.abs(l.z)));
}

/** how deep a limb (`p` → `q`, radius `r`) reaches into a wheel part of vehicle `v` (sampled; ≤ 0 clear) */
function wheelDepth(part: Extract<Part, { kind: 'wheel' }>, v: Extract<Prop, { kind: 'vehicle' }>, p: Vector3, q: Vector3, r: number): number {
  const inv = v.quaternion.clone().invert();
  let depth = -Infinity;
  for (let i = 0; i <= 8; i++) {
    const l = p.clone().lerp(q, i / 8).sub(v.position).applyQuaternion(inv).sub(part.center);
    if (part.quaternion) l.applyQuaternion(part.quaternion.clone().invert());
    const radial = Math.hypot(l.y, l.z) - (part.radius - part.tube / 2);
    depth = Math.max(depth, r + part.tube / 2 - Math.hypot(radial, l.x));
  }
  return depth;
}

/** the least distance between segments a0–a1 and b0–b1 */
function segmentDistance(a0: Vector3, a1: Vector3, b0: Vector3, b1: Vector3): number {
  const d1 = a1.clone().sub(a0);
  const d2 = b1.clone().sub(b0);
  const r = a0.clone().sub(b0);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  const c = d1.dot(r);
  const b = d1.dot(d2);
  const denom = a * e - b * b;
  let s = denom > 1e-12 ? clamp01((b * f - c * e) / denom) : 0;
  let t = e > 1e-12 ? (b * s + f) / e : 0;
  if (t < 0 || t > 1) {
    t = clamp01(t);
    s = a > 1e-12 ? clamp01((b * t - c) / a) : 0;
  }
  return a0.clone().addScaledVector(d1, s).distanceTo(b0.clone().addScaledVector(d2, t));
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

