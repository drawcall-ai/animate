import { action } from '@pmndrs/timeline';
import { live, type Behaviour, type Live, type Target } from '../core/goal';
import type { ReadonlyPose } from '../core/pose';
import { Euler, Quaternion, Vector3 } from 'three';
import { clamp, minimumJerk, yawOf } from '../core/math';
import { irregular, seeded, seedOf } from '../core/random';
import { strideAt, type Gait } from '../core/legs/gait';
import type { Frame } from '../core/body';
import { Legs, type LegChain } from '../core/legs/legs';
import type { JointCycle } from '../core/legs/cycle';
import { EARS, HALTER, HEAD, LEGS, NECK, PELVIS, SKELETON, SPINE, TAIL } from './skeleton';
import { powerGait } from '../core/legs/schedule';
import type { Species } from '../core/species';

/** a horse */
export const horse = (): Species => ({ skeleton: SKELETON });

const DEG = Math.PI / 180;
const WITHERS = SKELETON.bones[LEGS[0].scapula ?? fail('a foreleg without a scapula')].offset.z;
const SPAN = WITHERS - SKELETON.bones[SPINE].offset.z - SKELETON.bones[PELVIS].offset.z;
const NECK_BASE = SKELETON.bones[NECK].offset, POLL = SKELETON.bones[HEAD].offset;
const WEIGHT_ROLL = SKELETON.limits[SPINE]?.swing[0][1] ?? fail('spine without roll limits');

// [C] Spike: 1.2 m hip, .8 m/s slow walk; Hildebrand walk/Clayton-Hobbs trot offsets;
// Alexander/Jayes stride coefficients, Hodson stance at 1.6/3.7 m/s.
// [D] 5 cm proxy-hoof clearance in both gaits keeps the early sole-height peak above the passive fold.
const walk = powerGait(1.2, 0.8, [0.25, 0.75, 0, 0.5], 2.3, 0.68 * Math.pow(1.6, 0.7), [0.05, 0.05, 0.05, 0.05]);
export const HORSE_WALK = {
  ...walk, referenceSpeed: 1.6, referenceBlend: 1,
  // research-contact.md §5: [R via summary] Dunbar ranges; [D] landmark/hip phase after solving.
  body: { withers: 0.035, trunk: (theta: number) => Math.asin((0.05 * Math.cos(theta - 1.52) - 0.035 * Math.cos(theta)) / SPAN),
    spine: 2.5, spinePhase: 0.3, roll: 4, headPitch: 4.5, headRise: 0.0675, headWithers: 0 },
  // Tuned from the read 28% fore-cannon crossing, allowing for the coffin's forward offset.
  contacts: walk.contacts.map((contact, i) => ({
    ...contact,
    // Tuned: hinds release earlier, before the planted hoof draws the hip into excessive retraction.
    duty: i < 2 ? contact.duty : (v: number, fr: number) => 0.9 * contact.duty(v, fr),
    stanceCenter: i < 2 ? 0.31 : undefined,
  })),
};
export const HORSE_TROT = {
  ...powerGait(1.2, 0.8, [0.52, 0.02, 0, 0.5], 2.15, 0.3 * Math.pow(3.7, 0.7), [0.05, 0.05, 0.05, 0.05]),
  // [R via summary] Dunbar: 1° trunk ROM is the low end of 2±1°; [R/R-s] back 4–6°, roll 9.5°.
  body: { withers: -0.045, trunk: (theta: number) => 0.5 * DEG * Math.cos(theta),
    spine: 3, spinePhase: 0, roll: 4.75, headPitch: 2.5, headRise: 0, headWithers: 1 },
};

// Read: Back et al. 1995 fore/hind abstracts describe TROT at 4 m/s, not walk.
// Recalled: Back et al. 1996 comparison: walk stance has less shoulder/stifle/hock flexion.
// Read: Hodson 2001 abstract (doi:10.2746/042516401776767485): loading flexion <10%, stifle >28%, stifle/hock coupled.
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
// Read: Hodson 2001 (above): maximal protraction before contact; walk folds before toe-off.
// Read via Mendez-Angulo, Effect of Water Level, Table 1: hock walk 125.2–167.6°; 43° target approximates 42.4° ROM.
// Read: Egenvall et al. 2023, doi:10.7717/peerj.16373: circle-walk hip ROM 16.8–20.7°.
// Tuned soft references: smaller hip curves/stronger preference shift contact correction distally;
// hock keys counter it in support. Report solved excursions (hip ~17–21°), not these targets.
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
// Tuned walk: spring under load, then modest pastern fold; trot folds turned the free hoof under.
const FORE_FETLOCK = cycle([[0, 5], [0.22, 30], [0.45, 0], [0.55, -30], [0.68, -55], [0.82, -20], [0.95, 0]],
  [[0, 5], [0.22, 30], [0.45, 0], [0.55, -30 * 35 / 55], [0.68, -35], [0.82, -20 * 35 / 55], [0.95, 0]]);
