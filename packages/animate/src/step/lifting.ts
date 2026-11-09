// When a foot lifts: what prompts it, what holds it down and which goes first.
import { MathUtils, Vector3 } from 'three';
import { forwardOf, leftOf, lerp, wrapAngle } from '../kernel/math';
import { bears, hullOf, outside } from './support';
import { SETTLING, type GaitClock } from './gait-clock';
import { runs, SHUFFLING, THRESHOLDS, strayed } from './thresholds';
import type { Stepper } from './stepper';
import { aheadOf, hipOf, nominal, offHome, legReach, xcomAhead } from './leg-reach';
import { liftLeg } from './swing';
import { RISE, remaining } from './swing-path';
import type { Leg } from './types';
import { landing } from './landing';

/** What prompts a foot to step this sub-step: a fall to catch, how far it is turned off the facing. */
export function promptsOf(stepper: Stepper): Prompts {
  const { st } = stepper, { r, v, spin, Tsw, yaw } = stepper.input;
  const catcher = catcherOf(stepper);
  // (still and no longer turned, the feet square up closer to the facing)
  const turning = lerp(THRESHOLDS.squared, THRESHOLDS.turn, MathUtils.smoothstep(v + Math.abs(spin), 0, 0.3));
  const turn = st.twist === undefined ? turning : Math.min(turning, st.twist / 2);
  // (a walker's foot turned toward the facing foreseen a swing on is where the body is turning, not off it: stepping it again would
  // leave the one turned behind waiting: that one steps first)
  const turningTo = r.forecast && !stepper.clock ? r.forecast(Tsw).yaw : yaw;
  return { catcher, turn, turningTo };
}

/**
 * Balance first: the extrapolated centre of mass — the stance's middle carried on at its speed for √(l/g), Hof — past the feet standing
 * and landing by `capture`, the foot furthest from it steps at once, to under it. Of the feet that may, the one that catches it without
 * crossing the other, else the one furthest from it; only one the others can stand for through its swing: a leading foot stepped on
 * again, the trailing one would be left a stance's most travel behind its hip.
 */
function catcherOf(stepper: Stepper): Leg | undefined {
  const { st, feet, legs } = stepper, s = st.scale, { r, airborne, v, Tsw, most, dt } = stepper.input;
  const capture = st.capture;
  if (airborne || capture === undefined) return undefined;
  const centre = r.xcom ? _centre.copy(r.xcom).setY(0) : xcomAhead(stepper, 0, _centre);
  const falling = outside(hullOf(legs.flatMap((leg) => feet.print(leg.i, leg.anchor, leg.yaw))), centre) > capture * s;
  if (!falling) return undefined;
  const crossing = (leg: Leg) => Number(landing(stepper, leg, Tsw - dt)[2] > BLOCKED * s);
  const covered = (leg: Leg) => legs.every((other) => other === leg || other.swing || aheadOf(stepper, other) + v * Tsw <= most);
  const further = (a: Leg, b: Leg) => b.anchor.distanceToSquared(centre) - a.anchor.distanceToSquared(centre);
  return legs.filter((leg) => !leg.swing && covered(leg)).sort((a, b) => crossing(a) - crossing(b) || further(a, b))[0];
}

/** A gait's clock kept: the cycle starting with the foot furthest behind where it would land, and running while the feet step or would. */
export function keepTime(stepper: Stepper, prompts: Prompts) {
  const { clock, legs, input } = stepper, { landAhead, moving, pressed } = input;
  if (!clock) return;
  clock.retime(input);
  // (setting off from standing, the foot furthest behind steps first; a root its legs hold back is setting off too — its feet step in
  // their turn to make way for it, else it waits on feet that wait on it)
  const underway = moving > 0 || pressed !== 0 || input.r.wanted !== undefined;
  if (underway && !clock.going && legs.every((leg) => !leg.swing)) clock.setOff(firstStep(stepper, clock, landAhead));
  clock.going = underway || legs.some((leg) => leg.swing);
  if (!underway && !legs.some((leg) => leg.swing || wants(stepper, prompts, leg))) return;
  clock.tick(input);
}

