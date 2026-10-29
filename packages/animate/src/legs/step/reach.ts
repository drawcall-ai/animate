// How far a leg reaches and where its hip is: the geometry the stepper decides its steps by.
import { Vector3 } from 'three';
import { forwardOf, leftOf, lerp, minimumJerk, smoothstep } from '../../kernel/math';
import { xcomOf } from '../support';
import { FLAT, foothold } from '../floor';
import { ROLL, _a, _b, _f, _l, _m, _o, _v, _x, dropOf, rollOf, type Body, type Leg, type Now, type Reading, type Steps, type Timing } from './state';

/** the place of a leg's hip, the pelvis turned with the stride */
export function hipOf(steps: Steps, now: Now, leg: Leg): Vector3 {
  const { feet } = steps, build = feet.legs[leg.i], facing = now.yaw + steps.turn, out = leg.sign * (build.hip ?? feet.hip);
  return steps.hipScratch.copy(steps.pelvis).addScaledVector(leftOf(facing), out).addScaledVector(forwardOf(facing, _o), build.ahead ?? 0);
}

/** How high a leg's hip reaches its foot (m): planted as rolled as it may be, or with its ankle `given`. */
export function reach(steps: Steps, now: Now, leg: Leg, given?: Vector3): number {
  const { st, feet } = steps, { yaw } = now, build = feet.legs[leg.i], up = build.up ?? 0;
  const pitch = given ? 0 : rolled(steps, now, leg);
  const ankle = given ?? feet.ankle(leg.i, leg.anchor, leg.yaw, pitch, _a);
  const at = hipOf(steps, now, leg), horizontal = Math.hypot(ankle.x - at.x, ankle.z - at.z), depth = build.depth;
  // (its joints' own reach where they reach at all; past that, as a sphere of its length: the stray check steps it)
  if (depth) {
    const out = (ankle.x - at.x) * leftOf(yaw, _l).x * leg.sign + (ankle.z - at.z) * leftOf(yaw, _l).z * leg.sign;
    const down = depth(out, _o.subVectors(ankle, at).dot(forwardOf(yaw, _f)), pitch);
    if (down > -Infinity) return ankle.y + down - up;
  }
  return ankle.y + Math.sqrt(Math.max(0, (st.reach * lengthOf(steps, leg)) ** 2 - horizontal ** 2)) - up;
}

export function lengthOf(steps: Steps, leg: Leg): number { return steps.feet.legs[leg.i].length ?? steps.feet.length; }
export function homeOf(steps: Steps, leg: Leg): number { return steps.feet.legs[leg.i].home ?? steps.feet.legs[leg.i].ahead ?? 0; }

/** a foot's home `ahead` s on: under its hip as the root goes, the stance's width out */
function home(steps: Steps, now: Now, leg: Leg, ahead: number, out: Vector3): Vector3 {
  const { r, yaw, width, sitting } = now;
  const root = r.forecast ? out.copy(r.forecast(ahead).position) : out.copy(r.position).addScaledVector(r.velocity, ahead);
  return root.addScaledVector(leftOf(yaw), leg.sign * width).addScaledVector(forwardOf(yaw), sitting + homeOf(steps, leg)).setY(steps.feet.ankleHeight);
}

/** how far a foot is from its home `ahead` s on (m): on a floor that is not level, from where that home fits onto it (a foot that cannot go
 * nearer — a tread's edge before it — is home where it fits, and does not step again for it) */
export function offHome(steps: Steps, now: Now, leg: Leg, ahead: number): number {
  const at = home(steps, now, leg, ahead, _v);
  if (steps.floor !== FLAT) foothold(steps.floor, steps.feet, leg.i, at, now.yaw + leg.sign * steps.st.toeOut);
  return at.sub(leg.anchor).setY(0).length();
}

/** a planted foot as far rolled as it may be; with the hip over it, no further than its strike's roll: there it changes ends */
function rolled(steps: Steps, now: Now, leg: Leg): number {
  const s = steps.st.scale, limit = pivotLimit(steps, now, leg);
  return lerp(rollOf(leg), limit, Math.max(Number(now.tiptoe > 0), smoothstep(PIVOT * s, 2 * PIVOT * s, Math.abs(aheadOf(steps, now, leg)))));
}

/** the most a planted foot rolls to help the hip reach it: onto its heel when it is ahead, its ball when behind */
export function pivotLimit(steps: Steps, now: Now, leg: Leg): number {
  // (it changes ends only while it needs no roll past its strike's: changed mid-roll, the roll would jump)
  if (leg.free) leg.heel = now.tiptoe === 0 && aheadOf(steps, now, leg) < 0;
  // (just landed, it first rolls off its strike: the pivot is given over as the roll ends)
  return pointed(steps, now, leg, lerp(rollOf(leg), leg.heel ? steps.st.pitch.heel : steps.st.pitch.ball, minimumJerk(leg.planted / ROLL)));
}

export function pointed(steps: Steps, now: Now, leg: Leg, pitch: number, at?: Vector3): number {
  const { st, feet } = steps;
  if (st.plantarflexion === undefined) return pitch;
  // (the shank as the last pose stood it does not turn with the roll: once is enough)
  if (!at) return Math.max(pitch, -st.plantarflexion - feet.lean(leg.i, now.f.prev, leg.yaw));
  // (rolling moves the ankle and turns the shank: enforce the pointing limit at that new position too)
  for (let pass = 0; pass < 3; pass++) pitch = Math.max(pitch, -st.plantarflexion - shankLean(steps, at, feet.ankle(leg.i, leg.anchor, leg.yaw, pitch, _a), leg.yaw));
  return pitch;
}

