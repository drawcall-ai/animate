// How far a leg reaches and where its hip is: the geometry the stepper decides its steps by.
import { MathUtils, Vector3 } from 'three';
import { forwardOf, leftOf, lerp, minimumJerk } from '../kernel/math';
import { xcomOf } from './support';
import { FLAT, foothold, LEVEL } from './floor';
import { type Steps } from './steps';
import type { StepBody, Leg, StepInput, Reading, Timing, Stepping } from './types';

/** the place of a leg's hip, the pelvis turned with the stride */
export function hipOf(steps: Steps, input: StepInput, leg: Leg): Vector3 {
  const { feet } = steps, build = feet.legs[leg.i], facing = input.yaw + steps.turn, out = leg.sign * (build.hip ?? feet.hip);
  return steps.hipScratch.copy(steps.pelvis).addScaledVector(leftOf(facing), out).addScaledVector(forwardOf(facing, _o), build.ahead ?? 0);
}

/** How high a leg's hip reaches its foot (m): planted as rolled as it may be, or with its ankle `given`. */
export function legReach(steps: Steps, input: StepInput, leg: Leg, given?: Vector3): number {
  const { st, feet } = steps, { yaw } = input, build = feet.legs[leg.i], up = build.up ?? 0;
  const pitch = given ? 0 : rolled(steps, input, leg);
  const ankle = given ?? feet.ankle(leg.i, leg.anchor, leg.yaw, pitch, _a);
  const at = hipOf(steps, input, leg), horizontal = Math.hypot(ankle.x - at.x, ankle.z - at.z), depth = build.depth;
  // (its joints' own reach where they reach at all; past that, as a sphere of its length: the stray check steps it)
  if (depth) {
    const out = (ankle.x - at.x) * leftOf(yaw, _l).x * leg.sign + (ankle.z - at.z) * leftOf(yaw, _l).z * leg.sign;
    const down = depth(out, _o.subVectors(ankle, at).dot(forwardOf(yaw, _f)), pitch);
    if (down > -Infinity) return ankle.y + down - up;
  }
  return ankle.y + Math.sqrt(Math.max(0, (st.reach * lengthOf(steps, leg)) ** 2 - horizontal ** 2)) - up;
}

export function lengthOf(steps: Steps, leg: Leg): number { return steps.feet.legs[leg.i].length ?? steps.feet.length; }
export function homeOf(steps: Steps, leg: Leg): number { return (steps.feet.legs[leg.i].home ?? 0) + (steps.stagger?.[leg.i] ?? 0); }

/** a foot's home `ahead` s on: where its leg sets it off the root as the root goes, the stance's width out */
export function home(steps: Steps, input: StepInput, leg: Leg, ahead: number, out: Vector3): Vector3 {
  const { r, yaw, width, sitting } = input;
  const root = r.forecast ? out.copy(r.forecast(ahead).position) : out.copy(r.position).addScaledVector(r.velocity, ahead);
  return root.addScaledVector(leftOf(yaw), leg.sign * width).addScaledVector(forwardOf(yaw), sitting + homeOf(steps, leg)).setY(steps.feet.ankleHeight);
}

/** how far a foot is from its home `ahead` s on (m): on a floor that is not level, from where that home fits onto it (a foot that cannot go
 * nearer — a tread's edge before it — is home where it fits, and does not step again for it) */
export function offHome(steps: Steps, input: StepInput, leg: Leg, ahead: number): number {
  const at = home(steps, input, leg, ahead, _v);
  if (steps.floor !== FLAT) {
    // (where the body stands, its home on the level the foot stands on — over its edge, a tread shorter than the foot: not the one below)
    const level = leg.anchor.y - steps.feet.ankleHeight, stays = staysOn(steps, input, level, ahead);
    foothold(steps.floor, steps.feet, leg.i, at, input.yaw + leg.sign * steps.st.toeOut, undefined, stays ? level : undefined, stays);
  }
  return at.sub(leg.anchor).setY(0).length();
}

/** whether a foot on level `level` steps where the body stands: its root over that level, now and `ahead` s on, gone no further than
 * `IN_PLACE` (m, default body) — turning, squaring, not a step up or down a flight */
