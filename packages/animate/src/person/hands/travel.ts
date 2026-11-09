import { Quaternion, Vector3 } from 'three';
import type { Placement } from '../../kernel/goal';
import { parallel } from '@pmndrs/timeline';
import type { Frame } from '../../kernel/frame';
import { END } from '../../body/hand-staging';
import { MovingFrame } from '../../kernel/moving-frame';
import { REACHED, type Live, type Goal } from '../../kernel/goal';
import { loadFactor } from '../../kernel/load';
import { timedPath, type Waypoint } from '../../kernel/timed-path';
import { during, type Request } from '../../kernel/requests';
import { handsOn, inHand, worn } from '../../things/hold';
import type { Thing } from '../../things/thing';
import { handStep, HOLD } from './arms';
import { sideOf } from '../anatomy/bones';
import { bringShoulder } from './shoulder';
import { LimbMover } from '../../kernel/limb';
import { following, LEADING, limitOf } from './reach';
import { grasped, seat, shifts, type Regripping } from './grasp';
import type { Guide, Guides } from './guide';
import type { Person } from '../person';

// A carried thing along its path: the hands holding it on its guide, until it has come to rest at the path's end — or is late there,
// stalled short of it, or held off it by the body's own trunk and head — its one-handed grasp weighed for the end as it nears it.

/** the longest a carried thing takes to come to rest at its path's end once it is over, unless told (s) */
const RESTING = 2;
/** how long a carried thing stands still (within `moved`, m) short of its end to be as near as the arms take it, and how near it then is there (`close`, m) */
export const STALL = { moved: 0.003, turned: 0.005, seconds: 0.3, close: REACHED.close, turn: REACHED.closeTurn };
/** how far off its place (m) the fingers seat a thing in one hand, the arm leaving it there: a couple of centimetres, as far as fingers
 * push or draw what they hold without the hand moving */
const SEATS = 0.03;
/** how near its end's turn (rad) a thing carried to a turned end is to have arrived: there, turned too */
const TURNED = 0.05;

/** Tuned: how long (s) before a carry's path ends the hand holding it alone weighs its grasp for its end (`planGrasp`): about where
 * the body will stand and how it will bow by then, with time for a regrip (`REGRIP`) before it comes there */
const PLANNED = 0.5;
/** Tuned: how long (s) a carry's path may be over, its thing not yet at rest at its end, before its hand plans its grasp again */
const REFIT_AFTER = 0.5;

/**
 * Follow a path with load compliance only on support take-up, until the thing rests within `near` of its path's end; report a late
 * settling endpoint. The `end` of a carry fails it instead of waiting on: once late, or once at rest where the body's own trunk and head
 * hold it off its end (a carry ends true only with the thing in place); any other leg, once late, is over as far as the arms took it. Late is timed from the path's end — on a leg the carry `walks`,
 * from when the body stands. Its request's eta is `eta` of the path's time left (s; default that time): what the carry does besides the
 * path counted in.
 */