/** The feet that are due lifted, the furthest from home first. */
export function liftFeet(stepper: Stepper, prompts: Prompts) {
  // (a foot that waited for the weight to go off it — `ready` keeps `unloading` for it — lifts unloaded)
  const was = stepper.unloading;
  stepper.unloading = null;
  // (the one the weight goes off first, so another due does not turn the shift back while it goes)
  const order = furthestOf(stepper, stepper.input.landAhead).sort((a, b) => Number(b.i === was) - Number(a.i === was));
  for (const leg of order) {
    const other = stepper.legs[stepper.pair[leg.i]];
    if (ready(stepper, prompts, leg, other, was === leg.i)) liftLeg(stepper, leg, { capture: leg === prompts.catcher, unloaded: was === leg.i });
  }
  // (and the body stands on the others through its swing, slow: the weight stays off it till it lands)
  const unloaded = stepper.legs.find((leg) => leg.swing?.unloaded);
  if (stepper.unloading === null && unloaded && slow(stepper)) stepper.unloading = unloaded.i;
}

/** whether `leg` lifts now, `other` the leg across from it (the weight already going off it: `unloading`) */
function ready(stepper: Stepper, prompts: Prompts, leg: Leg, other: Leg, unloading: boolean): boolean {
  const { input } = stepper;
  const { airborne } = input;
  const urgent = isUrgent(stepper, prompts, leg, other);
  if (airborne && !urgent) return false;
  // A physical flight lands before stepping again; planned roots can also wait between ordinary strides.
  if (leg.swing || (!airborne && leg.landed && (stepper.foreseen || leg.leapt))) return false;
  if (stepper.clock?.holdsDown(leg, input)) return false;
  const due = urgent || lifts(stepper, prompts, leg, other);
  // (nor, slow, one the weight is on: it goes onto the others first — an anticipatory shift — then the foot lifts, the shift once begun
  // carried through; a catch steps the foot furthest from it, at once)
  if (due && leg !== prompts.catcher && (unloading || slow(stepper)) && loaded(stepper, leg)) {
    stepper.unloading ??= leg.i;
    return false;
  }
  return due;
}

/** whether a foot that need not step at once lifts now: it wants to, bearing weight a while since it landed, in its turn after the other */
function lifts(stepper: Stepper, prompts: Prompts, leg: Leg, other: Leg): boolean {
  const { C, Ts } = stepper.input;
  // (nor, unless it must, a walker's foot just put down: it bears weight before it is wanted again — one landed ahead of its hip on the
  // tread below stepped again the next sub-step, the pelvis bouncing up 14 cm)
  if (leg.landed || (stepper.foreseen && leg.planted < SETTLING * C) || !wants(stepper, prompts, leg)) return false;
  // alternate: lift once the other foot has stood (walking) or before it lands (running, a flight)
  const otherLands = other.swing ? remaining(other.swing) : -other.planted;
  const alternates = !!stepper.clock || otherLands + Ts - C * stepper.apart[leg.i] <= 1e-9;
  return alternates && !yields(stepper, prompts, leg, other);
}

/** whether a foot steps at once, the other in the air or not: about to be out of reach, under the body, catching a fall */
function isUrgent(stepper: Stepper, prompts: Prompts, leg: Leg, other: Leg): boolean {
  const { st, feet, input } = stepper, s = st.scale, { airborne, air, vy, yaw, most } = input;
  // (leaping, the feet leave the floor as the body does: the legs pushed off during the launch)
  if (airborne) return !leg.swing && air > 0;
  // (a planned walk keeps its supporting foot down even when short of reach; so does a walking landing while its knees recover, and a foot
  // the body pivots on or turns quickly over: lifted, both feet were in the air. A run's flight is both in the air: a foot lifts once it has
  // stood its stance, the other down or not; before then its reach alone would have it stand a frame)
  const recovering = !!input.contact && input.run === 0 && (stepper.jumping.phase === 'down' || stepper.jumping.phase === 'up');
  const pivoting = leg.pivot !== undefined || (input.spinning && stepper.pivots(leg));
  const flies = runs(stepper.st, input.v) && leg.planted >= input.Ts;
  if (other.swing && ((stepper.foreseen && !flies) || recovering || pivoting) && !stepper.clock) return false;
  // A lower leading foot takes the weight as the pelvis descends. A foot already home cannot improve its reach by stepping in place.
  const ahead = aheadOf(stepper, leg) < 0;
  const down = ahead && (stepper.legs.some((o) => o !== leg && !o.swing && o.anchor.y > leg.anchor.y + RISE) || (stepper.foreseen && leg.planted < SETTLING * input.C));
  if (!down && legReach(stepper, leg) < nominal(stepper) + Math.max(0, vy) * RISING - THRESHOLDS.short * s
    && offHome(stepper, leg, input.landAhead) > THRESHOLDS.still * s) return true;
  if (leg.landed) return false;
  if (leg === prompts.catcher) return true;
  // (strayed from its hip as the body stands, not as its weight is shifted over the feet: the far foot is not in under a body leaning its
  // weight onto the other, and stepped for it, the shift off it to lift it took the hip back and the step with it, rocking the weight)
  const hip = _v.subVectors(hipOf(stepper, leg), stepper.shifted);
  return strayed(st, feet, leg, hip.sub(leg.anchor).dot(leftOf(yaw)) * leg.sign) || aheadOf(stepper, leg) > most;
}