export function staysOn(steps: Steps, input: StepBody, level: number, ahead: number): boolean {
  if (steps.floor === FLAT) return false;
  const { contact, r } = input, at = travelOf(input, ahead, _stay);
  const on = ({ x, z }: Vector3) => Math.abs(steps.floor(x, z) - level) <= LEVEL;
  const near = Math.hypot(at.x - r.position.x, at.z - r.position.z) < IN_PLACE * steps.st.scale;
  if (!contact) return near && on(r.position) && on(at);
  // (standing on physics' support, the level it stands on; going on, the way it goes from there)
  if (near) return Math.abs(contact.y - level) <= LEVEL;
  return on(contact) && on(at.add(contact).sub(r.position));
}
/** Tuned (m, default body): a root going no further than this as a foot lands steps it where it stands (a stair's tread is ~0.25–0.45) */
const IN_PLACE = 0.15;
const _stay = new Vector3();

/** a planted foot as far rolled as it may be; with the hip over it, no further than its strike's roll: there it changes ends */
function rolled(steps: Steps, input: StepInput, leg: Leg): number {
  const s = steps.st.scale, limit = pivotLimit(steps, input, leg);
  // (standing, from further: a quiet stance holds its centre of mass ~4–6 cm ahead of the ankles and sways about it — read: Winter 1995 —
  // which would roll the feet up and down, the pelvis bobbing with them)
  const from = lerp(STANDING_PIVOT, PIVOT, input.moving) * s;
  return lerp(rollOf(leg), limit, Math.max(Number(input.tiptoe > 0), MathUtils.smoothstep(Math.abs(aheadOf(steps, input, leg)), from, from + PIVOT * s)));
}

/** the most a planted foot rolls to help the hip reach it: onto its heel when it is ahead, its ball when behind */
export function pivotLimit(steps: Steps, input: StepInput, leg: Leg): number {
  // (it changes ends only while it needs no roll past its strike's: changed mid-roll, the roll would jump)
  if (leg.free) leg.heel = input.tiptoe === 0 && aheadOf(steps, input, leg) < 0;
  // (just landed, it first rolls off its strike: the pivot is given over as the roll ends)
  return pointed(steps, input, leg, lerp(rollOf(leg), leg.heel ? steps.st.pitch.heel : steps.st.pitch.ball, minimumJerk(leg.planted / ROLL)));
}

export function pointed(steps: Steps, input: StepInput, leg: Leg, pitch: number, at?: Vector3): number {
  const { st, feet } = steps;
  if (st.plantarflexion === undefined) return pitch;
  // (the shank as the last pose stood it does not turn with the roll: once is enough)
  if (!at) return Math.max(pitch, -st.plantarflexion - feet.lean(leg.i, input.f.prev, leg.yaw));
  // (rolling moves the ankle and turns the shank: enforce the pointing limit at that new position too)
  for (let pass = 0; pass < 3; pass++) pitch = Math.max(pitch, -st.plantarflexion - shankLean(steps, at, feet.ankle(leg.i, leg.anchor, leg.yaw, pitch, _a), leg.yaw));
  return pitch;
}

