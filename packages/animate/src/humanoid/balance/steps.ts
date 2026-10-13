// When a foot steps and where it lands: from the old core (a801be4:packages/core/src/gait/steps.ts,
// placement.ts; as adapted in 738b439:packages/animate/src/humanoid/gait/trigger.ts, placement.ts):
// Raibert-style placement under where the body will be, Hof's capture rule, the human limits on a step.
import { Vector3 } from 'three';
import { clamp, forwardOf, leftOf, lerp, smoothstep, wrapAngle } from '../math';
import { bodyYaw, footYaw, stanceFeet } from '../stance';
import type { Carriage } from './carriage';
import { ankleFor, footprint } from './foot';
import { MAX_HEEL, REACH } from './legs';
import { beyond, hullOf, outside } from './support';
import { leadTime, type Timing } from './timing';

/** the extrapolated centre of mass is caught by a step once it leaves the feet by this much (m, default body) */
const CATCH = 0.02;
/** below these speeds (m/s, default body) the body balances more and more as it does standing */
const SLOW = [0.1, 0.2] as const;
/** how far a runner's leg reaches back to its planted foot before it goes (× its length) */
const RUN_REACH = 0.93;
/** how far the extrapolated centre of mass may leave the feet before a walking step catches it at once (m, default body) */
const FALL = 0.06;
/** how long a standing body must have been falling before it steps (s) */
const STILL_FALL = 0.1;
/** how much better a step with the foot that just landed must catch the body to break the alternation (m, default body) */
const ALTERNATE = 0.08;
/** the shortest step standing still (m): a stance this far off is squared up */
const SETTLE = 0.04;
/** how far a foot may be turned off its place (rad) before it is squared up standing: closely coming to rest after a walk, not for so little otherwise */
const SQUARE = { stopped: 0.05, standing: 0.45 };
/** a foot further than this (× height) from the root must step regardless of rhythm */
const MAX_DEVIATION = 0.42;
/** how far the knees have given before the first step */
const READY = 0.85;
/** a foot this far behind the body steps next walking (m, default body) */
const BEHIND = 0.2;
/** how far out to its own side of the body a foot lands, at least (m, default body) */
const OWN_SIDE = 0.035;
/** how far to its own side of the other foot a foot lands, at least, as the body faces now (m, default body) */
const UNCROSSED = 0.04;
/** how far inside a step's base the extrapolated centre of mass is caught (m, default body) */
const COVER_MARGIN = 0.03;
/** the speeds (m/s, default body) over which a run turns into a bouncing gait, with flight phases */
const BOUNCING = [2.2, 2.5] as const;

/** A step about to be taken: the foot, how long it swings, how high, how it strikes, and whether from standing. */
export interface Lift {
  s: number;
  duration: number;
  lift: number;
  strike: number;
  standing: boolean;
}

const square = (c: Carriage) => (c.walked && c.plant ? SQUARE.stopped : SQUARE.standing);

/** the step to take now (null: none), the body's extrapolated centre of mass at `xcom`, `dt` s on */
export function nextStep(c: Carriage, xcom: Readonly<Vector3>, dt: number): Lift | null {
  const t = c.timing();
  const { steps } = c;
  if (t.run > 0.5) {
    // running: a step clock, each foot pushing off half a stride after the other did, even while
    // the other is still in the air; a foot left behind out of the leg's reach goes at once
    const s = 1 - c.lastLift;
    const f = steps[s];
    if (!f.swing && ((c.clock - c.lastLiftAt >= t.step && f.plantedTime >= 0.6 * t.stance) || overstretched(c, s, dt))) return lift(c, s, t, xcom, true);
    return null;
  }
  if (steps.some((f) => f.swing)) return null;
  // (walking: standing, a body raised onto its toes is not leaving its feet behind)
  if (c.moving) for (let s = 0; s < 2; s++) if (steps[s].plantedTime > t.doubleSupport && overstretched(c, s, dt)) return lift(c, s, t, xcom, true);
  // (setting off, the knees give before a foot leaves: off a straight leg there is no stepping)
  if (c.starting && c.bent < READY) return null;
  const lead = c.moving ? leadTime(t, t.swing) : 0;
  // capture-point stepping: a body falling past its feet steps now, with the foot that catches it
  // (standing, once it has been falling for a moment: a passing jolt is no fall)
  const still = 1 - smoothstep(SLOW[0], SLOW[1], c.speed / c.p.scale);
  // (walking, the foot that just landed takes the weight for a double support first, the other
  // pushing off, unless the body is falling well past it)
  const out = uncaught(c, xcom);
  c.falling = out > (1 - 2 * still) * CATCH * c.p.scale ? c.falling + dt : 0;
  const loaded = !c.moving || steps[c.lastLanded].plantedTime >= t.doubleSupport || out > FALL * c.p.scale;
  const falling = c.falling > (c.moving ? 0 : STILL_FALL) && loaded;
  const pick = falling ? catching(c, t, lead, xcom) : balanced(c, pickFoot(c, t, lead, xcom), t, lead, xcom);
  return pick < 0 ? null : lift(c, pick, t, xcom, falling);
}

