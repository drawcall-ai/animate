// When a foot steps: what prompts it, the gait's clock and which foot goes first.
import { clamp, forwardOf, leftOf, lerp, smoothstep, wrapAngle } from '../../kernel/math';
import { hullOf, outside } from '../support';
import { offsetAt, strideAt } from '../../species/gait';
import { SETTLING, SHUFFLING, STANDING, STEP, TOGETHER, _b, _centre, _f, _v, mod, remaining, strayed, type Leg, type Now, type Steps, type Timing } from './state';
import { aheadOf, hipOf, nominal, offHome, reach, xcomAhead } from './reach';
import { landing, liftLeg } from './swing';

/** What prompts a foot to step steps sub-step: a fall to catch, how far it is turned off the facing. */
export function cue(steps: Steps, now: Now): Cues {
  const { st } = steps, { r, v, spin, Tsw, yaw } = now;
  const catcher = catcherOf(steps, now);
  // (still and no longer turned, the feet square up closer to the facing)
  const turning = lerp(STEP.squared, STEP.turn, smoothstep(0, 0.3, v + Math.abs(spin)));
  const turn = st.twist === undefined ? turning : Math.min(turning, st.twist / 2);
  // (a walker's foot turned toward the facing foreseen a swing on is where the body is turning, not off it: stepping it again would
  // leave the one turned behind waiting: that one steps first)
  const turningTo = r.forecast && !steps.clocked ? r.forecast(Tsw).yaw : yaw;
  return { catcher, turn, turningTo };
}

/**
 * Balance first: the extrapolated centre of mass — the stance's middle carried on at its speed for √(l/g), Hof — past the feet standing
 * and landing by `capture`, the foot furthest from it steps at once, to under it. Of the feet that may, the one that catches it without
 * crossing the other, else the one furthest from it; only one the others can stand for through its swing: a leading foot stepped on
 * again, the trailing one would be left a stance's most travel behind its hip.
 */
function catcherOf(steps: Steps, now: Now): Leg | undefined {
  const { st, feet, legs } = steps, s = st.scale, { r, airborne, v, Tsw, most, dt } = now;
  const capture = st.capture;
  if (airborne || capture === undefined) return undefined;
  const centre = r.xcom ? _centre.copy(r.xcom).setY(0) : xcomAhead(steps, now, 0, _centre);
  const falling = outside(hullOf(legs.flatMap((leg) => feet.print(leg.i, leg.anchor, leg.yaw))), centre) > capture * s;
  if (!falling) return undefined;
  const crossing = (leg: Leg) => Number(landing(steps, now, leg, Tsw - dt)[2] > BLOCKED * s);
  const covered = (leg: Leg) => legs.every((other) => other === leg || other.swing || aheadOf(steps, now, other) + v * Tsw <= most);
  const further = (a: Leg, b: Leg) => b.anchor.distanceToSquared(centre) - a.anchor.distanceToSquared(centre);
  return legs.filter((leg) => !leg.swing && covered(leg)).sort((a, b) => crossing(a) - crossing(b) || further(a, b))[0];
}

/**
 * A gait's clock kept: its footfalls shifting toward the gait's at the pace it keeps — a walk's, a trot's, a gallop's — no faster than
 * `SHIFT` of a cycle a cycle; each foot lifting its own stance after it lands (a leg whose gait has it stand shorter lifts sooner — a
 * horse's hinds at a walk); the clock running while the feet step or would: walking, turning, squaring up.
 */
