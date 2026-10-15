// When a foot steps and where it lands: from the old core (a801be4:packages/core/src/gait/steps.ts,
// placement.ts; as adapted in 738b439:packages/animate/src/humanoid/gait/trigger.ts, placement.ts):
// Raibert-style placement under where the body will be, Hof's capture rule, the human limits on a step.
import { Vector3 } from 'three';
import { coordinatesOf } from '../../core/limits';
import { INDEX, type Side } from '../bones';
import { clamp, forwardOf, leftOf, lerp, smoothstep, wrapAngle, yawOf } from '../../core/math';
import { bodyYaw, footYaw, stanceFeet } from '../stance';
import type { Carriage } from './carriage';
import { ankleFor, footprint } from './foot';
import type { Frame } from '../../core/body';
import { DORSIFLEXION, liftOff, MAX_HEEL, REACH, shankTilt } from './legs';
import { hullOf, outside, past } from './support';
import { leadTime, type Timing } from './timing';

/** the extrapolated centre of mass is caught by a step once it leaves the feet by this much (m, default body) */
const CATCH = 0.02;
/** below these speeds (m/s, default body) the body balances more and more as it does standing */
const SLOW = [0.1, 0.2] as const;
/** how far a runner's leg reaches back to its planted foot before it goes (× its length) */
const RUN_REACH = 0.93;
/** how far the extrapolated centre of mass may leave the feet before a walking step catches it at once (m, default body) */
// Tuned: catch at 5 cm rather than 6 cm, retaining reserve during loaded reaches.
const FALL = 0.05;
/** how long a standing body must have been falling before it steps (s) */
const STILL_FALL = 0.1;
/** how much better a step with the foot that just landed must catch the body to break the alternation (m, default body) */
const ALTERNATE = 0.08;
/** the shortest step standing still (m): a stance this far off is squared up; closer coming to rest after a walk */
const SETTLE = { stopped: 0.02, standing: 0.04 };
/** how far a foot may be turned off its place (rad) before it is squared up standing: closely coming to rest after a walk, not for so little otherwise */
const SQUARE = { stopped: 0.05, standing: 0.45 };
/** a foot further than this (× height) from the root must step regardless of rhythm */
const MAX_DEVIATION = 0.42;
/** how far the knees have given before the first step */
const READY = 0.85;
/** twist left at the ankle or hip when a turning step starts (rad) */
const TWIST_MARGIN = 0.12;
/** a foot this far behind the body steps next walking (m, default body) */
const BEHIND = 0.2;
/** how far out to its own side of the body a foot lands, at least (m, default body) */
const OWN_SIDE = 0.035;
/** how far inside a step's base the extrapolated centre of mass is caught (m, default body) */
const COVER_MARGIN = 0.03;
/** the turn rates (rad/s) over which a step catching the body moves only across the way, not along it */
const BEND = [0.03, 0.1] as const;
/** the widest the feet land apart walking slowly (× stance span) */
const SLOW_WIDTH = 1.15;
/** Turning feet may straddle different headings; cap their separation in the body's frame too (× stance span). */
const TURN_WIDTH = 1.4;
/** speeds (m/s) over which walking steps may go wider */
const WALKING = [0.6, 0.9] as const;
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
const settle = (c: Carriage) => (c.walked && c.plant ? SETTLE.stopped : SETTLE.standing) * c.p.scale;

/**
 * The feet one sub-step on (`f`), the body's extrapolated centre of mass at `xcom`: each swinging
 * one along, its landing fine-tuned through the first part of its swing (one that moves later
 * reads as a stumble) and put down at its end; then a step taken if one is due. Returns whether one was.
 */