/** where foot `s` lands (into `out`), heading which way, the step landing `ahead` s from now; and how far the body's extrapolated centre of mass is left uncaught */
export function landing(c: Carriage, s: number, lead: number, ahead: number, xcom: Readonly<Vector3>, out: Vector3): { yaw: number; out: number } {
  const yaw = placeFoot(c, s, lead, out);
  return { yaw, out: fitLanding(c, s, out, yaw, ahead, xcom) };
}

const uncaughtBy = (c: Carriage, s: number, lead: number, ahead: number, xcom: Readonly<Vector3>) => landing(c, s, lead, ahead, xcom, _v).out;

/** the foot whose step catches a body falling past its feet: the rhythm's next one if it can, else the one that helps most */
function catching(c: Carriage, t: Timing, lead: number, xcom: Readonly<Vector3>): number {
  const next = 1 - c.lastLanded;
  const byNext = uncaughtBy(c, next, lead, t.swing, xcom);
  if (byNext <= CATCH * c.p.scale) return next;
  const byOther = uncaughtBy(c, 1 - next, lead, t.swing, xcom) + rhythmCost(c, 1 - next, t);
  return byOther < byNext ? 1 - next : next;
}

/** what stepping again with the foot that just landed costs (m of uncaught centre of mass): the feet alternate */
const rhythmCost = (c: Carriage, s: number, t: Timing) => (c.steps[s].plantedTime < t.stance ? ALTERNATE * c.p.scale : 0);

/** `pick`, unless its step would let the body fall past its feet and the other's would catch it */
function balanced(c: Carriage, pick: number, t: Timing, lead: number, xcom: Readonly<Vector3>): number {
  if (pick < 0) return pick;
  const out = uncaughtBy(c, pick, lead, t.swing, xcom);
  if (out <= CATCH * c.p.scale) return pick;
  const other = uncaughtBy(c, 1 - pick, lead, t.swing, xcom);
  return other <= CATCH * c.p.scale && other + rhythmCost(c, 1 - pick, t) < out ? 1 - pick : pick;
}

const errs = [0, 0];
const lateral = [0, 0];
const yawErrs = [0, 0];

