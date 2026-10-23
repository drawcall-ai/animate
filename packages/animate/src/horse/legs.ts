import { live } from '../core/goal';
import type { ReadonlyPose } from '../core/pose';
import { Euler, Quaternion, Vector3 } from 'three';
import { clamp, minimumJerk, yawOf } from '../core/math';
import { seedOf } from '../core/random';
import { swing } from '../core/life';
import type { Gait } from '../core/legs/gait';
import { carriage, type CarriedBones, type Striding } from '../core/legs/carriage';
import type { Frame } from '../core/body';
import type { LegChain } from '../core/legs/legs';
import type { JointCycle } from '../core/legs/cycle';
import { EARS, HALTER, HEAD, LEGS, NECK, SKELETON } from './skeleton';
import { powerGait, stanceOf } from '../core/legs/schedule';
import type { Attention, Species } from '../core/species';

/** a horse: its walk, and its posture over its legs as it heeds what it looks at, a tether and a startle */
export const horse = (): Species<never> => ({ skeleton: SKELETON, gaze: { eyes: (pose, out) => pose.point(HEAD, EYES, out), range: EYE_RANGE },
  legs: { chains: horseLegs(), gait: HORSE_WALK, posture: (start, gait) => horseMotion(start, gait) }, inertia: INERTIA });
/**
 * How the horse's trunk takes its acceleration: pitched as a dog's but less (read: Walter & Carrier 2009 for a dog setting off, 0.3–0.5
 * of atan(a / g); no horse's measure found; tuned: below that, its forelegs straight in stance taking no more of its withers let down);
 * rolled into a bend ~1° short of atan(v² / r g) (read via summary: Brocklehurst et al. 2014: 12.0° at 13.1°, 19.0° at 19.8°); its
 * response a person's (0.8 Hz at 0.9 m hips) made dynamically similar on its 1.2 m legs: × √(0.9 / 1.2)
 */
const INERTIA = { ahead: 0.25, back: 0.2, roll: 0.9, most: 0.3, frequency: 0.7, damping: 0.65 };
/** [D] between the eyes, about a third of the way from the poll to the muzzle (m, head bone) */
const EYES = new Vector3(0, -0.12, 0.1);
/** Tuned (rad): the eyes add little to where the head turns (the posture turns it) */
const EYE_RANGE = { down: 0.2, up: 0.2, side: 0.3 };

const NECK_BASE = SKELETON.bones[NECK].offset, POLL = SKELETON.bones[HEAD].offset;