export function keepTime(steps: Steps, now: Now, cues: Cues) {
  const gait = steps.st.gait;
  if (!gait) return;
  const { legs } = steps, { pacing, dt, C, duty, Ts, Tsw, lead, moving, pressed } = now;
  steps.footfalls = legs.map((leg) => {
    const at = steps.footfalls[leg.i], to = offsetAt(gait, pacing, leg.i), off = to - at - Math.round(to - at);
    return mod(at + clamp(off, -SHIFT * dt / C, SHIFT * dt / C));
  });
  steps.lifts = legs.map((leg) => steps.footfalls[leg.i] + (strideAt(gait, pacing, leg.i).duty - duty) * Ts / (duty * C));
  // (how many of the other feet the gait has down as each lifts: each in the air for its swing's share after its own turn comes round)
  const down = (leg: Leg) => legs.filter((other) => other !== leg && mod(steps.lifts[leg.i] - steps.lifts[other.i]) >= Tsw / C - 1e-9);
  steps.scheduled = legs.map((leg) => down(leg).length);
  // (setting off from standing, the gait's cycle starts with the foot furthest behind where it would land: it steps first; a root its
  // legs hold back is setting off too — its feet step in their turn to make way for it, else it waits on feet that wait on it)
  const underway = moving > 0 || pressed !== 0 || now.r.turning !== undefined;
  if (underway && !steps.going && legs.every((leg) => !leg.swing)) [steps.clock, steps.since] = [steps.lifts[firstStep(steps, now, lead).i], 0];
  steps.going = underway || legs.some((leg) => leg.swing);
  if (!underway && !legs.some((leg) => leg.swing || wants(steps, now, cues, leg))) return;
  // (a foot whose turn passes while it is held down still owes its step: it takes it as soon as it may, not a cycle on)
  const was = legs.map((leg) => inTurn(steps, leg));
  steps.clock = (steps.clock + dt / C) % 1;
  steps.since += dt / C;
  for (const leg of legs) {
    const passed = was[leg.i] && mod(steps.clock - steps.lifts[leg.i]) >= SLOT;
    if (!leg.swing && passed && stood(steps, now, leg) && moving > 0) steps.owed[leg.i] = true;
  }
}

/** whether a foot's turn in a gait has come round since it set off, within `SLOT` of a cycle */
export function inTurn(steps: Steps, leg: Leg): boolean {
  const into = mod(steps.clock - steps.lifts[leg.i]);
  return into < SLOT && into <= steps.since + 1e-9;
}

/** The feet that are due lifted, the furthest from home first. */
export function liftFeet(steps: Steps, now: Now, cues: Cues) {
  for (const leg of furthestOf(steps, now, now.lead)) {
    const other = steps.legs[steps.pair[leg.i]];
    if (ready(steps, now, cues, leg, other)) liftLeg(steps, now, leg, leg === cues.catcher);
  }
}

/** whether `leg` lifts now, `other` the leg across from it */
function ready(steps: Steps, now: Now, cues: Cues, leg: Leg, other: Leg): boolean {
  const { legs } = steps, { r, dt, airborne, C, Ts } = now;
  const urgent = isUrgent(steps, now, cues, leg, other);
  if (airborne && !urgent) return false;
  // (a gait's body never leaves fewer than `STANDING` feet on the floor — nor than its gait has down as steps one lifts: a trot quicker
  // than half its cycle in stance has a moment in the air — one out of reach waits, the others land first)
  // (one of a pair lifting in steps sub-step still counts as down: the pair leaves the floor together)
  const down = legs.filter((o) => o !== leg && (!o.swing || (o.swing.age <= dt && together(steps, leg, o)))).length;
  if (steps.clocked && !airborne && down < Math.min(STANDING, steps.scheduled[leg.i])) return false;
  // (nor, walking, while one its gait never has in the air with it is — their turns a swing or more apart — out of reach or not: it waits
  // for it to land, as the planner foresees)
  if (steps.clocked && !airborne && isWalking(steps) && legs.some((o) => o.swing && exclusive(steps, leg, o, now))) return false;
  // (nor lifts a foot it has only just put down: a step lands and bears weight before the next)
  if (steps.clocked && !leg.swing && leg.planted < SETTLING * C) return false;
  // With a planned root, touchdown bears weight before another swing; the planner can hold the root back.
  if (leg.swing || (!airborne && r.forecast && leg.landed)) return false;
  // (nor just after one its gait sets apart from it, out of reach or not: the feet leave the floor one by one, `TOGETHER` apart)
  if (steps.clocked && !airborne && legs.some((o) => o !== leg && o.lifted < TOGETHER * C && !together(steps, leg, o))) return false;
  if (urgent) return true;
  if (leg.landed || !wants(steps, now, cues, leg)) return false;
  // alternate: lift once the other foot has stood (walking) or before it lands (running, a flight)
  const otherLands = other.swing ? remaining(other.swing) : -other.planted;
  const alternates = steps.clocked || otherLands + Ts - C * steps.apart[leg.i] <= 1e-9;
  return alternates && !yields(steps, now, cues, leg, other);
}

