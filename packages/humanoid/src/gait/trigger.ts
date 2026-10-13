// Adapted from @prohuman/core (packages/core/src/gait/steps.ts: triggerStep, startSwing), without
// obstacles, walls, foot targets and strides.
import { Vector3 } from 'three';
import { clamp, lerp, wrapAngle } from '../math';
import type { Gait } from './gait';
import { fitLanding, placeFoot, uncaught } from './placement';
import { ankleFor } from './foot';
import { MAX_HEEL, REACH } from './roll';
import { leadTime, type Timing } from './timing';

/** the extrapolated centre of mass is caught by a step once it leaves the feet by this much (m, default body) */
export const CATCH = 0.02;
/** how long a standing body must have been falling before it steps (s) */
/** how far a runner's leg reaches back to its planted foot before it goes (× its length) */
const RUN_REACH = 0.93;
const STILL_FALL = 0.1;
/** how much better a step with the foot that just landed must catch the body to break the alternation (m, default body) */
const ALTERNATE = 0.08;
/** the shortest step standing still (m): a stance this far off is squared up */
const SETTLE = 0.04;
/**
 * how far a foot may be turned off its place in the stance (rad) before it is squared up standing:
 * coming to rest after walking, closely (the old core's 0.45 left a stop's feet splayed); else not
 * for so little
 */
const SQUARE = { stopped: 0.05, standing: 0.45 };
const square = (g: Gait) => (g.walked ? SQUARE.stopped : SQUARE.standing);
/** a foot further than this (× height) from the root must step regardless of rhythm */
const MAX_DEVIATION = 0.42;

/** how far the knees have given before the first step */
const READY = 0.85;

/** A step about to be taken: the foot, how long it swings, how high, and how it strikes. */
export interface Lift {
  s: number;
  duration: number;
  /** the ankle's rise over its straight path (m) */
  lift: number;
  /** the foot's pitch at heel strike (rad, + toes up) */
  strike: number;
}

const _v = new Vector3();
const errs = [0, 0];
const lateral = [0, 0];
const yawErrs = [0, 0];

/** the step to take now (null: none), the solved body's extrapolated centre of mass at `xcom`, `dt` s on */
export function nextStep(g: Gait, xcom: Readonly<Vector3>, dt: number): Lift | null {
  const t = g.timing();
  const { feet } = g;
  if (t.run > 0.5) {
    // running: a step clock, each foot pushing off half a stride after the other did, even while
    // the other is still in the air (a flight phase): the rhythm stays locked to the speed; a foot
    // left behind out of the leg's reach goes at once
    const s = 1 - g.lastLift;
    const f = feet[s];
    if (!f.swinging && ((g.clock - g.lastLiftAt >= t.step && f.plantedTime >= 0.6 * t.stance) || overstretched(g, s))) return lift(g, s, t, xcom, true);
    return null;
  }
  if (feet.some((f) => f.swinging)) return null;
  // a foot left behind out of the leg's reach goes at once
  for (let s = 0; s < 2; s++) if (feet[s].plantedTime > t.doubleSupport && overstretched(g, s)) return lift(g, s, t, xcom, true);
  // (setting off, the knees give before a foot leaves: off a straight leg there is no stepping)
  if (g.starting && g.bent < READY) return null;
  const lead = g.moving ? leadTime(t, t.swing) : 0;
  // capture-point stepping: a body falling past its feet steps now, with the foot that catches it
  // (standing, once it has been falling for a moment: a passing jolt is no fall)
  g.falling = uncaught(g, xcom) > CATCH * g.p.scale ? g.falling + dt : 0;
  const falling = g.falling > (g.moving ? 0 : STILL_FALL);
  const pick = falling ? catching(g, t, lead, xcom) : balanced(g, pickFoot(g, t, lead, xcom), t, lead, xcom);
  return pick < 0 ? null : lift(g, pick, t, xcom, falling);
}

/** where foot `s` lands (into `out`), heading which way, the step landing `ahead` s from now */
export function landing(g: Gait, s: number, lead: number, ahead: number, xcom: Readonly<Vector3>, out: Vector3): { yaw: number; out: number } {
  const yaw = placeFoot(g, s, lead, out);
  return { yaw, out: fitLanding(g, s, out, yaw, ahead, xcom) };
}