export function aheadOf(steps: Steps, now: Now, leg: Leg): number {
  return _v.subVectors(hipOf(steps, now, leg), leg.anchor).dot(forwardOf(leg.yaw));
}

/** how far the shank leans forward over a foot heading `yaw` with the hip at `hip` and the ankle at `ankle`, the knee bent toward the toes (rad) */
export function shankLean(steps: Steps, hip: Vector3, ankle: Vector3, yaw: number): number {
  const { feet } = steps;
  const along = _b.subVectors(ankle, hip), l = along.length();
  along.divideScalar(l);
  const a = (feet.thigh ** 2 - feet.shin ** 2 + l * l) / (2 * l), rise = Math.sqrt(Math.max(0, feet.thigh ** 2 - a * a));
  const fw = forwardOf(yaw, _f), side = _m.copy(fw).addScaledVector(along, -fw.dot(along)).normalize();
  const shin = _l.copy(hip).addScaledVector(along, a).addScaledVector(side, rise).sub(ankle);
  return Math.atan2(shin.dot(fw), shin.y);
}

/** The pelvis' height: let down walking, bobbing lowest after contact (running: mid-stance) — on stairs less, its legs bent over the
 * treads, `STAIRS` of the bob gone on a flight's slope — the leap's rise on it. */
export function nominal(steps: Steps, body: Body): number {
  const { st, legs } = steps, { standing, rise, run, Ts, v, climb } = body;
  const moving = body.moving * (1 - STAIRS.bob * smoothstep(0, STAIRS.slope, Math.abs(climb) / Math.max(v, STAIRS.slow)));
  const swinging = 1 - Math.min(1, legs.reduce((sum, leg) => sum + (leg.swing ? Math.sin(Math.PI * leg.swing.u) ** 2 : 0), 0));
  const planted = Math.min(1, legs.reduce((sum, leg) => sum + (leg.swing ? 0 : Math.sin(Math.PI * Math.min(1, leg.planted / Ts)) ** 2), 0));
  return standing + rise - (dropOf(st, body) + st.bob * lerp(swinging, planted, run)) * st.scale * moving;
}

/**
 * The pelvis' height its legs folded hold it at: crouching too, no lower than a leg folds, as it stood last — its knee bent its most, a
 * planted foot would slide, a swinging one would be held into the floor; deep in a crouch a step lifts the hips as it lifts the foot.
 */
export function foldOf(steps: Steps, now: Now): number {
  const { feet, legs } = steps;
  const folded = Math.sqrt(feet.thigh ** 2 + feet.shin ** 2 + 2 * feet.thigh * feet.shin * Math.cos(feet.fold));
  return Math.max(-Infinity, ...legs.map((leg, i) => {
    const ankle = steps.poses[i]?.ankle ?? feet.ankle(leg.i, leg.anchor, leg.yaw, leg.pitch, _a), at = hipOf(steps, now, leg);
    return ankle.y + Math.sqrt(Math.max(0, folded ** 2 - (ankle.x - at.x) ** 2 - (ankle.z - at.z) ** 2)) - (feet.legs[i].up ?? 0);
  }));
}

/** the extrapolated centre of mass `ahead` s on: the root carried on, the centre of mass where it is over it — as `r.xcom` is */
export function xcomAhead(steps: Steps, now: Body, ahead: number, out: Vector3): Vector3 {
  const at = travelOf(steps, now, ahead, out).add(now.over).addScaledVector(forwardOf(now.yaw, _f), now.sitting);
  return xcomOf(at, pace(steps, now, ahead, _x), steps.feet.length, out);
}

/** where the root will be `ahead` s on, its speed changing as it does now: how far a hard stop or turn leaves a landing */
export function travelOf(steps: Steps, { r, accel }: Reading, ahead: number, out: Vector3): Vector3 {
  if (r.forecast) return out.copy(r.forecast(ahead).position);
  return out.copy(r.position).addScaledVector(r.velocity, ahead).addScaledVector(accel, ahead * ahead / 2);
}

/** and its velocity then: a walker's as foreseen, braking where it brakes; else run on at its acceleration */
export function pace(steps: Steps, { r, accel, dt }: Reading, ahead: number, out: Vector3): Vector3 {
  if (r.forecast) return out.subVectors(r.forecast(ahead + dt).position, r.forecast(ahead).position).divideScalar(dt).setY(0);
  return out.copy(r.velocity).addScaledVector(accel, ahead).setY(0);
}

/** half the feet's spread at `speed` (m): side-stepping, the feet open wider and close in to the narrowest: their travel never crosses */
export function widthAt(steps: Steps, { across, Ts, crouch }: Reading & Timing, speed: number): number {
  const { st } = steps, s = st.scale, { width } = st;
  const gait = lerp(lerp(width.stand, width.walk * s, smoothstep(0, 1, speed)), width.run * s, smoothstep(st.run[0], st.run[1], speed));
  return Math.max(gait, (width.narrowest * s + Math.abs(across) * speed * Ts) / 2) + st.crouch.wider * s * crouch;
}

/** Tuned: on a slope of `slope` (rise per run) or steeper — a stair's (recalled ~0.4–0.7) — the walking bob is `bob` less; read at no
 * slower than `slow` (m/s) */
const STAIRS = { bob: 0.6, slope: 0.3, slow: 0.3 };
/** Tuned: within `PIVOT` (m) of being over a planted foot the hip lets it settle flat to change the end it rolls on */
const PIVOT = 0.03;