/** whether a foot steps at once, the other in the air or not: about to be out of reach, under the body, catching a fall */
function isUrgent(steps: Steps, now: Now, cues: Cues, leg: Leg, other: Leg): boolean {
  const { st, feet } = steps, s = st.scale, { r, airborne, air, vy, yaw, most } = now;
  // (leaping, the feet leave the floor as the body does: the legs pushed off during the launch)
  if (airborne) return !leg.swing && air > 0;
  // (a planned walk keeps its supporting foot down even when short of reach: the pelvis gives, not both feet at once)
  if (other.swing && r.forecast && !steps.clocked) return false;
  if (reach(steps, now, leg) < nominal(steps, now) + Math.max(0, vy) * RISING - STEP.short * s) return true;
  if (leg.landed) return false;
  if (leg === cues.catcher) return true;
  return strayed(st, feet, leg, _v.subVectors(hipOf(steps, now, leg), leg.anchor).dot(leftOf(yaw)) * leg.sign) || aheadOf(steps, now, leg) > most;
}

/** whether a foot that would step lets `other`, standing, step first: the two ways of stepping part here */
function yields(steps: Steps, now: Now, cues: Cues, leg: Leg, other: Leg): boolean {
  if (other.swing) return false;
  return now.r.forecast ? walkerYields(steps, now, cues, leg, other) : followerYields(steps, now, leg, other);
}

/**
 * A walker's foot — a foreseen root's — lets the other step first: side-stepping, the foot on the side it goes opens, the other closing
 * after it (first it does not step away from its way); slow, the foot that stepped last lets the other turn first if it is turned off
 * (the feet alternate, turning on the spot); one that will be nearer its home than the other a swing on (a gait's feet keep its order
 * instead). One that would have to cross the other closes beside it instead: left waiting, it would trail out of reach.
 */
function walkerYields(steps: Steps, now: Now, cues: Cues, leg: Leg, other: Leg): boolean {
  const { v, across } = now;
  if (v > 0 && across * leg.sign < -SIDE && leg.lifted <= other.lifted) return true;
  if (v < SHUFFLING && leg.lifted < other.lifted && !other.landed && turnedOff(steps, now, cues, other)) return true;
  return !steps.clocked && behind(steps, now, other, leg) && !turnedOff(steps, now, cues, leg);
}

/** A followed foot — an unforeseen root's — lets the other step first if it would have to cross it, or will be nearer its home than the
 * other a swing on (a gait's feet keep its order: none waits on the one across its girdle). */
function followerYields(steps: Steps, now: Now, leg: Leg, other: Leg): boolean {
  if (steps.clocked) return false;
  return landing(steps, now, leg, now.Tsw - now.dt)[2] > BLOCKED * steps.st.scale || behind(steps, now, other, leg);
}

/** whether `other` will be further from its home than `leg` a swing on, by more than a step */
function behind(steps: Steps, now: Now, other: Leg, leg: Leg): boolean {
  const then = now.lead + now.Tsw;
  return offHome(steps, now, other, then) > offHome(steps, now, leg, then) + STEP.distance * steps.st.scale;
}

/**
 * whether a foot wants to step: off its home, turned off it, or overdue (still, only to even out a stance staggered fore and aft: a
 * squat needs them side by side); a gait's only in its turn, having stood a while, out of turn only fallen `BEHIND` of a stance's travel
 * further behind than its stance takes it from where it lands
 */
export function wants(steps: Steps, now: Now, cues: Cues, leg: Leg): boolean {
  const s = steps.st.scale, { r, v, spin, held, lead, most, Ts, crouch: k } = now;
  if (r.still && !staggered(steps, now, leg)) return false;
  if (steps.clocked && !stood(steps, now, leg)) return false;
  const off = offHome(steps, now, leg, lead);
  if (steps.clocked) {
    const far = off > (v > 0 || spin !== 0 ? STEP.distance : STEP.still) * s;
    return (due(steps, now, leg) && (held || far || turnedOff(steps, now, cues, leg))) || off > (1 + BEHIND) * most;
  }
  const far = off > (v > 0 || spin !== 0 || k > 0 ? STEP.distance : STEP.still) * s;
  return (far && due(steps, now, leg)) || off > Math.max(STEP.distance * s, DUE * v * Ts) || turnedOff(steps, now, cues, leg);
}

/**
 * whether a foot is due: moving, its share of a cycle after the leg before it lifted (the steps stay even); standing, after a moment; a
 * gait's by its clock, walking or turning: within `SLOT` of a cycle after its offset comes round
 */
function due(steps: Steps, now: Now, leg: Leg): boolean {
  const { C, Ts, moving } = now;
  if (steps.clocked) return inTurn(steps, leg) || steps.owed[leg.i] || (leg.planted >= C * DUE && steps.since >= DUE);
  if (moving > 0) return steps.legs[steps.before[leg.i]].lifted >= C * steps.gap[leg.i] || leg.planted >= Ts * DUE;
  return leg.planted >= STEP.square;
}