export function stepFeet(f: Frame<unknown>, c: Carriage, xcom: Readonly<Vector3>): boolean {
  c.steps.forEach((st, s) => {
    const w = st.swing;
    if (!w) return;
    const foot = c.feet[s];
    w.progress = Math.min(1, w.progress + f.dt / w.duration);
    if (w.progress >= 1) {
      foot.phase = 'planted';
      st.swing = null;
      st.plantedTime = 0;
      // (as the swing ended: no more toes-up than the ankle flexes under the shank)
      st.landPitch = Math.min(w.strike, DORSIFLEXION - shankTilt(f.prev, st.side, foot.yaw));
      st.roll = [st.landPitch, st.landPitch];
      c.lastLanded = s;
      return;
    }
    const adapt = 1 - smoothstep(ADAPT.until[0], ADAPT.until[1], w.progress);
    if (adapt <= 0) return;
    const left = (1 - w.progress) * w.duration;
    const { yaw } = landing(c, s, c.moving ? leadTime(c.timing(), left) : 0, left, xcom, _to);
    const k = adapt * Math.min(1, f.dt * ADAPT.rate);
    foot.position.lerp(_to, k);
    foot.yaw += wrapAngle(yaw - foot.yaw) * k;
  });
  const lift = nextStep(f, c, xcom);
  if (!lift) return false;
  const st = c.steps[lift.s];
  const foot = c.feet[lift.s];
  const fromYaw = foot.yaw;
  const { yaw } = landing(c, lift.s, c.moving ? leadTime(c.timing(), lift.duration) : 0, lift.duration, xcom, foot.position);
  foot.yaw = yaw;
  foot.phase = 'swing';
  st.swing = liftOff(f, st.side, fromYaw, foot.position, c.hip(st.side, _v), c.velocity, lift);
  c.lastLift = lift.s;
  c.lastLiftAt = c.clock;
  return true;
}

/** how quickly a swinging foot's landing is fine-tuned (1/s), until this share of its swing on (then it stays) */
const ADAPT = { rate: 20, until: [0.4, 0.75] as const };

/** the step to take now (null: none), from the last final pose and the body's extrapolated centre of mass */
function nextStep(f: Frame<unknown>, c: Carriage, xcom: Readonly<Vector3>): Lift | null {
  const dt = f.dt;
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
  const turn = wrapAngle(c.yaw + c.stance.blade - yawOf(f.prev.local(0)));
  const margin = steps.map((st) => st.plantedTime >= t.doubleSupport && Math.abs(turn) > 1e-4 ? twistMargin(f, st.side, turn) : Infinity);
  const turning = margin[0] < margin[1] ? 0 : 1;
  if (margin[turning] < TWIST_MARGIN && (!c.starting || c.bent >= READY)) return lift(c, turning, t, xcom, true);
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
  // Placement follows the goal; forecast one sub-step of XCoM motion relative to that goal.
  const out = uncaught(c, _to.copy(xcom).addScaledVector(c.velocity, dt).addScaledVector(c.goalVelocity, -dt));
  c.falling = out > (1 - 2 * still) * CATCH * c.p.scale ? c.falling + dt : 0;
  // (round a bend the extrapolated centre of mass runs outside the path by (v/ω)²·κ/2 by design: that is no fall)
  const bend = (0.5 * (c.speed / c.omega) ** 2 * Math.abs(c.turnRate)) / Math.max(c.speed, 0.1);
  const loaded = !c.moving || steps[c.lastLanded].plantedTime >= t.doubleSupport || out > FALL * c.p.scale + bend;
  const falling = c.falling > (c.moving ? 0 : STILL_FALL) && loaded;
  const pick = falling ? catching(c, t, lead, xcom) : balanced(c, pickFoot(c, t, lead, xcom), t, lead, xcom);
  return pick < 0 ? null : lift(c, pick, t, xcom, falling);
}

/** Twist left in the direction the body is turning (rad); the foot and knee lag behind it. */
function twistMargin(f: Frame<unknown>, side: Side, turn: number): number {
  let margin = Infinity;
  for (const bone of [INDEX[`${side}UpperLeg`], INDEX[`${side}Foot`]]) {
    const limit = f.prev.skeleton.limits[bone];
    if (!limit) continue;
    const { value, range } = coordinatesOf(f.prev.local(bone), limit);
    margin = Math.min(margin, turn > 0 ? value[2] - range[2][0] : range[2][1] - value[2]);
  }
  return margin;
}

/** where foot `s` lands (into `out`), heading which way, the step landing `ahead` s from now; and how far the body's extrapolated centre of mass is left uncaught */
function landing(c: Carriage, s: number, lead: number, ahead: number, xcom: Readonly<Vector3>, out: Vector3): { yaw: number; out: number } {
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
  // (a foot left behind the body goes: the other stepping again would leave it out of reach)
  if (pick < 0 || behindBy(c, pick) > BEHIND * c.p.scale) return pick;
  const out = uncaughtBy(c, pick, lead, t.swing, xcom);
  if (out <= CATCH * c.p.scale) return pick;
  const other = uncaughtBy(c, 1 - pick, lead, t.swing, xcom);
  return other <= CATCH * c.p.scale && other + rhythmCost(c, 1 - pick, t) < out ? 1 - pick : pick;
}

