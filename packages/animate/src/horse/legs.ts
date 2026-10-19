import { action } from '@pmndrs/timeline';
import { live, type Behaviour, type Live, type Target } from '../core/goal';
import type { ReadonlyPose } from '../core/pose';
// Recalled: Back et al. (1995), Hodson (2000/2001), Clayton (2004) curves as retained by the spike.
import { Euler, Quaternion, Vector3 } from 'three';
import { minimumJerk, yawOf } from '../core/math';
import { irregular, seeded, seedOf } from '../core/random';
import { strideAt, type LegGait } from '../core/legs/gait';
import type { Frame } from '../core/body';
import { Legs } from '../core/legs/legs';
import type { JointCycle } from '../core/legs/cycle';
import type { LegChain } from '../core/legs/legs';
import { EARS, HALTER, HEAD, LEGS, NECK, PELVIS, SPINE, TAIL } from './skeleton';
import { powerGait } from '../core/legs/schedule';

// Recalled: hip height ~1.2 m, slow walk threshold 0.8 m/s (spike).
// Recalled: Hildebrand lateral walk sequence and Clayton/Hobbs diagonal trot offsets.
// Recalled: Alexander/Jayes stride coefficients; Hodson stance at 1.6 / 3.7 m/s.
// [D] 5 cm proxy-hoof clearance in both gaits keeps the early sole-height peak above the passive fold.
const walk = powerGait(1.2, 0.8, [0.25, 0.75, 0, 0.5], 2.3, 0.68 * Math.pow(1.6, 0.7), [0.05, 0.05, 0.05, 0.05]);
export const HORSE_WALK = {
  ...walk, kind: 'walk' as const, referenceSpeed: 1.6, referenceBlend: 1,
  // Tuned from the read 28% fore-cannon crossing, allowing for the coffin's forward offset.
  contacts: walk.contacts.map((contact, i) => ({
    ...contact,
    // Tuned: hinds release earlier, before the planted hoof draws the hip into excessive retraction.
    duty: i < 2 ? contact.duty : (v: number, fr: number) => 0.9 * contact.duty(v, fr),
    stanceCenter: i < 2 ? 0.31 : undefined,
  })),
};
export const HORSE_TROT = { kind: 'trot' as const, ...powerGait(1.2, 0.8, [0.52, 0.02, 0, 0.5], 2.15, 0.3 * Math.pow(3.7, 0.7), [0.05, 0.05, 0.05, 0.05]) };