/** the foot to step with (−1: none) while walking or standing */
function pickFoot(c: Carriage, t: Timing, lead: number, xcom: Readonly<Vector3>): number {
  const { steps, feet } = c;
  for (let s = 0; s < 2; s++) {
    const yaw = placeFoot(c, s, lead, _v);
    const dx = _v.x - feet[s].position.x;
    const dz = _v.z - feet[s].position.z;
    errs[s] = Math.hypot(dx, dz);
    const across = c.yaw + c.stance.blade;
    lateral[s] = Math.abs(dx * Math.cos(across) - dz * Math.sin(across));
    yawErrs[s] = Math.abs(wrapAngle(yaw - feet[s].yaw));
  }
  let pick = -1;
  // a foot left far behind (or ahead) must step regardless of rhythm
  for (let s = 0; s < 2; s++) {
    const dev = Math.hypot(feet[s].position.x - c.root.x, feet[s].position.z - c.root.z);
    if (dev > MAX_DEVIATION * c.p.height && steps[1 - s].plantedTime > 0.05) pick = s;
  }
  if (pick < 0 && (c.moving || c.speed > 0.05)) pick = pickWhileMoving(c, t, lead, xcom);
  else if (pick < 0 && !c.lowered) {
    const best = offBy(c, 0) >= offBy(c, 1) ? 0 : 1;
    const otherLoaded = steps[1 - best].plantedTime > 0.12;
    if (offBy(c, best) > 1 && otherLoaded) pick = best;
    // finish the pair: bring the other foot alongside after an adjustment
    else if (otherLoaded && (errs[best] > 0.1 || yawErrs[best] > square(c)) && steps[best].plantedTime > 0.35) pick = best;
  }
  if (pick >= 0 && !c.moving && c.speed < 0.05) {
    // an idle adjustment must actually move the foot somewhere
    const { yaw } = landing(c, pick, 0, t.swing, xcom, _v);
    if (Math.hypot(_v.x - feet[pick].position.x, _v.z - feet[pick].position.z) < SETTLE * c.p.scale && Math.abs(wrapAngle(yaw - feet[pick].yaw)) < 0.5 * square(c)) pick = -1;
  }
  return pick;
}

/** alternate by default, but the foot that needs it most (and can make progress) leads: side-steps lead with the foot on that side */
function pickWhileMoving(c: Carriage, t: Timing, lead: number, xcom: Readonly<Vector3>): number {
  const { steps, feet } = c;
  let last = c.lastLanded;
  // setting off: the foot on the side of the goal leads (no stepping across)
  if (steps[0].plantedTime > 0.3 && steps[1].plantedTime > 0.3) {
    const gx = c.goal.x - c.root.x;
    const gz = c.goal.z - c.root.z;
    const gl = Math.hypot(gx, gz);
    const across = gx * Math.cos(c.yaw) - gz * Math.sin(c.yaw);
    if (gl > 0.02 && Math.abs(across) > 0.3 * gl) last = across > 0 ? 1 : 0;
  }
  const next = 1 - last;
  const lastLoaded = steps[last].plantedTime >= t.doubleSupport;
  const nextLoaded = steps[next].plantedTime >= t.doubleSupport;
  const progress = (s: number) => {
    landing(c, s, lead, t.swing, xcom, _v);
    return Math.hypot(_v.x - feet[s].position.x, _v.z - feet[s].position.z);
  };
  if (c.starting && lastLoaded && nextLoaded && progress(next) >= 0.1) return next;
  const minMove = c.speed < 0.3 ? 0.05 : 0.02;
  if (!lastLoaded || misplaced(next) <= (c.speed < 0.3 ? 0.06 : 0.03)) return -1;
  // (but a foot left behind the body goes next: the other stepping again would leave it out of reach)
  const behind = -((feet[next].position.x - c.root.x) * Math.sin(c.yaw) + (feet[next].position.z - c.root.z) * Math.cos(c.yaw));
  const lastInstead = nextLoaded && behind < BEHIND * c.p.scale && misplaced(last) > 0.03 && progress(last) >= minMove && (progress(next) < minMove || misplaced(last) > 1.5 * misplaced(next) + 0.03);
  if (lastInstead) return last;
  return progress(next) >= minMove ? next : -1;
}

/** how far foot `s` is out of place, in units of what's worth a step: a stance a few cm off is squared up */
const offBy = (c: Carriage, s: number) => Math.max(errs[s] / 0.1, lateral[s] / SETTLE, yawErrs[s] / square(c));

/** how far foot `s` is out of place while moving (m, with its heading error) */
const misplaced = (s: number) => errs[s] + 0.25 * yawErrs[s];