/** how far each foot [left, right] is from where it should be: its distance and sideways part (m), its heading (rad) */
interface Misplaced {
  distance: [number, number];
  lateral: [number, number];
  yaw: [number, number];
}

/** the foot to step with (−1: none) while walking or standing */
function pickFoot(c: Carriage, t: Timing, lead: number, xcom: Readonly<Vector3>): number {
  const { steps, feet } = c;
  const off: Misplaced = { distance: [0, 0], lateral: [0, 0], yaw: [0, 0] };
  for (let s = 0; s < 2; s++) {
    const yaw = placeFoot(c, s, lead, _v);
    const dx = _v.x - feet[s].position.x;
    const dz = _v.z - feet[s].position.z;
    off.distance[s] = Math.hypot(dx, dz);
    const across = c.yaw + c.stance.blade;
    off.lateral[s] = Math.abs(dx * Math.cos(across) - dz * Math.sin(across));
    off.yaw[s] = Math.abs(wrapAngle(yaw - feet[s].yaw));
  }
  let pick = -1;
  // a foot left far behind (or ahead) must step regardless of rhythm
  for (let s = 0; s < 2; s++) {
    const dev = Math.hypot(feet[s].position.x - c.root.x, feet[s].position.z - c.root.z);
    if (dev > MAX_DEVIATION * c.p.height && steps[1 - s].plantedTime > 0.05) pick = s;
  }
  if (pick < 0 && (c.moving || c.speed > 0.05)) pick = pickWhileMoving(c, t, lead, xcom, off);
  else if (pick < 0 && !c.lowered) {
    const best = offBy(c, off, 0) >= offBy(c, off, 1) ? 0 : 1;
    const otherLoaded = steps[1 - best].plantedTime > 0.12;
    if (offBy(c, off, best) > 1 && otherLoaded) pick = best;
    // finish the pair: bring the other foot alongside after an adjustment
    else if (otherLoaded && (off.distance[best] > 0.1 || off.yaw[best] > square(c)) && steps[best].plantedTime > 0.35) pick = best;
  }
  if (pick >= 0 && !c.moving && c.speed < 0.05) {
    // an idle adjustment must actually move the foot somewhere
    const { yaw } = landing(c, pick, 0, t.swing, xcom, _v);
    if (Math.hypot(_v.x - feet[pick].position.x, _v.z - feet[pick].position.z) < settle(c) && Math.abs(wrapAngle(yaw - feet[pick].yaw)) < 0.5 * square(c)) pick = -1;
  }
  return pick;
}

/** alternate by default, but the foot that needs it most (and can make progress) leads: side-steps lead with the foot on that side */
function pickWhileMoving(c: Carriage, t: Timing, lead: number, xcom: Readonly<Vector3>, off: Misplaced): number {
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
    const { yaw } = landing(c, s, lead, t.swing, xcom, _v);
    const distance = Math.hypot(_v.x - feet[s].position.x, _v.z - feet[s].position.z);
    if (c.starting || c.speed > SLOW[1] * c.p.scale || c.goalSpeed > SLOW[0] * c.p.scale) return distance;
    // A turn in place advances the foot's contacts even when its ankle stays put.
    const turned = 2 * Math.max(c.p.toeFront, c.p.heelBack) * Math.sin(Math.abs(wrapAngle(yaw - feet[s].yaw)) / 2);
    return Math.max(distance, turned);
  };
  if (c.starting && lastLoaded && nextLoaded && progress(next) >= 0.1) return next;
  const minMove = c.speed < 0.3 ? 0.05 : 0.02;
  if (!lastLoaded || misplaced(off, next) <= (c.speed < 0.3 ? 0.06 : 0.03)) return -1;
  // (but a foot left behind the body goes next: the other stepping again would leave it out of reach)
  const lastInstead = nextLoaded && behindBy(c, next) < BEHIND * c.p.scale && misplaced(off, last) > 0.03 && progress(last) >= minMove && (progress(next) < minMove || misplaced(off, last) > 1.5 * misplaced(off, next) + 0.03);
  if (lastInstead) return last;
  return progress(next) >= minMove ? next : -1;
}