// Read: Back et al. 1995 fore/hind abstracts describe TROT at 4 m/s, not walk.
// Recalled: Back et al. 1996 comparison: walk stance has less shoulder/stifle/hock flexion.
// Read: Hodson et al. 2001 abstract (doi:10.2746/042516401776767485): loading
// flexion in the first 10%, stifle flexion after 28%, coordinated stifle/hock swing.
// Recalled: trot curves below and the 1996 excursion values retained from the spike.
// Read: Hodson et al. 2000 (doi:10.2746/042516400777032237): fore cannon vertical at 28% stride.
// Tuned: walk keys implement those findings; they are not digitised paper data.
const cycle = (keys: [number, number][], alternate?: [number, number][], alternateWeight = 1): JointCycle => ({ duty: 0.45, keys, alternate, alternateWeight });
// Tuned walk elbow swing scale: clear the sole before the floor forces a pastern correction.
const WALK_ELBOW_SCALE = 75.2 / 84.7;
const FORE = {
  scapula: cycle([[0, 8], [0.22, 0], [0.45, -10], [0.7, 2], [0.9, 10]]),
  shoulder: cycle([[0, 5], [0.22, -3], [0.45, -15], [0.6, -5], [0.75, 15], [0.9, 15]]),
  elbow: cycle([[0, -5], [0.22, -12], [0.45, -5], [0.58, 35], [0.7, 55], [0.85, 20], [0.95, 0]],
    [[0, -5], [0.22, -12], [0.45, -5], [0.58, 38 * WALK_ELBOW_SCALE], [0.7, 55 * WALK_ELBOW_SCALE], [0.85, 20 * WALK_ELBOW_SCALE], [0.95, 0]]),
  carpus: cycle([[0, 0], [0.4, 0], [0.5, -30], [0.62, -87.9], [0.75, -50], [0.88, -5]],
    [[0, 0], [0.4, 0], [0.5, -30 * 66 / 87.9], [0.62, -66], [0.75, -50 * 66 / 87.9], [0.88, -5 * 66 / 87.9]]),
};
// Read: Hodson 2001: maximal protraction shortly before swing ends; the stifle
// starts flexing after 28% stride. The walk alternate begins folding before toe-off.
// Hock target 43° approximates the read 42.4° walk ROM (125.2–167.6°), reproduced
// in Mendez-Angulo, Effect of Water Level on Kinematics of Healthy Horses, Table 1.
// Read: Egenvall et al. 2023, doi:10.7717/peerj.16373: circle-walk hip ROM 16.8–20.7°.
// Tuned: smaller hip references and a stronger hip preference distribute contact corrections
// into the distal joints. Hock keys counter that redistribution during support; they are not
// measured joint angles. These are soft references: report solved excursions, not target values.
// Tuned walk hip stiffness: keep the solved excursion near the recalled 17–21° band during pursuit.
const WALK_HIP_WEIGHT = 16;
const HIND = {
  hip: cycle([[0, 10], [0.22, 0], [0.45, -12], [0.6, -3], [0.78, 15], [0.92, 14]],
    [[0, 12], [0.22, 5], [0.45, -5], [0.6, -1], [0.78, 3], [0.92, 9]], WALK_HIP_WEIGHT),
  stifle: cycle([[0, -5], [0.15, -12], [0.45, 0], [0.58, -30], [0.7, -45], [0.85, -20], [0.95, -5]],
    [[0, 0], [0.07, -3], [0.22, 0], [0.45, -12], [0.58, -30], [0.7, -43], [0.85, -20], [0.95, 0]]),
  // Tuned 35° mid-support walk keys offset distal redistribution; not measured angles.
  hock: cycle([[0, 5], [0.15, 15], [0.45, 0], [0.58, 30], [0.7, 45], [0.85, 20], [0.95, 5]],
    [[0, -12], [0.07, -12], [0.14, -20], [0.22, 35], [0.45, 35], [0.58, 30], [0.7, 43], [0.85, 20], [0.95, -12]]),
};
// Tuned walk: spring under load, then a modest pastern fold. The trot's large
// fetlock fold was turning the whole free hoof under, rather than clearing it.
const FORE_FETLOCK = cycle([[0, 5], [0.22, 30], [0.45, 0], [0.55, -30], [0.68, -55], [0.82, -20], [0.95, 0]],
  [[0, 5], [0.22, 30], [0.45, 0], [0.55, -30 * 35 / 55], [0.68, -35], [0.82, -20 * 35 / 55], [0.95, 0]]);
const FORE_COFFIN = cycle([[0, 0], [0.22, -5], [0.45, 10], [0.6, -15], [0.8, -5]],
  [[0, 0], [0.22, -5], [0.45, 10], [0.6, 8], [0.8, 4]]);
// Tuned 0° free-swing hind fetlock keys: the walk’s hind pastern relaxes after support; stifle and hock flexion clear the free hoof.
const HIND_FETLOCK = cycle([[0, 5], [0.22, 30], [0.45, 0], [0.55, -30], [0.68, -55], [0.82, -20], [0.95, 0]],
  [[0, 5], [0.22, 30], [0.45, 0], [0.55, 0], [0.68, 0], [0.82, 0], [0.95, 0]]);
const HIND_COFFIN = cycle([[0, 0], [0.22, -5], [0.45, 10], [0.6, -15], [0.8, -5]],
  [[0, 0], [0.22, -5], [0.45, 10], [0.6, 35], [0.8, 15]]);
/** the hoof flat on the ground, breaking over its toe at the end of the stance (°, + toe up) */
// Tuned: finish the toe roll before lift-off, braking the downward spin inherited by swing.
const BREAKOVER: LegChain['rocker'] = [[0, 0], [0.75, 0], [0.9, -25], [1, -25]];