/** whether the weight is on `leg` (`bears`), as the forecast's extrapolated centre of mass and the planted feet's prints have it: `FORESEEN`
 * sooner than the dev check finds it */
function loaded(stepper: Stepper, leg: Leg): boolean {
  const { st, feet, legs, input } = stepper;
  if (st.capture === undefined) return false;
  const others = legs.filter((o) => o !== leg && !o.swing);
  if (!others.length) return true;
  const centre = input.r.xcom ? _centre.copy(input.r.xcom).setY(0) : xcomAhead(stepper, 0, _centre);
  const prints = (on: Leg[]) => on.flatMap((o) => feet.print(o.i, o.anchor, o.yaw));
  return bears(centre, prints([leg]), prints(others), st.scale, FORESEEN);
}

/**
 * whether a walker — a foreseen root's — stands, its root slower than `UNLOADED` (m/s): a foot lifts only once the weight is off it (an
 * anticipatory shift, as gait initiation's — squaring up, turning on the spot, stepping aside); going, its momentum carries it over to each
 * landing; a followed root's feet keep up with it as it goes
 */
function slow(stepper: Stepper): boolean {
  const { input } = stepper;
  return !input.airborne && stepper.foreseen && stepper.st.capture !== undefined && input.v < UNLOADED * stepper.st.scale;
}

/** whether a foot that would step lets `other`, standing, step first: the two ways of stepping part here */
function yields(stepper: Stepper, prompts: Prompts, leg: Leg, other: Leg): boolean {
  if (other.swing) return false;
  return stepper.foreseen ? walkerYields(stepper, prompts, leg, other) : followerYields(stepper, leg, other);
}

/**
 * A walker's foot — a foreseen root's — lets the other step first: side-stepping, the foot on the side it goes opens, the other closing
 * after it (first it does not step away from its way); slow, the foot that stepped last lets the other turn first if it is turned off
 * (the feet alternate, turning on the spot); one that will be nearer its home than the other a swing on (a gait's feet keep its order
 * instead). One that would have to cross the other closes beside it instead: left waiting, it would trail out of reach.
 */
function walkerYields(stepper: Stepper, prompts: Prompts, leg: Leg, other: Leg): boolean {
  const { v, across } = stepper.input;
  if (v > 0 && across * leg.sign < -SIDE && leg.lifted <= other.lifted) return true;
  if (v < SHUFFLING && leg.lifted < other.lifted && !other.landed && turnedOff(stepper, prompts, other)) return true;
  return !stepper.clock && behind(stepper, other, leg) && !turnedOff(stepper, prompts, leg);
}

/** A followed foot — an unforeseen root's — lets the other step first if it would have to cross it and the other would not, else if it
 * will be nearer its home than the other a swing on (a gait's feet keep its order: none waits on the one across its girdle). Each waiting
 * on the other — the nearer one for the further, which waits for it not to cross — a body turned far from its feet stood so. */
function followerYields(stepper: Stepper, leg: Leg, other: Leg): boolean {
  const { input } = stepper;
  if (stepper.clock) return false;
  const crosses = (foot: Leg) => landing(stepper, foot, input.Tsw - input.dt)[2] > BLOCKED * stepper.st.scale;
  const crossing = crosses(leg);
  return crossing !== crosses(other) ? crossing : behind(stepper, other, leg);
}