/** planted foot `s` will be left behind out of its leg's reach as the pelvis is carried, even up on its toes, by the time it could lift */
function overstretched(c: Carriage, s: number, dt: number): boolean {
  const f = c.feet[s];
  const hip = c.hip(c.steps[s].side, _hip).addScaledVector(c.velocity, dt);
  // (a foot just put down ahead is what the body comes over: it is not left behind)
  if ((f.position.x - hip.x) * Math.sin(c.yaw) + (f.position.z - hip.z) * Math.cos(c.yaw) > 0) return false;
  return hip.distanceTo(ankleFor(c.p, c.steps[s].side, f.position, f.yaw, -MAX_HEEL, _ankle)) > lerp(REACH, RUN_REACH, c.run) * c.p.legLength;
}

/** the step foot `s` takes (null: too small to bother, unless it catches the body) */
function lift(c: Carriage, s: number, t: Timing, xcom: Readonly<Vector3>, catching: boolean): Lift | null {
  const lead = c.moving ? leadTime(t, t.swing) : 0;
  const { yaw } = landing(c, s, lead, t.swing, xcom, _v);
  const from = c.feet[s];
  const length = Math.hypot(_v.x - from.position.x, _v.z - from.position.z);
  const H = c.p.scale;
  // nobody lifts a foot to move it a couple of centimetres
  if (!catching && length < (c.moving ? 0.1 : SETTLE) * H && Math.abs(wrapAngle(yaw - from.yaw)) < (c.moving ? 0.45 : square(c))) return null;
  // short steps are quick; long walking strides follow the cadence
  const duration = t.run > 0.5 ? t.swing : clamp(0.24 + 0.32 * (length / H), c.moving ? 0.28 : 0.32, c.moving ? t.swing : 0.45);
  // the ankle's rise over its path as the knee flexes: ~9 cm walking, ~29 cm running (CMU mocap)
  const rise = (length < 0.06 ? 0.015 : lerp(clamp(0.07 * length, 0.03, 0.09), 0.17, t.run)) * H;
  const strike = c.moving ? lerp(0.28 * c.walk + 0.04, 0.12, t.run) : 0.04;
  return { s, duration, lift: rise, strike, standing: !c.moving && c.speed < 0.05 };
}

/**
 * Where foot `s` should land, flat, predicted `lead` s ahead: under where the body will be, its
 * place in the stance there, out past the extrapolated centre of mass on the side the body
 * drifts to (Hof). Writes the ankle to `out`, returns the foot's heading.
 */
function placeFoot(c: Carriage, s: number, lead: number, out: Vector3): number {
  const { root, velocity: v, stance, p } = c;
  const arc = travel(c, lead, _travel);
  let px = _travel.x;
  let pz = _travel.z;
  const gx = c.goal.x - root.x;
  const gz = c.goal.z - root.z;
  const gl = Math.hypot(gx, gz);
  if (c.starting && gl > 1e-6 && (gx * Math.sin(c.yaw) + gz * Math.cos(c.yaw)) / gl > 0.7) {
    // setting off roughly forward: a moving goal gets a proper first step, a small reposition what it needs
    const first = 0.32 * p.scale;
    const k = (c.goalSpeed > 0.04 || gl > 0.3 ? first : Math.min(gl, first)) / gl;
    px = gx * k;
    pz = gz * k;
  }
  // side-steps aim at where the body has to go, as far as this step gets there
  if (lead > 0) {
    const lx = Math.cos(c.yaw);
    const lz = -Math.sin(c.yaw);
    const ahead = Math.abs(gx * lz - gz * lx);
    const reach = Math.abs(px * lz - pz * lx);
    const need = (gx * lx + gz * lz) * (ahead > reach ? reach / ahead : 1);
    const have = px * lx + pz * lz;
    const want = clamp(need * 0.9, -0.45, 0.45);
    if (Math.abs(want) > Math.abs(have) && Math.sign(want) === Math.sign(need)) {
      px += (want - have) * lx;
      pz += (want - have) * lz;
    }
  }
  // (the facing turns with a curving path: by 2·arc then)
  const yaw = c.yaw + 2 * arc + clamp(wrapAngle(c.goalYaw - c.yaw), -1.2, 1.2) * clamp(lead * 2.5, 0, 1);
  const narrow = smoothstep(0.1, 0.6, c.speed) * (stance.stagger === 0 ? 1 : 0.3);
  const width = lerp(stance.width, Math.min(stance.width, 0.036 * p.height), narrow);
  stanceFeet(root.x + px, root.z + pz, forwardOf(yaw, _f), leftOf(yaw, _l), p, stance, _homes, width);
  out.copy(_homes[s]);
  // (Hof) the foot on the side the body drifts to lands beyond its extrapolated centre of mass
  if (lead > 0) {
    const lx = Math.cos(yaw);
    const lz = -Math.sin(yaw);
    const c2 = Math.cos(2 * arc);
    const s2 = Math.sin(2 * arc);
    const drift = (v.x * c2 + v.z * s2) * lx + (v.z * c2 - v.x * s2) * lz;
    if (drift * c.steps[s].sign > 0) out.addScaledVector(_l.set(lx, 0, lz), (drift * 1.5) / c.omega);
  }
  return footYaw(yaw, c.steps[s].sign, stance);
}