export function horseLegs(): readonly LegChain[] {
  return LEGS.map((leg): LegChain => ({
    joints: [
      ...(leg.fore ? [{ bone: leg.scapula ?? fail('a foreleg without a scapula'), axes: 'x', cycle: FORE.scapula }] : []),
      { bone: leg.upper, axes: 'yzx', cycle: leg.fore ? FORE.shoulder : HIND.hip },
      { bone: leg.middle, axes: 'x', cycle: leg.fore ? FORE.elbow : HIND.stifle },
      { bone: leg.cannon, axes: 'x', cycle: leg.fore ? FORE.carpus : HIND.hock },
      { bone: leg.pastern, axes: 'zx', cycle: leg.fore ? FORE_FETLOCK : HIND_FETLOCK },
      { bone: leg.hoof, axes: 'x', cycle: leg.fore ? FORE_COFFIN : HIND_COFFIN },
    ],
    heel: leg.heel.clone(),
    toe: leg.toe.clone(),
    toeOut: 0,
    rocker: BREAKOVER,
  }));
}

const fail = (what: string): never => { throw new Error(what); };

// Tuned follower acceleration (m/s²); catch-up speed is capped at the reference walk.
const FOLLOW_ACCEL = 0.65;

/** Follow a floor goal with the horse's pelvis, legs and head working together. */
export function horseFollow<W>(start: ReadonlyPose, goal: Live<Pick<Target, 'position' | 'velocity'>, W>, options: HorseAttention<W> = {}): Behaviour<W> {
  return function* () {
    const chains = horseLegs();
    const legs = new Legs(start, chains, HORSE_WALK);
    const body = new HorseMotion(start, chains, HORSE_WALK);
    yield* action<Frame<W>>({ update: (f) => {
      body.prepare(f, legs, options);
      const target = live(goal, f);
      const pace = Math.max(HORSE_WALK.slowest, target.velocity?.length() ?? 0);
      const gap = target.position.clone().sub(f.prev.position(0)).setY(0).length();
      const speed = Math.min(HORSE_WALK.referenceSpeed, Math.sqrt(pace ** 2 + 2 * FOLLOW_ACCEL * gap));
      legs.toward(f, target, { speed, accel: FOLLOW_ACCEL });
    } });
  };
}

export type HorseGait = LegGait & { kind: 'walk' | 'trot' };

export interface HorseAttention<W> {
  person?: Live<Readonly<Vector3> | undefined, W>;
  /** A new point triggers a mild saddling/girthing response; released responses settle in 3 s. */
  reaction?: Live<Readonly<Vector3> | undefined, W>;
  /** Maximum halter-to-knot distance while tied. */
  tether?: Live<{ position: Readonly<Vector3>; length: number } | undefined, W>;
}

const DEG = Math.PI / 180;
const turn = (x = 0, y = 0, z = 0) => new Quaternion().setFromEuler(new Euler(x, y, z, 'YXZ'));
const clamp = (x: number, n: number) => Math.max(-n, Math.min(n, x));
const IDLE_INTERVALS = [[2, 6], [2, 6], [5, 20], [10, 30], [20, 60]];

/** Gait and standing posture, written before contact solving. Research: research-contact.md §§5–6.
 * [R via summary] Dunbar 2008: walk poll 12±4 cm, withers 7±1 cm, croup 10±2 cm;
 * head/trunk pitch 9±4°/6±2°. [R-s] fore-contact head phase; [R/R-s] back ROM and trot roll.
 * [C] Walk pelvic pitch, idle intervals, response timings and passive tail; animation-scale choices.
 */
export class HorseMotion {
  private readonly rand: () => number;
  private readonly phase: number;
  private readonly next: number[];
  private readonly aim = [0, 0, 0, 0, 0];
  private readonly value = [0, 0, 0, 0, 0];
  private readonly start: number;
  private moving = 0;
  private quiet = 0;
  private rest = 0;
  private side = 0;
  private restAt: number;
  private response = Infinity;
  private trigger?: Readonly<Vector3>;
  private swish = Infinity;
  private tail = { angle: 0, rate: 0 };
  private tied?: { position: Vector3; length: number };

  constructor(start: ReadonlyPose, private readonly chains: readonly LegChain[], private readonly gait: HorseGait, seed = seedOf(start.position(0).x, start.position(0).z)) {
    this.start = start.position(0).y;
    this.rand = seeded(seed);
    this.phase = this.rand() * 2 * Math.PI;
    this.next = IDLE_INTERVALS.map(([lo, hi]) => lo + (hi - lo) * this.rand());
    this.restAt = 60 + 120 * this.rand();
  }