// [C] Spike: 1.2 m hip, .8 m/s slow walk; Hildebrand walk/Clayton-Hobbs trot offsets;
// Alexander/Jayes stride coefficients, Hodson stance at 1.6/3.7 m/s.
// [D] 5 cm proxy-hoof clearance in both gaits keeps the early sole-height peak above the passive fold.
const walk = powerGait({ height: 1.2, slowest: 0.8, offsets: [0.25, 0.75, 0, 0.5], stride: 2.3, stance: stanceOf(0.68, 1.6, 1.2), clearance: [0.05, 0.05, 0.05, 0.05] });
export const HORSE_WALK: Gait = {
  ...walk, referenceSpeed: 1.6, referenceBlend: 1,
  // research-contact.md §5: [R via summary] Dunbar ranges; [D] landmark/hip phase after solving. [D] The croup's rise × 1.1 since the pelvis
  // moved 9 cm back: the trunk pitching ~6° over a back that much longer (read: Dunbar et al. 2008, withers 7 ± 1 cm, head 12–15 cm, its
  // pitch ~9°; Faber et al. 2000, the back flexing ~7° twice a stride at 1.6 m/s — the test's bounds).
  body: { withers: 0.035, croup: [0.055, 1.52], spine: 2.5, spinePhase: 0.3, roll: 4, yaw: 2.5, headPitch: 4.5, headRise: 0.0675, headWithers: 0 },
  // Tuned from the read 28% fore-cannon crossing, allowing for the coffin's forward offset.
  contacts: walk.contacts.map((contact, i) => ({
    ...contact,
    // Tuned: hinds release earlier, before the planted hoof draws the hip into excessive retraction.
    duty: i < 2 ? contact.duty : (v: number, fr: number) => 0.9 * contact.duty(v, fr),
  })),
};
export const HORSE_TROT: Gait = {
  ...powerGait({ height: 1.2, slowest: 0.8, offsets: [0.52, 0.02, 0, 0.5], stride: 2.15, stance: stanceOf(0.3, 3.7, 1.2), clearance: [0.05, 0.05, 0.05, 0.05] }),
  // [R via summary] Dunbar: 1° trunk ROM is the low end of 2±1°; [R/R-s] back 4–6°, roll 9.5°. [D] The croup with the withers
  // but for 0.5° of trunk pitch over the 1.14 m between withers and croup.
  body: { withers: -0.045, croup: [-0.035, 0], spine: 3, spinePhase: 0, roll: 4.75, yaw: 2.5, headPitch: 2.5, headRise: 0, headWithers: 1 },
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

const turn = (x = 0, y = 0, z = 0, out = _q) => out.setFromEuler(_e.set(x, y, z, 'YXZ'));
/**
 * What the horse's gait carries, and its quiet life [C]: ears flick every 2–6 s, the tail swishes every 5–20 s, the head turns every
 * 10–30 s and the weight shifts every 20–60 s (tuned: the first at 2–6 s); each goal crosses neutral so every change shows [D].
 */
const HORSE_CARRIAGE: CarriedBones = { spine: 'back', pelvis: 'pelvis', neck: 'neck', head: 'head', tail: 'tail', swish: { amplitude: 0.7, period: 1.2, cycles: 1 }, life: [
  ['leftEar', { every: [2, 6], rate: 8, pick: swing }], ['rightEar', { every: [2, 6], rate: 8, pick: swing }],
  ['tail', { every: [5, 20], rate: 1, pick: swing }], ['head', { every: [10, 30], rate: 1, pick: swing }],
  ['weight', { every: [20, 60], first: [2, 6], rate: 1, pick: swing }],
] };

/** Attention-only halter point: ignores gait pitch/nod so a lead hand need not chase them. */
export const horseLeadPoint = (pose: ReadonlyPose, out: Vector3): Vector3 =>
  out.copy(HALTER).applyQuaternion(turn(0, yawOf(pose.local(HEAD)))).add(POLL)
    .applyQuaternion(turn(0, yawOf(pose.local(NECK)))).add(NECK_BASE)
    .applyQuaternion(turn(0, yawOf(pose.rotation(0)))).add(pose.position(0));

/** Posture before contact solving; research-contact.md §§5–6: [R-s] contact phase, [C] idle/tail timing.
 * Gait ranges retain the file's [R via summary]/[R/R-s] provenance, not fresh paper readings. */
export function horseMotion(start: ReadonlyPose, gait: Gait, seed = seedOf(start.position(0).x, start.position(0).z)) {
  const carried = carriage(start, horseLegs(), HORSE_CARRIAGE, gait, seed), idle = carried.life, rand = idle.rand;
  const rest = { quiet: 0, value: 0, side: 0, at: 60 + 120 * rand(), pitches: [0, 0, 0, 0] };
  const reaction = new Vector3(), tied = { position: new Vector3(), length: 0 };
  let responseTime = Infinity, startled: Readonly<Vector3> | undefined;
  /** a saddle/girth event at a world point: the horse turns to it and settles over about four seconds */
  const react = (point: Readonly<Vector3>): void => { reaction.copy(point); responseTime = 0; };
  return {
    react,
    prepare(f: Frame, legs: Striding, attention: Attention = {}, look: Readonly<Vector3> | null = null): void {
      // (a new startle point is a new event)
      const startle = attention.startle && live(attention.startle, f);
      if (startle && startle !== startled) react(startled = startle);
      if (tied.length) {
        const stretch = f.prev.point(HEAD, HALTER, _point).distanceTo(tied.position);
        if (stretch > tied.length + 1e-4) f.dev?.append(f.time - f.dt, { check: 'horse tether (m)', value: stretch, limit: tied.length, where: 'halter' });
      }
      carried.step(f, legs);
      const m = carried.moving;
      rest.quiet = carried.speed < 0.01 ? rest.quiet + f.dt : 0;
      if (rest.quiet >= rest.at) { rest.side = rest.side ? -rest.side : (rand() < 0.5 ? 1 : -1); rest.at = rest.quiet + 60 + 240 * rand(); }
      rest.value += ((rest.quiet >= 60 ? rest.side : 0) * (1 - m) - rest.value) * (1 - Math.exp(-f.dt));
      rest.pitches[2] = -25 * Math.max(0, rest.value); rest.pitches[3] = 25 * Math.min(0, rest.value);
      legs.rest(rest.pitches);
      responseTime += f.dt;
      const response = minimumJerk(responseTime / 0.25) * (1 - minimumJerk((responseTime - 1) / 3));
      const inverse = turn(0, -yawOf(f.prev.rotation(0)), 0, _inverse);
      if (look) _look.copy(look).sub(f.prev.position(0)).applyQuaternion(inverse);
      _reaction.copy(reaction).sub(f.prev.position(0)).applyQuaternion(inverse);
      const attended = look && look.distanceTo(f.prev.position(HEAD)) < 5 ? clamp(Math.atan2(_look.x, _look.z), -0.55, 0.55) : 0;
      const toward = Math.sign(_reaction.x);
      const distance = look ? look.distanceTo(f.prev.position(HEAD)) : Infinity;
      // Retained avoidance: 0.8 m / 0.3 m transition, 0.5 rad, 0.25 s response.
      const away = look ? -Math.sign(_look.x) * 0.5 * Math.max(0, Math.min(1, (0.8 - distance) / 0.3)) : 0;
      // Tuned gains (rad): neck .35/head .2 sum to 31.5° look-back [D]; ears −.3, pelvis .025, tail .2.
      // [D] Hip-axis roll within the skeleton's range shifts the croup up to 2.5 cm; rests take over.
      carried.write(f, {
        lift: -0.04 * Math.abs(rest.value), weight: 1 - Math.abs(rest.value),
        pelvisRoll: (-0.12 * rest.value + 0.025 * toward * response) * (1 - m),
        neckYaw: away || (0.3 * attended * (1 - m) + 0.18 * idle.value('head') * (1 - m) + 0.35 * toward * response),
        headYaw: 0.2 * toward * response, tail: 0.2 * response,
      });
      EARS.forEach((ear, i) => f.current.setLocal(ear, turn(-0.3 * response, clamp(attended + idle.value(i === 0 ? 'leftEar' : 'rightEar') * 0.7 + toward * response, -2, 2)), 1 - Math.exp(-10 * f.dt)));
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
const _e = new Euler(), _point = new Vector3(), _look = new Vector3(), _reaction = new Vector3();