/** whether `other` will be further from its home than `leg` a swing on, by more than a step */
function behind(stepper: Stepper, other: Leg, leg: Leg): boolean {
  const { input } = stepper;
  const then = input.landAhead + input.Tsw;
  return offHome(stepper, other, then) > offHome(stepper, leg, then) + THRESHOLDS.distance * stepper.st.scale;
}

/**
 * whether a foot wants to step: off its home, turned off it, or overdue (still, only to even out a stance staggered fore and aft: a
 * squat needs them side by side); a gait's only in its turn, having stood a while, out of turn only fallen `BEHIND` of a stance's travel
 * further behind than its stance takes it from where it lands
 */
export function wants(stepper: Stepper, prompts: Prompts, leg: Leg, v = stepper.input.v): boolean {
  const { clock, input } = stepper, s = stepper.st.scale, { r, spin, held, landAhead, most, Ts, crouch: k } = input;
  if (r.still && !staggered(stepper, leg)) return false;
  if (clock && !clock.stood(input, leg)) return false;
  const off = offHome(stepper, leg, landAhead);
  if (clock) {
    const far = off > (v > 0 || spin !== 0 ? THRESHOLDS.distance : THRESHOLDS.still) * s;
    return (clock.due(input, leg, DUE) && (held || far || turnedOff(stepper, prompts, leg))) || off > (1 + BEHIND) * most;
  }
  const far = off > (v > 0 || spin !== 0 || k > 0 ? THRESHOLDS.distance : THRESHOLDS.still) * s;
  return (far && due(stepper, leg)) || off > Math.max(THRESHOLDS.distance * s, DUE * v * Ts) || turnedOff(stepper, prompts, leg);
}

/**
 * whether a foot is due: moving, its share of a cycle after the leg before it lifted (the steps stay even); standing, after a moment
 */
function due(stepper: Stepper, leg: Leg): boolean {
  const { C, Ts, moving } = stepper.input;
  if (moving > 0) return stepper.legs[stepper.before[leg.i]].lifted >= C * stepper.gap[leg.i] || leg.planted >= Ts * DUE;
  return leg.planted >= THRESHOLDS.square;
}

/** whether a foot stands staggered fore and aft of the one across from it */
function staggered(stepper: Stepper, leg: Leg): boolean {
  const other = stepper.legs[stepper.pair[leg.i]];
  return Math.abs(_b.subVectors(other.anchor, leg.anchor).dot(forwardOf(stepper.input.yaw, _f))) > STAGGERED * stepper.st.scale;
}

/** whether a foot is turned off the facing, and off where the body turns to */
function turnedOff(stepper: Stepper, prompts: Prompts, leg: Leg): boolean {
  const off = (facing: number) => Math.abs(wrapAngle(leg.yaw - facing - leg.sign * stepper.st.toeOut)) > prompts.turn;
  return off(stepper.input.yaw) && off(prompts.turningTo);
}

/** Start the gait with the furthest foot; effectively tied feet take the longest-rested one's turn. */
function firstStep(stepper: Stepper, { lifts }: GaitClock, ahead: number): Leg {
  const distances = stepper.legs.map((leg) => offHome(stepper, leg, ahead));
  const furthest = Math.max(...distances);
  // A symmetric turn must not choose its diagonal pair from roundoff in the foot distances.
  const tied = stepper.legs.filter((leg) => furthest - distances[leg.i] <= 1e-6 * stepper.st.scale);
  return tied.reduce((first, leg) => leg.lifted > first.lifted ||
    (leg.lifted === first.lifted && lifts[leg.i] < lifts[first.i]) ? leg : first);
}

/** the legs, the foot furthest from its home `ahead` s on first */
function furthestOf(stepper: Stepper, ahead: number): Leg[] {
  const distances = stepper.legs.map((leg) => offHome(stepper, leg, ahead));
  return [...stepper.legs].sort((a, b) => distances[b.i] - distances[a.i]);
}

/** What prompts a foot to step this sub-step: the one that catches a fall, how far a foot may be turned off the facing (rad) and where
 * the body turns to (rad). */
interface Prompts { catcher: Leg | undefined; turn: number; turningTo: number }

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
/** Tuned: a root rising (getting up from a landing) asks `RISING` s sooner for a foot out of reach: it steps before its leg goes straight */
const RISING = 0.5;
const [_v, _b, _f, _centre] = Array.from({ length: 4 }, () => new Vector3());