/** how far the extrapolated centre of mass would lie outside the base a step with foot `s` leaves */
const uncaughtBy = (g: Gait, s: number, lead: number, ahead: number, xcom: Readonly<Vector3>) => landing(g, s, lead, ahead, xcom, _v).out;

/** the foot whose step catches a body falling past its feet: the rhythm's next one if it can, else the one that helps most */
function catching(g: Gait, t: Timing, lead: number, xcom: Readonly<Vector3>): number {
  const next = 1 - g.lastLanded;
  const byNext = uncaughtBy(g, next, lead, t.swing, xcom);
  if (byNext <= CATCH * g.p.scale) return next;
  const byOther = uncaughtBy(g, 1 - next, lead, t.swing, xcom) + rhythmCost(g, 1 - next, t);
  return byOther < byNext ? 1 - next : next;
}

/** what stepping again with the foot that just landed costs (m of uncaught centre of mass): the feet alternate */
const rhythmCost = (g: Gait, s: number, t: Timing) => (g.feet[s].plantedTime < t.stance ? ALTERNATE * g.p.scale : 0);

/** `pick`, unless its step would let the body fall past its feet and the other's would catch it */
function balanced(g: Gait, pick: number, t: Timing, lead: number, xcom: Readonly<Vector3>): number {
  if (pick < 0) return pick;
  const out = uncaughtBy(g, pick, lead, t.swing, xcom);
  if (out <= CATCH * g.p.scale) return pick;
  const other = uncaughtBy(g, 1 - pick, lead, t.swing, xcom);
  return other <= CATCH * g.p.scale && other + rhythmCost(g, 1 - pick, t) < out ? 1 - pick : pick;
}

/** the foot to step with (−1: none) while walking or standing */
function pickFoot(g: Gait, t: Timing, lead: number, xcom: Readonly<Vector3>): number {
  const { feet, status } = g;
  for (let s = 0; s < 2; s++) {
    const yaw = placeFoot(g, s, lead, _v);
    const dx = _v.x - status[s].position.x;
    const dz = _v.z - status[s].position.z;
    errs[s] = Math.hypot(dx, dz);
    const across = g.yaw + g.stance.blade;
    lateral[s] = Math.abs(dx * Math.cos(across) - dz * Math.sin(across));
    yawErrs[s] = Math.abs(wrapAngle(yaw - status[s].yaw));
  }
  let pick = -1;
  // a foot left far behind (or ahead) must step regardless of rhythm
  for (let s = 0; s < 2; s++) {
    const dev = Math.hypot(status[s].position.x - g.root.x, status[s].position.z - g.root.z);
    if (dev > MAX_DEVIATION * g.p.height && feet[1 - s].plantedTime > 0.05) pick = s;
  }
  if (pick < 0 && (g.moving || g.speed > 0.05)) pick = pickWhileMoving(g, t, lead, xcom);
  else if (pick < 0) {
    const best = offBy(g, 0) >= offBy(g, 1) ? 0 : 1;
    const otherLoaded = feet[1 - best].plantedTime > 0.12;
    if (offBy(g, best) > 1 && otherLoaded) pick = best;
    // finish the pair: bring the other foot alongside after an adjustment
    else if (otherLoaded && (errs[best] > 0.1 || yawErrs[best] > square(g)) && feet[best].plantedTime > 0.35) pick = best;
  }
  if (pick >= 0 && !g.moving && g.speed < 0.05) {
    // an idle adjustment must actually move the foot somewhere
    const { yaw } = landing(g, pick, 0, t.swing, xcom, _v);
    if (Math.hypot(_v.x - status[pick].position.x, _v.z - status[pick].position.z) < SETTLE * g.p.scale && Math.abs(wrapAngle(yaw - status[pick].yaw)) < 0.5 * square(g)) pick = -1;
  }
  return pick;
}