export function* travel(person: Person, request: Request, thing: Thing, waypoints: readonly Waypoint[], guides: Guides, resting: boolean,
  { near = END.distance, on, end = false, walks = false, ready, eta = (left) => left, grasp }: { near?: number; on?: (f: Frame) => Goal; end?: boolean; walks?: boolean; ready?: () => boolean; eta?: (left: number) => number; grasp?: Regripping } = {}) {
  const movingFrame = person.movingFrameOf(thing.object);
  const grips = Object.fromEntries(Object.entries(person.holding).flatMap(([side, hold]) => hold?.thing === thing ? [[sideOf(side), hold.grip]] : []));
  // (a hand carrying alone while the leading hand carries something of its own goes a moment after it; one beside a leading hand that
  // holds what the body wears — a rifle on its sling — goes at once)
  const leading = person.holding[LEADING]?.thing;
  const lag = grips[LEADING] === undefined && leading && !worn(leading) ? following(movingFrame.current.position, grips) : { delay: 0, slower: 0 };
  const factor = loadFactor(thing.mass);
  const guide = guides(factor);
  const from = movingFrame.current.position.y;
  // (take-up and compliance belong to lifting off a support, not every carried waypoint; mass slows the lift's acceleration and path)
  const load = resting ? factor - 1 : 0;
  const pace = (1 - lag.slower) / factor, path = timedPath(movingFrame, waypoints, { pace, delay: lag.delay, on });
  const total = waypoints.reduce((sum, [seconds]) => sum + seconds / pace, 0);
  let began = NaN, since = NaN, stood = NaN, still = NaN, late = false, blocked = false, dip = 0, seated = NaN;
  /** where its end was a sub-step before */
  const ended = { position: new Vector3(), quaternion: new Quaternion(), time: -Infinity };
  // (whether its end sets a turn — an object, not a point: its path turns the thing on either way, from how it set out)
  const ending = waypoints[waypoints.length - 1][1];
  const turns = (f: Frame) => (typeof ending === 'function' ? ending(f, movingFrame.current, movingFrame.current) : ending).quaternion !== undefined;
  const was = new Vector3(), wasTurned = new Quaternion();
  const left = (f: Frame) => Math.max(0, (Number.isNaN(began) ? f.time : began) + lag.delay + total - f.time);
  const rested = restingAt(near);
  const seconds = 2.4 * load;
  const to = (f: Frame) => {
    if (Number.isNaN(began)) began = f.time;
    if (grasp && left(f) <= PLANNED) grasp.nearing(f, left(f) === 0);
    const goal = path.to(f);
    const u = Number.isNaN(since) || seconds === 0 ? 0 : Math.min(1, (f.time - since) / seconds);
    if (dip > 0) goal.position.y -= dip * Math.sin(Math.PI * u) ** 2;
    return goal;
  };
  // (the hand a thing hangs from alone, carried to a place: the fingers seat it there)
  const seating = (f: Frame) => {
    const [hand, ...others] = handsOn(person, thing);
    const hold = hand === undefined ? null : person.holding[hand];
    return end && turns(f) && hold && !others.length && shifts(hold) && inHand(person, thing) ? sideOf(hand) : null;
  };
  const overdue = (f: Frame) => f.time - stood > RESTING;
  const there = (f: Frame) => {
    if (!Number.isNaN(seated)) {
      if (f.time < seated) return false;
      guide.read(f, to);
      if (movingFrame.current.position.distanceTo(guide.goal.position) <= near) return true;
      // (its place moved on while it was seated, or the arm took it off: seated again)
      seated = NaN;
    }
    if (!path.over(f) || ready?.() === false) return false;
    if (Number.isNaN(since)) since = f.time;
    if (grasp && f.time - since > REFIT_AFTER) grasp.settling(f);
    // (its lateness timed from its path's end; on a leg the carry walks, from when the body stands, not while it still walks there)
    if (Number.isNaN(stood) && (!walks || !person.locomotion.moving)) stood = f.time;
    const guided = guide.read(f, to).current, goal = guide.goal.position;
    // Load compliance: https://pmc.ncbi.nlm.nih.gov/articles/PMC4443842/ (F = k × displacement).
    // Tuned, not measured: an upward carry dips 2.7 cm over 0.8 s at 8 kg, then recovers.
    dip = 0.08 * load * Math.min(1, Math.max(0, goal.y - from) / 0.1);
    // (an end that sets a turn is arrived at turned too, not on its place alone — or, once late, on its place however it is turned)
    const turnedOff = turns(f) ? movingFrame.current.quaternion.angleTo(guide.goal.quaternion) : 0;
    const short = movingFrame.current.position.distanceTo(goal), close = closeOn(movingFrame.current, goal, turns(f) ? guide.goal.quaternion : undefined);
    // (at its place — its guide there, only the arm leaving it off — within the fingers' reach of it (`SEATS`), a thing in one hand is
    // seated on it there, what the arm leaves made up in the fingers rather than waited on: put there then, it sits exactly on it)
    const side = seating(f), led = guided.position.distanceTo(goal) <= near && guided.quaternion.angleTo(guide.goal.quaternion) <= TURNED;
    const resting = rested(f, movingFrame, goal, turns(f) ? guide.goal.quaternion : undefined);
    // (once overdue no more: a seat that will not take would go on being tried, and the carry on running)
    if (side && led && !overdue(f) && short <= SEATS && !resting.spins && turnedOff <= STALL.turn && guide.off <= near && (dip === 0 || f.time - since >= seconds) && f.time - ended.time < 1.5 * f.dt) {
      // (the thing as it stood with its end a sub-step before, as `restingAt` reads them: a sub-step apart, a moving body's place would
      // seem off it by as far as it moves in one)
      seated = seat(person, side, thing, movingFrame.moved(f.time) ? movingFrame.prev : movingFrame.current, ended);
      return false;
    }
    ended.position.copy(guide.goal.position);
    ended.quaternion.copy(guide.goal.quaternion);
    ended.time = f.time;
    if (resting.rests && (turnedOff <= TURNED || late) && (dip === 0 || f.time - since >= seconds)) {
      if (!end || guide.off <= STALL.close) return true;
      // (at rest where its own body holds it, short of its end: the body stands in its way, and no further waiting brings it there)
      if (!blocked) {
        blocked = true;
        request.fail({ where: thing.object.name, off: guide.off, limit: STALL.close, why: inTheWay(guide) });
      }
      return false;
    }
    // (standing still short of its end: as near as the arms take it — there, within `STALL.close`, a hand's joints holding it a few
    // millimetres off; else late, no waiting brings it nearer)
    // (still on its end, however the end and the body under it sway: a thing held short of a point the body carries moves with it)
    const offset = _off.subVectors(movingFrame.current.position, goal);
    if (Number.isNaN(still) || offset.distanceTo(was) > STALL.moved || (turns(f) && movingFrame.current.quaternion.angleTo(wasTurned) > STALL.turned)) {
      still = f.time;
      was.copy(offset);
      wasTurned.copy(movingFrame.current.quaternion);
    }
    const stalled = f.time - still > STALL.seconds;
    // (within `STALL.close`, swaying with a body that carries its end, it will never stand still: long enough there is there too)
    if ((stalled || overdue(f)) && (short > near || turnedOff > TURNED) && close && (!end || guide.off <= STALL.close)) return true;
    if (!late && (overdue(f) || (stalled && !close))) {
      late = true;
      // (a place on its way, no end of it: as near as the arms take it, and on — only the end is a carry's to miss)
      if (!end) return true;
      const turned = turnedOff > TURNED ? `, turned ${(turnedOff * 180 / Math.PI).toFixed(0)}° off its turn` : '';
      request.fail({ where: thing.object.name, off: short, limit: near, why: `stopped ${cm(short)} cm off it${turned}: ${guide.off > STALL.close ? inTheWay(guide) : limits(person, thing, guide)}` });
    }
    return false;
  };
  request.eta = eta(left(person.frame));
  yield* holdAlong(person, request, thing, guide, (f) => {
    request.eta = eta(left(f));
    return to(f);
  }, there);
}

