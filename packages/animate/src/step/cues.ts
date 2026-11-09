// When a foot steps: what prompts it, the gait's clock and which foot goes first.
import { MathUtils } from 'three';
import { clamp, forwardOf, leftOf, lerp, wrapAngle } from '../kernel/math';
import { bears, hullOf, outside } from './support';
import { offsetAt, strideAt } from '../species/gait';
import { runs, SETTLING, SHUFFLING, STANDING, THRESHOLDS, TOGETHER, _b, _centre, _f, _v, mod, remaining, strayed, type Leg, type StepInput, type Steps, type Timing } from './steps';
import { aheadOf, hipOf, nominal, offHome, legReach, xcomAhead } from './leg-reach';
import { landing, liftLeg } from './swing';
import { RISE } from './swing-path';

/** What prompts a foot to step steps sub-step: a fall to catch, how far it is turned off the facing. */
export function cue(steps: Steps, input: StepInput): Cues {
  const { st } = steps, { r, v, spin, Tsw, yaw } = input;
  const catcher = catcherOf(steps, input);
  // (still and no longer turned, the feet square up closer to the facing)
  const turning = lerp(THRESHOLDS.squared, THRESHOLDS.turn, MathUtils.smoothstep(v + Math.abs(spin), 0, 0.3));
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
function catcherOf(steps: Steps, input: StepInput): Leg | undefined {
  const { st, feet, legs } = steps, s = st.scale, { r, airborne, v, Tsw, most, dt } = input;
  const capture = st.capture;
  if (airborne || capture === undefined) return undefined;
  const centre = r.xcom ? _centre.copy(r.xcom).setY(0) : xcomAhead(steps, input, 0, _centre);
  const falling = outside(hullOf(legs.flatMap((leg) => feet.print(leg.i, leg.anchor, leg.yaw))), centre) > capture * s;
  if (!falling) return undefined;
  const crossing = (leg: Leg) => Number(landing(steps, input, leg, Tsw - dt)[2] > BLOCKED * s);
  const covered = (leg: Leg) => legs.every((other) => other === leg || other.swing || aheadOf(steps, input, other) + v * Tsw <= most);
  const further = (a: Leg, b: Leg) => b.anchor.distanceToSquared(centre) - a.anchor.distanceToSquared(centre);
  return legs.filter((leg) => !leg.swing && covered(leg)).sort((a, b) => crossing(a) - crossing(b) || further(a, b))[0];
}

/**
 * A gait's clock kept: its footfalls shifting toward the gait's at the pace it keeps — a walk's, a trot's, a gallop's — no faster than
 * `SHIFT` of a cycle a cycle; each foot lifting its own stance after it lands (a leg whose gait has it stand shorter lifts sooner — a
 * horse's hinds at a walk); the clock running while the feet step or would: walking, turning, squaring up.
 */
export function keepTime(steps: Steps, input: StepInput, cues: Cues) {
  const gait = steps.st.gait;
  if (!gait) return;
  const { legs } = steps, { pacing, dt, C, duty, Ts, Tsw, lead, moving, pressed } = input;
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
  const underway = moving > 0 || pressed !== 0 || input.r.wanted !== undefined;
  if (underway && !steps.going && legs.every((leg) => !leg.swing)) [steps.clock, steps.since] = [steps.lifts[firstStep(steps, input, lead).i], 0];
  steps.going = underway || legs.some((leg) => leg.swing);
  if (!underway && !legs.some((leg) => leg.swing || wants(steps, input, cues, leg))) return;
  // (a foot whose turn passes while it is held down still owes its step: it takes it as soon as it may, not a cycle on)
  const was = legs.map((leg) => inTurn(steps, leg));
  steps.clock = (steps.clock + dt / C) % 1;
  steps.since += dt / C;
  for (const leg of legs) {
    const passed = was[leg.i] && mod(steps.clock - steps.lifts[leg.i]) >= SLOT;
    if (!leg.swing && passed && stood(input, leg) && moving > 0) steps.owed[leg.i] = true;
  }
}

/** whether a foot's turn in a gait has come round since it set off, within `SLOT` of a cycle */
export function inTurn(steps: Steps, leg: Leg): boolean {
  const into = mod(steps.clock - steps.lifts[leg.i]);
  return into < SLOT && into <= steps.since + 1e-9;
}

/** The feet that are due lifted, the furthest from home first. */
export function liftFeet(steps: Steps, input: StepInput, cues: Cues) {
  // (a foot that waited for the weight to go off it — `ready` keeps `unloading` for it — lifts unloaded)
  const was = steps.unloading;
  steps.unloading = null;
  // (the one the weight goes off first, so another due does not turn the shift back while it goes)
  const order = furthestOf(steps, input, input.lead).sort((a, b) => Number(b.i === was) - Number(a.i === was));
  for (const leg of order) {
    const other = steps.legs[steps.pair[leg.i]];
    if (ready(steps, input, cues, leg, other, was === leg.i)) liftLeg(steps, input, leg, { capture: leg === cues.catcher, unloaded: was === leg.i });
  }
  // (and the body stands on the others through its swing, slow: the weight stays off it till it lands)
  const unloaded = steps.legs.find((leg) => leg.swing?.unloaded);
  if (steps.unloading === null && unloaded && slow(steps, input)) steps.unloading = unloaded.i;
}

/** whether `leg` lifts now, `other` the leg across from it (the weight already going off it: `unloading`) */
function ready(steps: Steps, input: StepInput, cues: Cues, leg: Leg, other: Leg, unloading: boolean): boolean {
  const { legs } = steps, { r, dt, airborne, C } = input;
  const urgent = isUrgent(steps, input, cues, leg, other);
  if (airborne && !urgent) return false;
  // (a gait's body never leaves fewer than `STANDING` feet on the floor — nor than its gait has down as steps one lifts: a trot quicker
  // than half its cycle in stance has a moment in the air — one out of reach waits, the others land first)
  // (one of a pair lifting in steps sub-step still counts as down: the pair leaves the floor together)
  const down = legs.filter((o) => o !== leg && (!o.swing || (o.swing.age <= dt && together(steps, leg, o)))).length;
  if (steps.clocked && !airborne && down < Math.min(STANDING, steps.scheduled[leg.i])) return false;
  // (nor, walking, while one its gait never has in the air with it is — their turns a swing or more apart — out of reach or not: it waits
  // for it to land, as the planner foresees)
  if (steps.clocked && !airborne && isWalking(steps) && legs.some((o) => o.swing && exclusive(steps, leg, o, input))) return false;
  // (nor lifts a foot it has only just put down: a step lands and bears weight before the next)
  if (steps.clocked && !leg.swing && leg.planted < SETTLING * C) return false;
  // A physical flight lands before stepping again; planned roots can also wait between ordinary strides.
  if (leg.swing || (!airborne && leg.landed && (r.forecast || leg.leapt))) return false;
  // (nor just after one its gait sets apart from it, out of reach or not: the feet leave the floor one by one, `TOGETHER` apart)
  if (steps.clocked && !airborne && legs.some((o) => o !== leg && o.lifted < TOGETHER * C && !together(steps, leg, o))) return false;
  const due = urgent || lifts(steps, input, cues, leg, other);
  // (nor, slow, one the weight is on: it goes onto the others first — an anticipatory shift — then the foot lifts, the shift once begun
  // carried through; a catch steps the foot furthest from it, at once)
  if (due && leg !== cues.catcher && (unloading || slow(steps, input)) && loaded(steps, input, leg)) {
    steps.unloading ??= leg.i;
    return false;
  }
  return due;
}

/** whether a foot that need not step at once lifts now: it wants to, bearing weight a while since it landed, in its turn after the other */
function lifts(steps: Steps, input: StepInput, cues: Cues, leg: Leg, other: Leg): boolean {
  const { r, C, Ts } = input;
  // (nor, unless it must, a walker's foot just put down: it bears weight before it is wanted again — one landed ahead of its hip on the
  // tread below stepped again the next sub-step, the pelvis bouncing up 14 cm)
  if (leg.landed || (r.forecast && leg.planted < SETTLING * C) || !wants(steps, input, cues, leg)) return false;
  // alternate: lift once the other foot has stood (walking) or before it lands (running, a flight)
  const otherLands = other.swing ? remaining(other.swing) : -other.planted;
  const alternates = steps.clocked || otherLands + Ts - C * steps.apart[leg.i] <= 1e-9;
  return alternates && !yields(steps, input, cues, leg, other);
}

/** whether a foot steps at once, the other in the air or not: about to be out of reach, under the body, catching a fall */
function isUrgent(steps: Steps, input: StepInput, cues: Cues, leg: Leg, other: Leg): boolean {
  const { st, feet } = steps, s = st.scale, { r, airborne, air, vy, yaw, most } = input;
  // (leaping, the feet leave the floor as the body does: the legs pushed off during the launch)
  if (airborne) return !leg.swing && air > 0;
  // (a planned walk keeps its supporting foot down even when short of reach; so does a walking landing while its knees recover, and a foot
  // the body pivots on or turns quickly over: lifted, both feet were in the air. A run's flight is both in the air: a foot lifts once it has
  // stood its stance, the other down or not; before then its reach alone would have it stand a frame)
  const recovering = !!input.contact && input.run === 0 && (steps.jumping.phase === 'down' || steps.jumping.phase === 'up');
  const pivoting = leg.pivot !== undefined || (input.spinning && steps.pivots(leg));
  const flies = runs(steps.st, input.v) && leg.planted >= input.Ts;
  if (other.swing && ((r.forecast && !flies) || recovering || pivoting) && !steps.clocked) return false;
  // A lower leading foot takes the weight as the pelvis descends. A foot already home cannot improve its reach by stepping in place.
  const ahead = aheadOf(steps, input, leg) < 0;
  const down = ahead && (steps.legs.some((o) => o !== leg && !o.swing && o.anchor.y > leg.anchor.y + RISE) || (!!r.forecast && leg.planted < SETTLING * input.C));
  if (!down && legReach(steps, input, leg) < nominal(steps, input) + Math.max(0, vy) * RISING - THRESHOLDS.short * s
    && offHome(steps, input, leg, input.lead) > THRESHOLDS.still * s) return true;
  if (leg.landed) return false;
  if (leg === cues.catcher) return true;
  // (strayed from its hip as the body stands, not as its weight is shifted over the feet: the far foot is not in under a body leaning its
  // weight onto the other, and stepped for it, the shift off it to lift it took the hip back and the step with it, rocking the weight)
  const hip = _v.subVectors(hipOf(steps, input, leg), steps.shifted);
  return strayed(st, feet, leg, hip.sub(leg.anchor).dot(leftOf(yaw)) * leg.sign) || aheadOf(steps, input, leg) > most;
}

/** whether the weight is on `leg` (`bears`), as the forecast's extrapolated centre of mass and the planted feet's prints have it: `FORESEEN`
 * sooner than the dev check finds it */
function loaded(steps: Steps, input: StepInput, leg: Leg): boolean {
  const { st, feet, legs } = steps;
  if (st.capture === undefined) return false;
  const others = legs.filter((o) => o !== leg && !o.swing);
  if (!others.length) return true;
  const centre = input.r.xcom ? _centre.copy(input.r.xcom).setY(0) : xcomAhead(steps, input, 0, _centre);
  const prints = (on: Leg[]) => on.flatMap((o) => feet.print(o.i, o.anchor, o.yaw));
  return bears(centre, prints([leg]), prints(others), st.scale, FORESEEN);
}

/**
 * whether a walker — a foreseen root's — stands, its root slower than `UNLOADED` (m/s): a foot lifts only once the weight is off it (an
 * anticipatory shift, as gait initiation's — squaring up, turning on the spot, stepping aside); going, its momentum carries it over to each
 * landing; a followed root's feet keep up with it as it goes
 */
function slow(steps: Steps, input: StepInput): boolean {
  return !input.airborne && !!input.r.forecast && steps.st.capture !== undefined && input.v < UNLOADED * steps.st.scale;
}

/** whether a foot that would step lets `other`, standing, step first: the two ways of stepping part here */
function yields(steps: Steps, input: StepInput, cues: Cues, leg: Leg, other: Leg): boolean {
  if (other.swing) return false;
  return input.r.forecast ? walkerYields(steps, input, cues, leg, other) : followerYields(steps, input, leg, other);
}

/**
 * A walker's foot — a foreseen root's — lets the other step first: side-stepping, the foot on the side it goes opens, the other closing
 * after it (first it does not step away from its way); slow, the foot that stepped last lets the other turn first if it is turned off
 * (the feet alternate, turning on the spot); one that will be nearer its home than the other a swing on (a gait's feet keep its order
 * instead). One that would have to cross the other closes beside it instead: left waiting, it would trail out of reach.
 */
function walkerYields(steps: Steps, input: StepInput, cues: Cues, leg: Leg, other: Leg): boolean {
  const { v, across } = input;
  if (v > 0 && across * leg.sign < -SIDE && leg.lifted <= other.lifted) return true;
  if (v < SHUFFLING && leg.lifted < other.lifted && !other.landed && turnedOff(steps, input, cues, other)) return true;
  return !steps.clocked && behind(steps, input, other, leg) && !turnedOff(steps, input, cues, leg);
}

/** A followed foot — an unforeseen root's — lets the other step first if it would have to cross it and the other would not, else if it
 * will be nearer its home than the other a swing on (a gait's feet keep its order: none waits on the one across its girdle). Each waiting
 * on the other — the nearer one for the further, which waits for it not to cross — a body turned far from its feet stood so. */
function followerYields(steps: Steps, input: StepInput, leg: Leg, other: Leg): boolean {
  if (steps.clocked) return false;
  const crosses = (foot: Leg) => landing(steps, input, foot, input.Tsw - input.dt)[2] > BLOCKED * steps.st.scale;
  const crossing = crosses(leg);
  return crossing !== crosses(other) ? crossing : behind(steps, input, other, leg);
}

/** whether `other` will be further from its home than `leg` a swing on, by more than a step */
function behind(steps: Steps, input: StepInput, other: Leg, leg: Leg): boolean {
  const then = input.lead + input.Tsw;
  return offHome(steps, input, other, then) > offHome(steps, input, leg, then) + THRESHOLDS.distance * steps.st.scale;
}

/**
 * whether a foot wants to step: off its home, turned off it, or overdue (still, only to even out a stance staggered fore and aft: a
 * squat needs them side by side); a gait's only in its turn, having stood a while, out of turn only fallen `BEHIND` of a stance's travel
 * further behind than its stance takes it from where it lands
 */
export function wants(steps: Steps, input: StepInput, cues: Cues, leg: Leg): boolean {
  const s = steps.st.scale, { r, v, spin, held, lead, most, Ts, crouch: k } = input;
  if (r.still && !staggered(steps, input, leg)) return false;
  if (steps.clocked && !stood(input, leg)) return false;
  const off = offHome(steps, input, leg, lead);
  if (steps.clocked) {
    const far = off > (v > 0 || spin !== 0 ? THRESHOLDS.distance : THRESHOLDS.still) * s;
    return (due(steps, input, leg) && (held || far || turnedOff(steps, input, cues, leg))) || off > (1 + BEHIND) * most;
  }
  const far = off > (v > 0 || spin !== 0 || k > 0 ? THRESHOLDS.distance : THRESHOLDS.still) * s;
  return (far && due(steps, input, leg)) || off > Math.max(THRESHOLDS.distance * s, DUE * v * Ts) || turnedOff(steps, input, cues, leg);
}

/**
 * whether a foot is due: moving, its share of a cycle after the leg before it lifted (the steps stay even); standing, after a moment; a
 * gait's by its clock, walking or turning: within `SLOT` of a cycle after its offset comes round
 */
function due(steps: Steps, input: StepInput, leg: Leg): boolean {
  const { C, Ts, moving } = input;
  if (steps.clocked) return inTurn(steps, leg) || steps.owed[leg.i] || (leg.planted >= C * DUE && steps.since >= DUE);
  if (moving > 0) return steps.legs[steps.before[leg.i]].lifted >= C * steps.gap[leg.i] || leg.planted >= Ts * DUE;
  return leg.planted >= THRESHOLDS.square;
}

/** whether a gait's feet each leave the floor in a turn of their own (a walk's), none with another (a trot's diagonals) */
export function isWalking(steps: Steps): boolean {
  return steps.legs.every((a) => steps.legs.every((b) => a === b || !together(steps, a, b)));
}

/** whether a gait never has two feet in the air together: their turns a swing or more apart either way round */
export function exclusive(steps: Steps, a: Leg, b: Leg, input: Timing): boolean {
  const d = mod(steps.lifts[a.i] - steps.lifts[b.i]);
  return Math.min(d, 1 - d) >= input.Tsw / input.C - 1e-9;
}

/** whether a gait has two feet leave the floor together: their footfalls within `TOGETHER` of a cycle */
export function together(steps: Steps, a: Leg, b: Leg): boolean {
  const apart = steps.footfalls[a.i] - steps.footfalls[b.i];
  return Math.abs(apart - Math.round(apart)) < TOGETHER;
}

/** whether a foot has stood `SLOT` of a cycle, or half the gait's stance if that is shorter (a gallop's) */
function stood(input: StepInput, leg: Leg): boolean {
  return leg.planted >= Math.min(SLOT, input.duty / 2) * input.C;
}

/** whether a foot stands staggered fore and aft of the one across from it */
function staggered(steps: Steps, input: StepInput, leg: Leg): boolean {
  const other = steps.legs[steps.pair[leg.i]];
  return Math.abs(_b.subVectors(other.anchor, leg.anchor).dot(forwardOf(input.yaw, _f))) > STAGGERED * steps.st.scale;
}

/** whether a foot is turned off the facing, and off where the body turns to */
function turnedOff(steps: Steps, input: StepInput, cues: Cues, leg: Leg): boolean {
  const off = (facing: number) => Math.abs(wrapAngle(leg.yaw - facing - leg.sign * steps.st.toeOut)) > cues.turn;
  return off(input.yaw) && off(cues.turningTo);
}

/** Start the gait with the furthest foot; effectively tied feet take the longest-rested one's turn. */
function firstStep(steps: Steps, input: StepInput, ahead: number): Leg {
  const distances = steps.legs.map((leg) => offHome(steps, input, leg, ahead));
  const furthest = Math.max(...distances);
  // A symmetric turn must not choose its diagonal pair from roundoff in the foot distances.
  const tied = steps.legs.filter((leg) => furthest - distances[leg.i] <= 1e-6 * steps.st.scale);
  return tied.reduce((first, leg) => leg.lifted > first.lifted ||
    (leg.lifted === first.lifted && steps.lifts[leg.i] < steps.lifts[first.i]) ? leg : first);
}

/** the legs, the foot furthest from its home `ahead` s on first */
function furthestOf(steps: Steps, input: StepInput, ahead: number): Leg[] {
  const distances = steps.legs.map((leg) => offHome(steps, input, leg, ahead));
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
/** Tuned (m, default body): how much sooner the stepper finds the weight on a foot than the dev check does (`bears`): its forecast and
 * prints part from the final pose by ~5 mm at the margin (measured: the heroes' turn on a tread, finale), and its prints, a heel's middle
 * and the toes, from the check's heel-wide soles by up to half a heel's width (`heelSides`, ~3.3 cm) where the centre lies beside the heel:
 * covering only the first, a body setting off with its weight between its feet lifted the foot the check found it on */
const FORESEEN = 0.035;
/** Tuned: a root slower than `UNLOADED` (m/s, × scale) stands: a foot lifts only once the weight is off it (a little quicker than the
 * dev check's still body, `checkSupport`, whose centre of mass lags its root setting off; quicker, walk starts held back slipped a step on
 * stairs) */
const UNLOADED = 0.15;
/** Tuned: a gait's footfalls shift toward another gait's at most this share of a cycle a cycle: a change of gait over a stride or two */
const SHIFT = 0.5;
/** Tuned: a root rising (getting up from a landing) asks `RISING` s sooner for a foot out of reach: it steps before its leg goes straight */
const RISING = 0.5;