const FORE_COFFIN = cycle([[0, 0], [0.22, -5], [0.45, 10], [0.6, -15], [0.8, -5]],
  [[0, 0], [0.22, -5], [0.45, 10], [0.6, 8], [0.8, 4]]);
// Tuned 0° free-swing hind fetlock keys: the walk’s hind pastern relaxes after support; stifle and hock flexion clear the free hoof.
const HIND_FETLOCK = cycle([[0, 5], [0.22, 30], [0.45, 0], [0.55, -30], [0.68, -55], [0.82, -20], [0.95, 0]],
  [[0, 5], [0.22, 30], [0.45, 0], [0.55, 0], [0.68, 0], [0.82, 0], [0.95, 0]]);
const HIND_COFFIN = cycle([[0, 0], [0.22, -5], [0.45, 10], [0.6, -15], [0.8, -5]],
  [[0, 0], [0.22, -5], [0.45, 10], [0.6, 35], [0.8, 15]]);
// Tuned hoof stance pitch (°, +toe up): finish breakover before lift-off to brake downward spin.
const BREAKOVER: LegChain['rocker'] = [[0, 0], [0.75, 0], [0.9, -25], [1, -25]];

export const horseLegs = (): readonly LegChain[] => LEGS.map((leg): LegChain => ({
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

function fail(what: string): never { throw new Error(what); }

// Tuned follower acceleration (m/s²); catch-up speed is capped at the reference walk.
const FOLLOW_ACCEL = 0.65;
/** Follow a floor goal with the horse's pelvis, legs and head working together. */
export function horseFollow(start: ReadonlyPose, goal: Live<Pick<Target, 'position' | 'velocity'>>, options: HorseAttention = {}): Behaviour & { react(point: Readonly<Vector3>): void } {
  const body = horseMotion(start, HORSE_WALK);
  return Object.assign(function* () {
    const legs = new Legs(start, horseLegs(), HORSE_WALK);
    yield* action<Frame>({ update: (f) => {
      body.prepare(f, legs, options);
      const target = live(goal, f);
      const pace = Math.max(HORSE_WALK.slowest, target.velocity?.length() ?? 0);
      const gap = target.position.clone().sub(f.prev.position(0)).setY(0).length();
      const speed = Math.min(HORSE_WALK.referenceSpeed, Math.sqrt(pace ** 2 + 2 * FOLLOW_ACCEL * gap));
      legs.toward(f, target, { speed, accel: FOLLOW_ACCEL });
    } });
  }, { react: body.react });
}

export type HorseGait = Gait & { body: typeof HORSE_WALK.body };
export interface HorseAttention {
  person?: Live<Readonly<Vector3> | undefined>;
  /** Maximum halter-to-knot distance while tied. */
  tether?: Live<{ position: Readonly<Vector3>; length: number } | undefined>;
}

const turn = (x = 0, y = 0, z = 0, out = _q) => out.setFromEuler(_e.set(x, y, z, 'YXZ'));
const channel = (lo: number, hi: number, rate: number, rand: () => number) => ({ lo, hi, rate, next: lo + (hi - lo) * rand(), aim: 0, value: 0 });

/** Attention-only halter point: ignores gait pitch/nod so a lead hand need not chase them. */
export const horseLeadPoint = (pose: ReadonlyPose, out: Vector3): Vector3 =>
  out.copy(HALTER).applyQuaternion(turn(0, yawOf(pose.local(HEAD)))).add(POLL)
    .applyQuaternion(turn(0, yawOf(pose.local(NECK)))).add(NECK_BASE)
    .applyQuaternion(turn(0, yawOf(pose.rotation(0)))).add(pose.position(0));

/** Posture before contact solving; research-contact.md §§5–6: [R-s] contact phase, [C] idle/tail timing.
 * Gait ranges retain the file's [R via summary]/[R/R-s] provenance, not fresh paper readings. */
export function horseMotion(start: ReadonlyPose, gait: HorseGait, seed = seedOf(start.position(0).x, start.position(0).z)) {
  const height = start.position(0).y, rand = seeded(seed), driftPhase = rand() * 2 * Math.PI;
  const idle = { ears: { left: channel(2, 6, 8, rand), right: channel(2, 6, 8, rand) },
    tail: channel(5, 20, 1, rand), head: channel(10, 30, 1, rand), weight: channel(20, 60, 1, rand) };
  const channels = [idle.ears.left, idle.ears.right, idle.tail, idle.head, idle.weight];
  // Tuned first shift at 2–6 s; later shifts 20–60 s and hind rest after 60–180 s quiet [C].
  idle.weight.next = 2 + (idle.weight.next - 20) / 10;
  const rest = { quiet: 0, value: 0, side: 0, at: 60 + 120 * rand(), pitches: [0, 0, 0, 0] };
  const reaction = new Vector3(), tied = { position: new Vector3(), length: 0 }, tail = { angle: 0, rate: 0 };
  let moving = 0, responseTime = Infinity, swish = Infinity;
  return {
    /** Explicit saddle/girth event at a world point; call once per event, not from a live getter. */
    react(point: Readonly<Vector3>): void { reaction.copy(point); responseTime = 0; },
    prepare(f: Frame, legs: Legs, attention: HorseAttention = {}): void {
      if (tied.length) {
        const stretch = f.prev.point(HEAD, HALTER, _point).distanceTo(tied.position);
        if (stretch > tied.length + 1e-4) f.dev?.append(f.time - f.dt, { check: 'horse tether (m)', value: stretch, limit: tied.length, where: 'halter' });
      }
      const speed = _point.copy(f.prev.position(0)).sub(f.prev2.position(0)).setY(0).length() / f.dt;
      moving += (Math.min(1, speed / gait.slowest) - moving) * (1 - Math.exp(-4 * f.dt));
      rest.quiet = speed < 0.01 ? rest.quiet + f.dt : 0;
      const m = moving, t = f.time, body = gait.body;
      const stride = strideAt(gait, speed, 0);
      const phase = 2 * Math.PI * (legs.legs[0].phase + (speed > 0 ? stride.frequency * f.dt : 0));
      const wave = Math.cos(2 * phase), hind = 2 * Math.PI * (legs.legs[2].phase + (speed > 0 ? stride.frequency * f.dt : 0));
      swish += f.dt;
      // [D] Ear/head goals cross neutral so each scheduled posture change remains visible.
      for (const c of channels) {
        if (t >= c.next) {
          c.aim = (c.aim > 0 ? -1 : 1) * (0.25 + 0.75 * rand());
          if (c === idle.tail) swish = 0;
          c.next = t + c.lo + (c.hi - c.lo) * rand();
        }
        c.value += (c.aim - c.value) * (1 - Math.exp(-c.rate * f.dt));
      }
      if (rest.quiet >= rest.at) { rest.side = rest.side ? -rest.side : (rand() < 0.5 ? 1 : -1); rest.at = rest.quiet + 60 + 240 * rand(); }
      rest.value += ((rest.quiet >= 60 ? rest.side : 0) * (1 - m) - rest.value) * (1 - Math.exp(-f.dt));
      rest.pitches[2] = -25 * Math.max(0, rest.value); rest.pitches[3] = 25 * Math.min(0, rest.value);
      legs.rest(rest.pitches);
      const person = attention.person && live(attention.person, f);
      responseTime += f.dt;
      const response = minimumJerk(responseTime / 0.25) * (1 - minimumJerk((responseTime - 1) / 3));
      const inverse = turn(0, -yawOf(f.prev.rotation(0)), 0, _inverse);
      if (person) _person.copy(person).sub(f.prev.position(0)).applyQuaternion(inverse);
      _reaction.copy(reaction).sub(f.prev.position(0)).applyQuaternion(inverse);
      const attended = person && person.distanceTo(f.prev.position(HEAD)) < 5 ? clamp(Math.atan2(_person.x, _person.z), -0.55, 0.55) : 0;
      const toward = Math.sign(_reaction.x);
      const previous = _e.setFromQuaternion(f.prev.local(NECK), 'YXZ').y;
      const distance = person ? person.distanceTo(f.prev.position(HEAD)) : Infinity;
      // Retained avoidance: 0.8 m / 0.3 m transition, 0.5 rad, 0.25 s response.
      const away = person ? -Math.sign(_person.x) * 0.5 * Math.max(0, Math.min(1, (0.8 - distance) / 0.3)) : 0;
      // Tuned gains (rad): neck .35/head .2 sum to 31.5° look-back [D]; ears −.3, pelvis .025, tail .2.
      const wanted = away || (0.3 * attended * (1 - m) + 0.18 * idle.head.value * (1 - m) + 0.35 * toward * response);
      const yaw = previous + (clamp(wanted, -0.55, 0.55) - previous) * (1 - Math.exp(-4 * f.dt));
      // Tuned: inherited drift frequencies .79/1.37/2.11 rad/s, not measured physiology.
      const drift = irregular(t, driftPhase, 0.79, 1.37, 2.11) * (1 - m);
      const theta = 2 * phase - 2 * Math.PI * stride.duty;
      const sway = Math.cos(hind - Math.PI * strideAt(gait, speed, 2).duty);
      const withers = body.withers * Math.cos(theta) * m, pitch = body.trunk(theta) * m;
      const rootHeight = height + withers + WITHERS * Math.sin(pitch) - 0.04 * Math.abs(rest.value) + 0.003 * drift;
      f.current.setRoot(_point.copy(f.prev.position(0)).setY(rootHeight));
      f.current.setLocal(0, turn(pitch, yawOf(f.prev.rotation(0))));
      // [D] Hip-axis roll within the skeleton's range shifts the croup up to 2.5 cm; rests take over.
      f.current.setLocal(SPINE, turn(body.spine * DEG * Math.cos(theta - body.spinePhase) * m, 0, WEIGHT_ROLL * idle.weight.value * (1 - m) * (1 - Math.abs(rest.value))));
      f.current.setLocal(PELVIS, turn(0, 2.5 * DEG * sway * m, body.roll * DEG * sway * m + (-0.12 * rest.value + 0.025 * toward * response) * (1 - m)));
      const neckBase = f.current.position(NECK).y;
      const poll = height + NECK_BASE.y + POLL.y + body.headWithers * withers + body.headRise * wave * m;
      const nod = Math.atan2(POLL.y, POLL.z) - Math.asin(clamp((poll - neckBase) / Math.hypot(POLL.y, POLL.z), -0.9, 0.9)) - pitch;
      f.current.setLocal(NECK, turn(nod + 0.025 * drift, yaw));
      f.current.setLocal(HEAD, turn(body.headPitch * DEG * wave * m - pitch - nod, 0.2 * toward * response));
      EARS.forEach((ear, i) => f.current.setLocal(ear, turn(-0.3 * response, clamp(attended + (i === 0 ? idle.ears.left : idle.ears.right).value * 0.7 + toward * response, -2, 2)), 1 - Math.exp(-10 * f.dt)));
      // [C] Critically damped follower, ~0.15 s lag; independent seeded fly swishes.
      const tailGoal = -2 * _e.setFromQuaternion(f.current.local(PELVIS), 'YXZ').z + 0.7 * Math.sin(2 * Math.PI * Math.min(1, swish / 1.2)) * Math.sign(idle.tail.aim) * (1 - m) + 0.03 * drift + 0.2 * response;
      tail.rate += (100 * (tailGoal - tail.angle) - 20 * tail.rate) * f.dt;
      tail.angle += tail.rate * f.dt;
      f.current.setLocal(TAIL, turn(0.05 * m * Math.sin(2 * phase - 1), tail.angle));
      const tether = attention.tether && live(attention.tether, f);
      tied.length = tether?.length ?? 0;
      if (tether) {
        if (!(tether.length > 0 && Number.isFinite(tether.length)) || !tether.position.toArray().every(Number.isFinite)) throw new Error('horse tether needs a finite point and positive length');
        tied.position.copy(tether.position);
        const neck = _neck.copy(f.current.local(NECK)), head = _head.copy(f.current.local(HEAD));
        const knot = _point.copy(tether.position).sub(f.current.position(NECK)).applyQuaternion(inverse);
        const base = turn(0, clamp(Math.atan2(knot.x, knot.z), -0.55, 0.55), 0, _base);
        f.current.setLocal(NECK, base); f.current.setLocal(HEAD, _q.identity());
        if (f.current.point(HEAD, HALTER, _point).distanceTo(tether.position) > tether.length) throw new Error('horse tether outside neck reach');
        let lo = 0, hi = 1;
        for (let i = 0; i < 12; i++) {
          const u = (lo + hi) / 2;
          f.current.setLocal(NECK, _q.copy(base).slerp(neck, u)); f.current.setLocal(HEAD, _q.identity().slerp(head, u));
          if (f.current.point(HEAD, HALTER, _point).distanceTo(tether.position) <= tether.length) lo = u; else hi = u;
        }
        f.current.setLocal(NECK, _q.copy(base).slerp(neck, lo)); f.current.setLocal(HEAD, _q.identity().slerp(head, lo));
      }
    }
  };
}

const _q = new Quaternion(), _inverse = new Quaternion(), _neck = new Quaternion(), _head = new Quaternion(), _base = new Quaternion();
const _e = new Euler(), _point = new Vector3(), _person = new Vector3(), _reaction = new Vector3();