/** whether a gait's feet each leave the floor in a turn of their own (a walk's), none with another (a trot's diagonals) */
export function isWalking(steps: Steps): boolean {
  return steps.legs.every((a) => steps.legs.every((b) => a === b || !together(steps, a, b)));
}

/** whether a gait never has two feet in the air together: their turns a swing or more apart either way round */
export function exclusive(steps: Steps, a: Leg, b: Leg, now: Timing): boolean {
  const d = mod(steps.lifts[a.i] - steps.lifts[b.i]);
  return Math.min(d, 1 - d) >= now.Tsw / now.C - 1e-9;
}

/** whether a gait has two feet leave the floor together: their footfalls within `TOGETHER` of a cycle */
export function together(steps: Steps, a: Leg, b: Leg): boolean {
  const apart = steps.footfalls[a.i] - steps.footfalls[b.i];
  return Math.abs(apart - Math.round(apart)) < TOGETHER;
}

/** whether a foot has stood `SLOT` of a cycle, or half the gait's stance if that is shorter (a gallop's) */
function stood(steps: Steps, now: Now, leg: Leg): boolean {
  return leg.planted >= Math.min(SLOT, now.duty / 2) * now.C;
}

/** whether a foot stands staggered fore and aft of the one across from it */
function staggered(steps: Steps, now: Now, leg: Leg): boolean {
  const other = steps.legs[steps.pair[leg.i]];
  return Math.abs(_b.subVectors(other.anchor, leg.anchor).dot(forwardOf(now.yaw, _f))) > STAGGERED * steps.st.scale;
}

/** whether a foot is turned off the facing, and off where the body turns to */
function turnedOff(steps: Steps, now: Now, cues: Cues, leg: Leg): boolean {
  const off = (facing: number) => Math.abs(wrapAngle(leg.yaw - facing - leg.sign * steps.st.toeOut)) > cues.turn;
  return off(now.yaw) && off(cues.turningTo);
}

/** Start the gait with the furthest foot; effectively tied feet take the longest-rested one's turn. */
function firstStep(steps: Steps, now: Now, ahead: number): Leg {
  const distances = steps.legs.map((leg) => offHome(steps, now, leg, ahead));
  const furthest = Math.max(...distances);
  // A symmetric turn must not choose its diagonal pair from roundoff in the foot distances.
  const tied = steps.legs.filter((leg) => furthest - distances[leg.i] <= 1e-6 * steps.st.scale);
  return tied.reduce((first, leg) => leg.lifted > first.lifted ||
    (leg.lifted === first.lifted && steps.lifts[leg.i] < steps.lifts[first.i]) ? leg : first);
}

/** the legs, the foot furthest from its home `ahead` s on first */
function furthestOf(steps: Steps, now: Now, ahead: number): Leg[] {
  const distances = steps.legs.map((leg) => offHome(steps, now, leg, ahead));
  return [...steps.legs].sort((a, b) => distances[b.i] - distances[a.i]);
}

/** What prompts a foot to step this sub-step: the one that catches a fall, how far a foot may be turned off the facing (rad) and where
 * the body turns to (rad). */
interface Cues { catcher: Leg | undefined; turn: number; turningTo: number }

/** how soon after its offset comes round a gait's foot lifts, and how long it stands first (shares of a cycle) */
const SLOT = 0.25;
/** how much further behind than its stance takes it a gait's foot falls before it steps out of turn (share of a stance's travel) */
const BEHIND = 0.5;
/** Tuned: moving, a foot lifts whatever the others do once it has stood `DUE` stances or is `DUE` stances' travel off its home */
const DUE = 1.5;
/** Tuned: a step that would end `BLOCKED` (m) across the other foot waits for the other to step first (a walker's — a foreseen root's —
 * instead closes beside it) */
const BLOCKED = 0.05;
/** Tuned: a walker opens a side-step with the foot on the side it goes, moving more than `SIDE` of its speed sideways */
const SIDE = 0.5;
/** Tuned: still, the feet step only to even out feet `STAGGERED` (m) apart fore and aft */
const STAGGERED = 0.08;
/** Tuned: a gait's footfalls shift toward another gait's at most this share of a cycle a cycle: a change of gait over a stride or two */
const SHIFT = 0.5;
/** Tuned: a root rising (getting up from a landing) asks `RISING` s sooner for a foot out of reach: it steps before its leg goes straight */
const RISING = 0.5;