/** alternate by default, but the foot that needs it most (and can make progress) leads: side-steps lead with the foot on that side */
function pickWhileMoving(g: Gait, t: Timing, lead: number, xcom: Readonly<Vector3>): number {
  const { feet } = g;
  let last = g.lastLanded;
  // setting off: the foot on the side of the goal leads (no stepping across)
  if (feet[0].plantedTime > 0.3 && feet[1].plantedTime > 0.3) {
    const gx = g.goal.x - g.root.x;
    const gz = g.goal.z - g.root.z;
    const gl = Math.hypot(gx, gz);
    const across = gx * Math.cos(g.yaw) - gz * Math.sin(g.yaw);
    if (gl > 0.02 && Math.abs(across) > 0.3 * gl) last = across > 0 ? 1 : 0;
  }
  const next = 1 - last;
  const lastLoaded = feet[last].plantedTime >= t.doubleSupport;
  const nextLoaded = feet[next].plantedTime >= t.doubleSupport;
  const progress = (s: number) => {
    landing(g, s, lead, t.swing, xcom, _v);
    return Math.hypot(_v.x - g.status[s].position.x, _v.z - g.status[s].position.z);
  };
  if (g.starting && lastLoaded && nextLoaded && progress(next) >= 0.1) return next;
  const minMove = g.speed < 0.3 ? 0.05 : 0.02;
  if (!lastLoaded || misplaced(next) <= (g.speed < 0.3 ? 0.06 : 0.03)) return -1;
  const lastInstead = nextLoaded && misplaced(last) > 0.03 && progress(last) >= minMove && (progress(next) < minMove || misplaced(last) > 1.5 * misplaced(next) + 0.03);
  if (lastInstead) return last;
  return progress(next) >= minMove ? next : -1;
}

/** how far foot `s` is out of place, in units of what's worth a step: a stance a few cm off is squared up */
const offBy = (g: Gait, s: number) => Math.max(errs[s] / 0.1, lateral[s] / SETTLE, yawErrs[s] / square(g));

/** how far foot `s` is out of place while moving (m, with its heading error) */
const misplaced = (s: number) => errs[s] + 0.25 * yawErrs[s];

const _hip = new Vector3();
const _ankle = new Vector3();

/**
 * planted foot `s` is left behind out of its leg's reach from the hip as the pelvis is carried,
 * even up on its toes (a runner's goes before the leg is straight)
 */
function overstretched(g: Gait, s: number): boolean {
  const f = g.status[s];
  const hip = g.hip(g.feet[s].side, _hip);
  // (a foot just put down ahead is what the body comes over: it is not left behind)
  if ((f.position.x - hip.x) * Math.sin(g.yaw) + (f.position.z - hip.z) * Math.cos(g.yaw) > 0) return false;
  return hip.distanceTo(ankleFor(g.p, g.feet[s].side, f.position, f.yaw, -MAX_HEEL, _ankle)) > lerp(REACH, RUN_REACH, g.run) * g.p.legLength;
}

/** the step foot `s` takes (null: too small to bother, unless it catches the body) */
function lift(g: Gait, s: number, t: Timing, xcom: Readonly<Vector3>, catching: boolean): Lift | null {
  const lead = g.moving ? leadTime(t, t.swing) : 0;
  const { yaw } = landing(g, s, lead, t.swing, xcom, _v);
  const from = g.status[s];
  const length = Math.hypot(_v.x - from.position.x, _v.z - from.position.z);
  const H = g.p.scale;
  // nobody lifts a foot to move it a couple of centimetres
  if (!catching && length < (g.moving ? 0.1 : SETTLE) * H && Math.abs(wrapAngle(yaw - from.yaw)) < (g.moving ? 0.45 : square(g))) return null;
  // short steps are quick; long walking strides follow the cadence
  const duration = t.run > 0.5 ? t.swing : clamp(0.24 + 0.32 * (length / H), g.moving ? 0.28 : 0.32, g.moving ? t.swing : 0.45);
  // the ankle's rise over its path as the knee flexes: ~9 cm walking, ~29 cm running (CMU mocap)
  const rise = (length < 0.06 ? 0.015 : lerp(clamp(0.07 * length, 0.03, 0.09), 0.17, t.run)) * g.p.scale;
  const strike = g.moving ? lerp(0.28 * g.walk + 0.04, 0.12, t.run) : 0.04;
  return { s, duration, lift: rise, strike };
}
