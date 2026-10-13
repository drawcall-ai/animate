import { Vector3 } from 'three';
import { jointOf } from '../src/joints';
import { FIXED_DT } from '../src/scenario';
import { comOf, outsideHull } from './balance';
import { Peak, type Frame, type Actor } from './frame';
import { intoVehicles, LIMBS } from './ride';

const DEG = 180 / Math.PI;
/** getting on is judged until this long after the vehicle, carrying the body fully, moves off (s) */
const AFTER = 1;
/** the vehicle moves off once its ground point is this far from where it was (m) */
const MOVED = 0.01;
/** standing on its own feet: the vehicle carries less than this of the body (beyond, it bears a share through what the hands and feet hold) */
const STANDING = 0.2;
/** a sole point this close to the floor is on it (m) */
const FLOOR = 0.01;
/** the head kept clear of the vehicle too (a roof): neck to the crown, radius × height */
const HEAD = ['neck', 'headTop', 0.03] as const;
/** the segments whose turning is watched: [from, to] */
const SEGMENTS = [
  ['hips', 'neck'],
  ['neck', 'headTop'],
  ['leftUpperLeg', 'leftLowerLeg'],
  ['rightUpperLeg', 'rightLowerLeg'],
  ['leftLowerLeg', 'leftFoot'],
  ['rightLowerLeg', 'rightFoot'],
  ['leftUpperArm', 'leftLowerArm'],
  ['rightUpperArm', 'rightLowerArm'],
  ['leftLowerArm', 'leftHand'],
  ['rightLowerArm', 'rightHand'],
] as const;
const SOLES = ['Heel', 'BigToe', 'SmallToe'] as const;

/**
 * Getting on or into a vehicle (the first actor): from the mount given (its weight rising from
 * 0) until AFTER s after it moves off carrying the body fully. The hands and feet on their full-weight
 * targets; nothing of the body (the head too) into the vehicle's tubes and wheels, the soles
 * out of its boxes; the segments' angular speed and acceleration (pops show as spikes); standing
 * on its feet, the extrapolated centre of mass over the soles on the floor and on footholds and
 * the hands' holds; no
 * sole sliding along the floor.
 */
export class Boarding {
  start = -1;
  end = -1;
  frames = 0;
  readonly contact = new Peak();
  private touched = '';
  readonly depth = new Peak();
  private deepest = '';
  readonly soles = new Peak();
  readonly rate = new Peak();
  private rated = '';
  readonly accel = new Peak();
  private acceled = '';
  readonly xcom = new Peak();
  xcomFrames = 0;
  readonly slide = new Peak();
  /** when the vehicle moved off carrying the body (s), where it stood */
  private off = -1;
  private readonly at = new Vector3();
  private readonly dirs = new Map<string, Vector3[]>();
  private com: Vector3 | null = null;
  private floor = new Map<string, Vector3>();

  see({ t, h, input, props }: Frame) {
    const m = input.mount;
    if (!m || !h.mounted || (this.off >= 0 && t - this.off > AFTER)) return;
    const w = m.weight ?? 1;
    if (this.start < 0) {
      if (w >= 1) return;
      this.start = t;
      this.at.copy(m.position);
    }
    if (w >= 1 && this.off < 0 && m.position.distanceTo(this.at) > MOVED) this.off = t;
    this.end = t;
    this.frames++;
    for (const n of ['leftHand', 'rightHand', 'leftFoot', 'rightFoot'] as const) {
      const e = input[n];
      if (!e || (e.weight ?? 1) < 0.99) continue;
      const off = jointOf(h, n).distanceTo(e.position);
      if (off > this.contact.value) this.touched = n;
      this.contact.see(off, t);
    }
    const into = intoVehicles(h, props, [...LIMBS, HEAD]);
    if (into.limbs > this.depth.value) this.deepest = into.what;
    this.depth.see(into.limbs, t);
    this.soles.see(into.soles, t);
    this.turning(h, t);
    this.balance(h, input, w, t);
  }

  /** each segment's angular speed (°/s) and acceleration (°/s²) from its last three directions */
  private turning(h: Actor, t: number) {
    for (const [a, b] of SEGMENTS) {
      const key = `${a}–${b}`;
      const ds = this.dirs.get(key) ?? [];
      this.dirs.set(key, ds);
      ds.push(jointOf(h, b).sub(jointOf(h, a)).normalize());
      if (ds.length > 3) ds.shift();
      if (ds.length < 2) continue;
      const [p, q, r] = ds;
      const rate = (r ?? q).clone().sub(r ? q : p).length() / FIXED_DT * DEG;
      if (rate > this.rate.value) this.rated = key;
      this.rate.see(rate, t);
      if (!r) continue;
      const accel = r.clone().sub(q.clone().multiplyScalar(2)).add(p).length() / FIXED_DT ** 2 * DEG;
      if (accel > this.accel.value) this.acceled = key;
      this.accel.see(accel, t);
    }
  }

  /** standing on its feet: the XCoM over the soles on the floor and on footholds; soles on the floor stay put */
  private balance(h: Actor, input: Frame['input'], w: number, t: number) {
    const com = comOf(h);
    const prev = this.com;
    this.com = com;
    const pts: [number, number][] = [];
    const floor = new Map<string, Vector3>();
    for (const s of ['left', 'right'] as const) {
      const held = (input[`${s}Foot`]?.weight ?? 0) > 0.99;
      for (const n of SOLES) {
        const p = jointOf(h, `${s}${n}`);
        if (p.y < FLOOR) floor.set(`${s}${n}`, p);
        if (p.y < FLOOR || held) pts.push([p.x, p.z]);
      }
    }
    // (hands holding the vehicle bear the body too)
    for (const n of ['leftHand', 'rightHand'] as const) {
      const e = input[n];
      if (e && (e.weight ?? 1) > 0.99) pts.push([e.position.x, e.position.z]);
    }
    for (const [k, p] of floor) {
      const was = this.floor.get(k);
      if (was) this.slide.see(Math.hypot(p.x - was.x, p.z - was.z), t);
    }
    this.floor = floor;
    if (!prev || w >= STANDING || h.seated > 0.5 || pts.length < 3) return;
    const v = com.clone().sub(prev).divideScalar(FIXED_DT);
    const x = com.clone().addScaledVector(v, 1 / Math.sqrt(9.81 / h.proportions.legLength));
    const out = outsideHull(pts, [x.x, x.z]);
    this.xcom.see(out, t);
    if (out > 0.1) this.xcomFrames++;
  }

  toString() {
    if (!this.frames) return 'boarding: never';
    return [
      `boarding ${this.start.toFixed(2)}–${this.end.toFixed(2)} s: contact off its target ${this.contact} (${this.touched}); into the vehicle ${this.depth} (${this.deepest}), soles into its boxes ${this.soles}`,
      `  segment speed peak ${this.rate.value.toFixed(0)}°/s @${this.rate.at.toFixed(2)}s (${this.rated}), acceleration peak ${this.accel.value.toFixed(0)}°/s² @${this.accel.at.toFixed(2)}s (${this.acceled}); standing: XCoM outside the feet ${this.xcom}, frames >10 cm ${this.xcomFrames}; sole slide on the floor ${this.slide}/frame`,
    ].join('\n');
  }
}