/** how far foot `s` is behind the root, as the body faces (m) */
const behindBy = (c: Carriage, s: number) => -((c.feet[s].position.x - c.root.x) * Math.sin(c.yaw) + (c.feet[s].position.z - c.root.z) * Math.cos(c.yaw));

/** how far foot `s` is out of place, in units of what's worth a step: a stance a few cm off is squared up */
const offBy = (c: Carriage, off: Misplaced, s: number) => Math.max(off.distance[s] / 0.1, off.lateral[s] / settle(c), off.yaw[s] / square(c));

/** how far foot `s` is out of place while moving (m, with its heading error) */
const misplaced = (off: Misplaced, s: number) => off.distance[s] + 0.25 * off.yaw[s];

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
  if (!catching && length < (c.moving ? 0.1 * H : settle(c)) && Math.abs(wrapAngle(yaw - from.yaw)) < (c.moving ? 0.45 : square(c))) return null;
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
  // (no further round than a step turns a foot: the curve's turn and the facing asked are not added up past it)
  // Tuned 0.6 rad foot-heading cap: a turn is shared across steps instead of twisting one stance.
  const yaw = c.yaw + clamp(2 * arc + clamp(wrapAngle(c.goalYaw - c.yaw), -1.2, 1.2) * clamp(lead * 2.5, 0, 1), -0.6, 0.6);
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
  limit(c, s, _bare, yaw, ahead);
  const out = uncovered(c, s, _bare, yaw, _then);
  to.copy(_bare);
  if (out <= 0) return 0;
  const margin = COVER_MARGIN * c.p.scale;
  for (let pass = 0; pass < 3; pass++) {
    const d = uncovered(c, s, to, yaw, _then, _away);
    if (d <= 0) break;
    // (round a bend, only across: along the way a step lands where the stride has it, the next one
    // catching what this leaves ahead; otherwise the outer and inner steps would grow apart)
    const bend = c.moving ? smoothstep(BEND[0], BEND[1], Math.abs(c.turnRate)) : 0;
    const along = _away.dot(forwardOf(c.yaw + 2 * travel(c, ahead, _f), _f));
    _away.addScaledVector(_f, -bend * along);
    // (moved along that as far as covers it: its part along the way to the point is 1 − bend · along²)
    const toward = 1 - bend * along * along;
    if (toward < 1e-3) break;
    to.addScaledVector(_away, (d + margin) / toward);
  }
  limit(c, s, to, yaw, ahead);
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
  return spots.length ? past(hullOf(spots), xcom) : Infinity;
}

/** no crossing over, not under the body as it will be on landing (`ahead` s on), no over-long step */
function limit(c: Carriage, s: number, to: Vector3, yaw: number, ahead: number) {
  const other = c.feet[1 - s];
  const sign = c.steps[s].sign;
  // (crossing over is judged across the step: halfway between the two feet's headings)
  const from = bodyYaw(other.yaw, c.steps[1 - s].sign, c.stance);
  const across = from + 0.5 * wrapAngle(bodyYaw(yaw, sign, c.stance) - from);
  const H = c.p.height;
  // (walking slowly, turning or stopping, the feet stay about a stance apart: no wide catching steps)
  const narrowest = 0.05 * H;
  const widest = lerp(SLOW_WIDTH * 2 * c.stance.width, Math.max(narrowest + 0.3 * H, 2.3 * c.stance.width), smoothstep(WALKING[0], WALKING[1], c.speed));
  aside(to, other.position, across, sign, narrowest, widest);
  // (on a bend the body will be further round: its side of where it will be, as it will face)
  const arc = travel(c, ahead, _then2);
  aside(to, _then2.add(c.root), c.yaw + 2 * arc, sign, OWN_SIDE * c.p.scale, Infinity);
  // A turning step must stay narrow across the body too, not only across the feet's mean heading.
  if (c.speed < WALKING[0]) aside(to, other.position, c.yaw, sign, narrowest, TURN_WIDTH * 2 * c.stance.width);
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
const _to = new Vector3();
const _hip = new Vector3();
const _ankle = new Vector3();
const _homes: [Vector3, Vector3] = [new Vector3(), new Vector3()];
const _travel = new Vector3();
const _f = new Vector3();
const _l = new Vector3();
const _then = new Vector3();
const _then2 = new Vector3();
const _bare = new Vector3();
const _away = new Vector3();