/** how far the root travels in `time` s, into `out`: the chord of an arc turning at the travel's turn rate, no further than the goal gets; returns the arc's half angle */
function travel(c: Carriage, time: number, out: Vector3): number {
  const v = c.velocity;
  const arc = clamp(0.5 * c.turnRate * time, -0.6, 0.6);
  const chord = Math.abs(arc) > 1e-6 ? Math.sin(arc) / arc : 1;
  const cos = Math.cos(arc) * chord * time;
  const sin = Math.sin(arc) * chord * time;
  out.set(v.x * cos + v.z * sin, 0, v.z * cos - v.x * sin);
  const toGoal = Math.hypot(c.goal.x - c.root.x, c.goal.z - c.root.z) + c.goalTravel(time);
  const l = Math.hypot(out.x, out.z);
  if (l > toGoal && l > 1e-6) out.multiplyScalar(toGoal / l);
  return arc;
}

/**
 * Fits a landing `to` (heading `yaw`) of foot `s` to the body: with the other foot it covers the
 * extrapolated centre of mass as it will be on landing, `ahead` s from now (`xcom` now), and it is
 * humanly possible: no crossing over, not under the body, no over-long step. Returns how far that
 * point still lies outside the base (m).
 */
function fitLanding(c: Carriage, s: number, to: Vector3, yaw: number, ahead: number, xcom: Readonly<Vector3>): number {
  predictXcom(c, ahead, xcom, _then);
  _bare.copy(to);
  limit(c, s, _bare, yaw);
  const out = uncovered(c, s, _bare, yaw, _then);
  to.copy(_bare);
  if (out <= 0) return 0;
  const margin = COVER_MARGIN * c.p.scale;
  for (let pass = 0; pass < 3; pass++) {
    const d = uncovered(c, s, to, yaw, _then, _away);
    if (d <= 0) break;
    to.addScaledVector(_away, d + margin);
  }
  limit(c, s, to, yaw);
  const left = uncovered(c, s, to, yaw, _then);
  if (left < out) return left;
  to.copy(_bare);
  return out;
}

/**
 * The extrapolated centre of mass `ahead` s from now (`xcom` now), into `out`: carried along with
 * the root, along a curve swung in as the velocity turns. Running with flight phases is a bouncing
 * gait: only its sideways part is for a landing to catch.
 */