/** what holds each hand off where the carried thing's grips would be at its goal, as a late reach says it */
function limits(person: Person, thing: Thing, guide: Guide): string {
  const goal = guide.goal;
  return Object.entries(person.holding).flatMap(([side, hold]) => hold?.thing === thing
    ? [`${side} hand ${limitOf(person, sideOf(side))(_g.copy(hold.goal.position).applyQuaternion(goal.quaternion).add(goal.position))}`] : []).join('; ')
    || 'no hand holds it any more: it was let go during the carry';
}

/** why a carried thing its own body holds off its end is not there */
const inTheWay = (guide: Guide) => guide.clear === 'head'
  ? `the head's clearance holds it ${cm(guide.off)} cm off its end: a thing brought to the face stops clear of it, so choose a target clear of the head`
  : `its own trunk and head hold it ${cm(guide.off)} cm off its end: the body stands too near it, so stand back or choose a target clear of it`;

/** whether a carried thing is on a place, as near as a hand's joints leave it (`STALL.close`), and turned as it is if it sets a turn */
export const closeOn = (at: Placement, position: Vector3, quaternion?: Quaternion) =>
  at.position.distanceTo(position) <= STALL.close && (!quaternion || at.quaternion.angleTo(quaternion) <= STALL.turn);

const cm = (m: number) => (100 * m).toFixed(1);