  prepare<W>(f: Frame<W>, legs: Legs, attention: HorseAttention<W> = {}): void {
    if (this.tied) {
      const stretch = f.prev.point(HEAD, HALTER, new Vector3()).distanceTo(this.tied.position);
      if (stretch > this.tied.length + 1e-4) f.dev?.append(f.time - f.dt, { check: 'horse tether (m)', value: stretch, limit: this.tied.length, where: 'halter' });
    }
    const speed = f.prev.position(0).clone().sub(f.prev2.position(0)).setY(0).length() / f.dt;
    this.moving += (Math.min(1, speed / this.gait.slowest) - this.moving) * (1 - Math.exp(-4 * f.dt));
    this.quiet = speed < 0.01 ? this.quiet + f.dt : 0;
    const m = this.moving, t = f.time, trot = this.gait.kind === 'trot';
    const stride = strideAt(this.gait, speed, 0);
    const phase = 2 * Math.PI * (legs.legs[0].phase + (speed > 0 ? stride.frequency * f.dt : 0));
    const wave = Math.cos(2 * phase), hind = 2 * Math.PI * (legs.legs[2].phase + (speed > 0 ? stride.frequency * f.dt : 0));
    this.swish += f.dt;
    // [D] Ear/head goals cross neutral so each scheduled posture change remains visible.
    for (const [i, [lo, hi]] of IDLE_INTERVALS.entries()) {
      if (t >= this.next[i]) {
        this.aim[i] = i < 2 || i === 3 ? (this.aim[i] > 0 ? -1 : 1) * (0.25 + 0.75 * this.rand()) : 2 * this.rand() - 1;
        if (i === 2) this.swish = 0;
        this.next[i] = t + lo + (hi - lo) * this.rand();
      }
      this.value[i] += (this.aim[i] - this.value[i]) * (1 - Math.exp(-(i < 2 ? 8 : 1) * f.dt));
    }
    if (this.quiet >= this.restAt) { this.side = this.side ? -this.side : (this.rand() < 0.5 ? 1 : -1); this.restAt = this.quiet + 60 + 240 * this.rand(); }
    this.rest += ((this.quiet >= 60 ? this.side : 0) * (1 - m) - this.rest) * (1 - Math.exp(-f.dt));
    this.chains.forEach((chain, i) => { chain.rest = i === 2 ? -25 * Math.max(0, this.rest) : i === 3 ? 25 * Math.min(0, this.rest) : 0; });
    const person = attention.person && live(attention.person, f);
    const reaction = attention.reaction && live(attention.reaction, f);
    if (reaction && reaction !== this.trigger) this.response = 0;
    this.trigger = reaction; this.response += f.dt;
    const response = minimumJerk(this.response / 0.25) * (1 - minimumJerk((this.response - 1) / 3));
    const local = (point: Readonly<Vector3>) => new Vector3().copy(point).sub(f.prev.position(0)).applyQuaternion(turn(0, -yawOf(f.prev.rotation(0))));
    const attended = person && person.distanceTo(f.prev.position(HEAD)) < 5 ? clamp(Math.atan2(local(person).x, local(person).z), 0.55) : 0;
    const toward = reaction ? Math.sign(local(reaction).x) : (person ? Math.sign(local(person).x) : 1);
    const previous = new Euler().setFromQuaternion(f.prev.local(NECK), 'YXZ');
    const distance = person ? person.distanceTo(f.prev.position(HEAD)) : Infinity;
    // Retained avoidance: 0.8 m / 0.3 m transition, 0.5 rad, 0.25 s response.
    const away = person ? -Math.sign(local(person).x) * 0.5 * Math.max(0, Math.min(1, (0.8 - distance) / 0.3)) : 0;
    const wanted = away || (0.3 * attended * (1 - m) + 0.18 * this.value[3] * (1 - m) + 0.35 * toward * response);
    const yaw = previous.y + (clamp(wanted, 0.55) - previous.y) * (1 - Math.exp(-4 * f.dt));
    const drift = irregular(t, this.phase, 0.79, 1.37, 2.11) * (1 - m);
    const theta = 2 * phase - 2 * Math.PI * stride.duty;
    const sway = Math.cos(hind - Math.PI * strideAt(this.gait, speed, 2).duty);
    const withers = (trot ? -0.045 : 0.035) * Math.cos(theta) * m;
    // [D] Rigid-trunk component from 1.137 m landmark spacing; back flexion adds croup motion.
    const pitch = (trot ? 0.5 * DEG * Math.cos(theta) : Math.asin((0.05 * Math.cos(theta - 1.52) - 0.035 * Math.cos(theta)) / 1.137)) * m;
    const height = this.start + withers + 0.657 * Math.sin(pitch) - 0.04 * Math.abs(this.rest) + 0.003 * drift;
    f.current.setRoot(f.prev.position(0).clone().setY(height));
    f.current.setLocal(0, turn(pitch, yawOf(f.prev.rotation(0))));
    // [D] Hip/croup geometry gives ~0.3 rad back phase; verified on solved support, not a paper curve.
    // [R/R-s] Trot back ROM 4–6°; [D] align 6° with the trunk to lift the croup in phase.
    f.current.setLocal(SPINE, turn((trot ? 3 * DEG * Math.cos(theta) : 2.5 * DEG * Math.cos(theta - 0.3)) * m));
    f.current.setLocal(PELVIS, turn(0, 2.5 * DEG * sway * m, (trot ? 4.75 : 4) * DEG * sway * m + (-0.12 * this.rest + 0.02 * this.value[4] + 0.025 * toward * response) * (1 - m)));
    const neckBase = f.current.position(NECK).y;
    const poll = this.start + 0.17 + (trot ? withers : 0.0675 * wave * m);
    const nod = Math.atan2(0.18, 0.63) - Math.asin(clamp((poll - neckBase) / Math.hypot(0.18, 0.63), 0.9)) - pitch;
    f.current.setLocal(NECK, turn(nod + 0.025 * drift, yaw));
    f.current.setLocal(HEAD, turn((trot ? 2.5 : 4.5) * DEG * wave * m - pitch - nod, 0.2 * toward * response));
    EARS.forEach((ear, i) => f.current.setLocal(ear, turn(-0.3 * response, clamp(attended + this.value[i] * 0.7 + toward * response, 2)), 1 - Math.exp(-10 * f.dt)));
    // [C] Critically damped follower, ~0.15 s lag; independent seeded fly swishes.
    const tail = -2 * new Euler().setFromQuaternion(f.current.local(PELVIS), 'YXZ').z + 0.7 * Math.sin(2 * Math.PI * Math.min(1, this.swish / 1.2)) * Math.sign(this.aim[2]) * (1 - m) + 0.03 * drift + 0.2 * response;
    this.tail.rate += (100 * (tail - this.tail.angle) - 20 * this.tail.rate) * f.dt;
    this.tail.angle += this.tail.rate * f.dt;
    f.current.setLocal(TAIL, turn(0.05 * m * Math.sin(2 * phase - 1), this.tail.angle));
    const tether = attention.tether && live(attention.tether, f);
    this.tied = tether && { position: new Vector3().copy(tether.position), length: tether.length };
    if (tether) {
      if (!(tether.length > 0 && Number.isFinite(tether.length)) || !tether.position.toArray().every(Number.isFinite)) throw new Error('horse tether needs a finite point and positive length');
      const neck = f.current.local(NECK).clone(), head = f.current.local(HEAD).clone();
      const knot = local(tether.position).sub(local(f.current.position(NECK)));
      const base = turn(0, clamp(Math.atan2(knot.x, knot.z), 0.55));
      f.current.setLocal(NECK, base); f.current.setLocal(HEAD, new Quaternion());
      if (f.current.point(HEAD, HALTER, new Vector3()).distanceTo(tether.position) > tether.length) throw new Error('horse tether outside neck reach');
      let lo = 0, hi = 1;
      for (let i = 0; i < 12; i++) {
        const u = (lo + hi) / 2;
        f.current.setLocal(NECK, base.clone().slerp(neck, u)); f.current.setLocal(HEAD, new Quaternion().slerp(head, u));
        if (f.current.point(HEAD, HALTER, new Vector3()).distanceTo(tether.position) <= tether.length) lo = u; else hi = u;
      }
      f.current.setLocal(NECK, base.slerp(neck, lo)); f.current.setLocal(HEAD, new Quaternion().slerp(head, lo));
    }
  }
}