function predictXcom(c: Carriage, ahead: number, xcom: Readonly<Vector3>, out: Vector3): Vector3 {
  const v = c.velocity;
  const turn = 2 * travel(c, ahead, _travel);
  const cs = Math.cos(turn) - 1;
  const sn = Math.sin(turn);
  out.set(v.x * cs + v.z * sn, 0, v.z * cs - v.x * sn).divideScalar(c.omega);
  const run = smoothstep(BOUNCING[0], BOUNCING[1], c.speed / c.p.scale);
  if (run > 0) {
    const fx = Math.sin(c.yaw);
    const fz = Math.cos(c.yaw);
    const along = ((v.x * fx + v.z * fz) / c.omega) * run;
    out.x -= fx * along;
    out.z -= fz * along;
  }
  out.add(_travel).add(xcom).setY(0);
  // (the goal slowing to a stop, the body stops there too: its extrapolated centre of mass goes no further)
  const speed = Math.hypot(v.x, v.z);
  if (c.goalAccel >= 0 || speed < 1e-3) return out;
  const stop = c.goalSpeed / (-2 * c.goalAccel);
  const gx = c.goal.x + c.goalVelocity.x * stop;
  const gz = c.goal.z + c.goalVelocity.z * stop;
  const past = ((out.x - gx) * v.x + (out.z - gz) * v.z) / speed;
  if (past > 0) out.addScaledVector(v, -past / speed);
  return out;
}

/** how far `point` lies outside the base of the other foot (planted) and a landing at `to` */
function uncovered(c: Carriage, s: number, to: Vector3, yaw: number, point: Vector3, away?: Vector3): number {
  const other = c.feet[1 - s];
  if (other.phase !== 'planted') return 0;
  return outside(hullOf([...footprint(c.p, other.position, other.yaw), ...footprint(c.p, to, yaw)]), point, away);
}

/** how far the extrapolated centre of mass (`xcom`) lies beyond the edge of the planted feet (negative inside; Infinity with none) */
function uncaught(c: Carriage, xcom: Readonly<Vector3>): number {
  const spots = c.feet.flatMap((f) => (f.phase === 'planted' ? footprint(c.p, f.position, f.yaw) : []));
  return spots.length ? beyond(hullOf(spots), xcom) : Infinity;
}

/** no crossing over, not under the body, no over-long step */
function limit(c: Carriage, s: number, to: Vector3, yaw: number) {
  const other = c.feet[1 - s];
  const sign = c.steps[s].sign;
  // (crossing over is judged across the step: halfway between the two feet's headings)
  const from = bodyYaw(other.yaw, c.steps[1 - s].sign, c.stance);
  const across = from + 0.5 * wrapAngle(bodyYaw(yaw, sign, c.stance) - from);
  const H = c.p.height;
  aside(to, other.position, across, sign, 0.05 * H, Math.max(0.05 * H + 0.3 * H, 2.3 * c.stance.width));
  aside(to, other.position, c.yaw, sign, UNCROSSED * c.p.scale, Infinity);
  aside(to, c.root, c.yaw, sign, OWN_SIDE * c.p.scale, Infinity);
  // step length grows with speed; the first steps from standing are short
  const span = Math.hypot(2 * c.stance.width, c.stance.stagger);
  const pace = Math.max(c.speed, c.goalSpeed * 0.5);
  const most = Math.max(1.15 * span, Math.min(lerp(0.55, 1.05, c.run) * H, (0.32 + 0.55 * pace) * c.p.scale));
  const dx = to.x - other.position.x;
  const dz = to.z - other.position.z;
  const dl = Math.hypot(dx, dz);
  if (dl > most) {
    to.x = other.position.x + (dx * most) / dl;
    to.z = other.position.z + (dz * most) / dl;
  }
}

/** keeps `to` between `min` and `max` out to side `sign` of `from`, across a body facing `yaw` */
function aside(to: Vector3, from: Readonly<Vector3>, yaw: number, sign: number, min: number, max: number) {
  const lx = Math.cos(yaw);
  const lz = -Math.sin(yaw);
  const lateral = ((to.x - from.x) * lx + (to.z - from.z) * lz) * sign;
  const want = clamp(lateral, min, max);
  if (want === lateral) return;
  to.x += lx * sign * (want - lateral);
  to.z += lz * sign * (want - lateral);
}

const _v = new Vector3();
const _hip = new Vector3();
const _ankle = new Vector3();
const _homes: [Vector3, Vector3] = [new Vector3(), new Vector3()];
const _travel = new Vector3();
const _f = new Vector3();
const _l = new Vector3();
const _then = new Vector3();
const _bare = new Vector3();
const _away = new Vector3();