export function aheadOf(steps: Steps, input: StepInput, leg: Leg): number {
  return _v.subVectors(hipOf(steps, input, leg), leg.anchor).dot(forwardOf(leg.yaw));
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
export function nominal(steps: Steps, body: StepBody): number {
  const { st, legs } = steps, { standing, rise, run, Ts, v, climb } = body;
  const moving = body.moving * (1 - STAIRS.bob * MathUtils.smoothstep(Math.abs(climb) / Math.max(v, STAIRS.slow), 0, STAIRS.slope));
  const swinging = 1 - Math.min(1, legs.reduce((sum, leg) => sum + (leg.swing ? Math.sin(Math.PI * leg.swing.u) ** 2 : 0), 0));
  const planted = Math.min(1, legs.reduce((sum, leg) => sum + (leg.swing ? 0 : Math.sin(Math.PI * Math.min(1, leg.planted / Ts)) ** 2), 0));
  return standing + rise - (dropOf(st, body) + st.bob * lerp(swinging, planted, run)) * st.scale * moving;
}

/**
 * The pelvis' height its legs folded hold it at: crouching too, no lower than a leg folds, as it stood last — its knee bent its most, a
 * planted foot would slide, a swinging one would be held into the floor; deep in a crouch a step lifts the hips as it lifts the foot.
 */
export function foldOf(steps: Steps, input: StepInput): number {
  const { feet, legs } = steps;
  const folded = foldLength(steps);
  return Math.max(-Infinity, ...legs.map((leg, i) => {
    if (input.contact && leg.swing) return -Infinity;
    const ankle = steps.poses[i]?.ankle ?? feet.ankle(leg.i, leg.anchor, leg.yaw, leg.pitch, _a), at = hipOf(steps, input, leg);
    return ankle.y + Math.sqrt(Math.max(0, folded ** 2 - (ankle.x - at.x) ** 2 - (ankle.z - at.z) ** 2)) - (feet.legs[i].up ?? 0);
  }));
}

/** The hip-to-ankle distance with the knee bent as far as its joints allow. */
export function foldLength({ feet }: Steps): number {
  return Math.sqrt(feet.thigh ** 2 + feet.shin ** 2 + 2 * feet.thigh * feet.shin * Math.cos(feet.fold));
}

/** How far the hips travel up and down over a planted foot (m): from the legs' reach to fully folded. */
export function strokeOf(steps: Steps): number {
  return steps.st.reach * steps.feet.length - foldLength(steps);
}

/** the extrapolated centre of mass `ahead` s on: the root carried on, the centre of mass where it is over it — as `r.xcom` is */
export function xcomAhead(steps: Steps, input: StepBody, ahead: number, out: Vector3): Vector3 {
  const at = travelOf(input, ahead, out).add(input.over).addScaledVector(forwardOf(input.yaw, _f), input.sitting);
  return xcomOf(at, velocityAhead(input, ahead, _x), steps.feet.length, out);
}

/** Where the root will be `ahead` s on: follow its forecast, or keep its pace with braking bounded by a stop. */
export function travelOf({ r, accel }: Reading, ahead: number, out: Vector3): Vector3 {
  if (r.forecast) return out.copy(r.forecast(ahead).position);
  const changing = brakingTime(r.velocity, accel, ahead);
  return out.copy(r.position).addScaledVector(r.velocity, ahead).addScaledVector(accel, changing * (ahead - changing / 2));
}

/** Its velocity then: a walker's as foreseen, or its current pace bounded by a braking stop. */
export function velocityAhead({ r, accel, dt }: Reading, ahead: number, out: Vector3): Vector3 {
  if (r.forecast) return out.subVectors(r.forecast(ahead + dt).position, r.forecast(ahead).position).divideScalar(dt).setY(0);
  return out.copy(r.velocity).addScaledVector(accel, brakingTime(r.velocity, accel, ahead)).setY(0);
}

/** Without a forecast, keep the current pace except for a braking stop; one frame's acceleration is not a sustained command. */
function brakingTime(velocity: Vector3, accel: Vector3, ahead: number): number {
  const slowing = -velocity.dot(accel), change = accel.lengthSq();
  return slowing >= 0 && change > 0 ? Math.min(ahead, slowing / change) : 0;
}

/** half the feet's spread at `speed` (m): side-stepping, the feet open wider and close in to the narrowest: their travel never crosses */
export function widthAt(steps: Steps, { across, Ts, crouch }: Reading & Timing, speed: number): number {
  const { st } = steps, s = st.scale, { width } = st;
  const gait = lerp(lerp(width.stand, width.walk * s, MathUtils.smoothstep(speed, 0, 1)), width.run * s, MathUtils.smoothstep(speed, st.run[0], st.run[1]));
  return Math.max(gait, (width.narrowest * s + Math.abs(across) * speed * Ts) / 2) + st.crouch.wider * s * crouch;
}

/** Tuned: on a slope of `slope` (rise per run) or steeper — a stair's (recalled ~0.4–0.7) — the walking bob is `bob` less; read at no
 * slower than `slow` (m/s) */
const STAIRS = { bob: 0.6, slope: 0.3, slow: 0.3 };
/** Tuned: within `PIVOT` (m) of being over a planted foot the hip lets it settle flat to change the end it rolls on */
const PIVOT = 0.03;
/** Tuned: standing, a planted foot rolls only with the hip this far (m, default body) off it: past a quiet stance's sway over the feet */
const STANDING_PIVOT = 0.08;
const [_v, _a, _b, _x, _l, _f, _m, _o] = Array.from({ length: 8 }, () => new Vector3());

export const dropOf = (st: Stepping, { across, run }: Timing & Reading) => lerp(lerp(st.drop.walk, st.drop.side, Math.abs(across)), st.drop.run, run);
/** how far `x` (rad) is past 0, easing in from `BEND`/2 before it (C¹: the heel starts lifting at rest) */
export const overbend = (x: number) => x <= -BEND / 2 ? 0 : x < BEND / 2 ? (x + BEND / 2) ** 2 / (2 * BEND) : x;
/** a planted foot's roll off its strike (rad): flat after `ROLL` */
export const rollOf = (leg: Leg) => leg.strike * (1 - minimumJerk(leg.planted / ROLL));
/** Tuned: a strike rolls flat in `ROLL` s */
export const ROLL = 0.1;

/** Tuned: the heel's lift eases in over `BEND` (rad) of a lean past the ankle's bend */
const BEND = 0.15;