/** Keep each held grip on its own arm; a released or replaced hold stops participating. */
export function holdAlong(person: Person, request: Request, thing: Thing, guide: Guide, to: Live<Goal>, until?: (f: Frame) => boolean, idles = false) {
  const hands = Object.entries(person.holding).flatMap(([hand, hold]) => hold?.thing === thing
    ? [{ side: sideOf(hand), hold, tip: (hold.arm ??= new LimbMover(`${hand}Arm`)) }] : []);
  // (in one hand, it hangs from the hand as the hand grasps it: the hand goes where the thing is to go, turned with it)
  const single = hands.length === 1 ? grasped(person, hands[0].side, thing) : null;
  const step = ({ side, tip }: (typeof hands)[number]) => (f: Frame) => {
    const movingFrame = guide.read(f, to), hold = person.holding[side], carried = movingFrame.carriedBy === person;
    if (!hold || hold.thing !== thing) return;
    // (the hand on the carrier, its motion the carrier's: a goal the body carries — a pouch on its chest — is followed with the body however
    // briskly it runs, only the way to it braked)
    if (single) {
      const goal = single(f);
      bringShoulder(person, f, side, _g.copy(goal.position).applyQuaternion(movingFrame.current.quaternion).add(movingFrame.current.position), 1, 0, carried);
      handStep(person, f, side, goal, { on: movingFrame, ...HOLD, bodyFollows: true }, tip);
      return;
    }
    bringShoulder(person, f, side, _g.copy(hold.goal.position).applyQuaternion(movingFrame.current.quaternion).add(guide.goal.position), 1, 0, carried);
    person.carrying.set(thing.object, movingFrame);
    handStep(person, f, side, hold.goal, { on: movingFrame, thing, ...HOLD, bodyFollows: true }, tip);
  };
  return parallel<Frame>('race', ...hands.map((hand) => {
    const move = step(hand);
    if (idles) hand.hold.idle = move;
    return during(request, `hand.${hand.side}`, 'asked', move, until);
  }));
}

/** how a carried thing stands at its course's end (`at`): whether it has come to rest there, as `END` has it, within `near` of it, and
 * whether, at an end that sets a turn (`turn`), it still turns there — a thing swung through its end's turn is not in it as it passes */
function restingAt(near: number): (f: Frame, movingFrame: MovingFrame, at: Readonly<Vector3>, turn?: Readonly<Quaternion>) => { rests: boolean; spins: boolean } {
  let end: MovingFrame | null = null;
  return (f, movingFrame, at, turn) => {
    end ??= new MovingFrame(new Vector3().copy(at), new Quaternion().copy(turn ?? IDENTITY));
    if (!end.moved(f.time)) end.move(f.time, at, turn ?? IDENTITY);
    // (a thing its body moves is moved after the hands, so not yet this sub-step; one hanging from a hand is read where the hand is now)
    const [thing, before] = movingFrame.moved(f.time) ? [movingFrame.prev, movingFrame.prev2] : [movingFrame.current, movingFrame.prev];
    const off = _v.subVectors(thing.position, before.position).sub(_g.subVectors(end.prev.position, end.prev2.position)).divideScalar(f.dt);
    // (its turn in its end's frame, a sub-step apart: what it turns more than its end does)
    const turned = _t.copy(end.prev2.quaternion).invert().multiply(before.quaternion).invert()
      .multiply(_u.copy(end.prev.quaternion).invert().multiply(thing.quaternion));
    const spins = turn !== undefined && 2 * Math.atan2(Math.hypot(turned.x, turned.y, turned.z), Math.abs(turned.w)) / f.dt >= END.spin;
    return { rests: thing.position.distanceTo(end.prev.position) < near && off.length() < END.speed && !spins, spins };
  };
}
const _v = new Vector3(), _g = new Vector3(), _off = new Vector3();
const _t = new Quaternion(), _u = new Quaternion(), IDENTITY = new Quaternion();
