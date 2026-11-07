import { Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import type { Frame } from '../../kernel/frame';
import { Carrier } from '../../kernel/carrier';
import { type Live, type Goal } from '../../kernel/goal';
import { loadFactor } from '../../kernel/load';
import { course, type Waypoint } from '../../kernel/course';
import { during, type Request } from '../../kernel/requests';
import { handsOn, inHand, worn } from '../../things/hold';
import type { Thing } from '../../things/thing';
import type { Reacher } from './reacher';
import { handStep, HOLD } from './arms';
import { sideOf } from '../../species/humanoid/bones';
import { bringShoulder } from './bend';
import { ChainTip } from '../../kernel/tip';
import { following, LEADING, limitOf } from './reach';
import { grasped, seat, type Regripping } from './grasp';
import type { Hold } from '../../things/resolve';
import type { Guide, Guides } from './guide';

// A carried thing along its course: the hands holding it on its guide, until it has come to rest at the course's end — or is late there,
// stalled short of it, or held off it by the body's own trunk and head — its one-handed grasp weighed for the end as it nears it.

/** the longest a carried thing takes to come to rest at its course's end once it is over, unless told (s); how long it stands still
 * (within `moved`, m) short of it to be as near as the arms take it, and how near it then is there (`close`, m) */
const RESTING = 2, STALL = { moved: 0.003, turned: 0.005, seconds: 0.3, close: 0.015, turn: 0.15 };
/** how far off its place (m) the fingers seat a thing in one hand, the arm leaving it there: a couple of centimetres, as far as fingers
 * push or draw what they hold without the hand moving */
const SEATS = 0.03;
/** how near its end's turn (rad) a thing carried to a turned end is to have arrived: there, turned too */
const TURNED = 0.05;

/** Tuned: how long (s) before a carry's course ends the hand holding it alone weighs its grasp for its end (`planGrasp`): about where
 * the body will stand and how it will bow by then, with time for a regrip (`REGRIP`) before it comes there */
const PLANNED = 0.5;
/** Tuned: how long (s) a carry's course may be over, its thing not yet at rest at its end, before its hand plans its grasp again */
const SETTLING = 0.5;

/**
 * Follow a course with load compliance only on support take-up, until the thing rests within `near` of its course's end; report a late
 * settling endpoint. The `end` of a carry fails it instead of waiting on: once late, or once at rest where the body's own trunk and head
 * hold it off its end (a carry ends true only with the thing in place). Late is timed from the course's end — on a leg the carry `walks`,
 * from when the body stands. Its request's eta is `eta` of the course's time left (s; default that time): what the carry does besides the
 * course counted in.
 */
export function* travel(person: Reacher, request: Request, thing: Thing, waypoints: readonly Waypoint[], guides: Guides, resting: boolean,
  { near = END.distance, on, end = false, walks = false, ready, eta = (left) => left, grasp }: { near?: number; on?: (f: Frame) => Goal; end?: boolean; walks?: boolean; ready?: () => boolean; eta?: (left: number) => number; grasp?: Regripping } = {}) {
  const carrier = person.track(thing.object);
  const grips = Object.fromEntries(Object.entries(person.holding).flatMap(([side, hold]) => hold?.thing === thing ? [[sideOf(side), hold.grip]] : []));
  // (a hand carrying alone while the leading hand carries something of its own goes a moment after it; one beside a leading hand that
  // holds what the body wears — a rifle on its sling — goes at once)
  const leading = person.holding[LEADING]?.thing;
  const lag = grips[LEADING] === undefined && leading && !worn(leading) ? following(carrier.current.position, grips) : { delay: 0, slower: 0 };
  const factor = loadFactor(thing.mass);
  const guide = guides(factor);
  const from = carrier.current.position.y;
  // (take-up and compliance belong to lifting off a support, not every carried waypoint; mass slows the lift's acceleration and path)
  const load = resting ? factor - 1 : 0;
  const pace = (1 - lag.slower) / factor, path = course(carrier, waypoints, { pace, delay: lag.delay, on });
  const total = waypoints.reduce((sum, [seconds]) => sum + seconds / pace, 0);
  let began = NaN, since = NaN, stood = NaN, still = NaN, late = false, blocked = false, dip = 0, seated = NaN;
  /** where its end was a sub-step before */
  const ended = { position: new Vector3(), quaternion: new Quaternion(), time: -Infinity };
  // (whether its end sets a turn — an object, not a point: its course turns the thing on either way, from how it set out)
  const ending = waypoints[waypoints.length - 1][1];
  const turns = (f: Frame) => (typeof ending === 'function' ? ending(f, carrier.current, carrier.current) : ending).quaternion !== undefined;
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
    return end && turns(f) && hand !== undefined && !others.length && inHand(person, thing) ? sideOf(hand) : null;
  };
  const there = (f: Frame) => {
    if (!Number.isNaN(seated)) return f.time >= seated;
    if (!path.over(f) || ready?.() === false) return false;
    if (Number.isNaN(since)) since = f.time;
    if (grasp && f.time - since > SETTLING) grasp.settling(f);
    // (its lateness timed from its course's end; on a leg the carry walks, from when the body stands, not while it still walks there)
    if (Number.isNaN(stood) && (!walks || !person.locomotion.moving)) stood = f.time;
    const guided = guide.read(f, to).current, goal = guide.goal.position;
    // Load compliance: https://pmc.ncbi.nlm.nih.gov/articles/PMC4443842/ (F = k × displacement).
    // Tuned, not measured: an upward carry dips 2.7 cm over 0.8 s at 8 kg, then recovers.
    dip = 0.08 * load * Math.min(1, Math.max(0, goal.y - from) / 0.1);
    // (an end that sets a turn is arrived at turned too, not on its place alone — or, once late, on its place however it is turned)
    const turnedOff = turns(f) ? carrier.current.quaternion.angleTo(guide.goal.quaternion) : 0;
    const short = carrier.current.position.distanceTo(goal), close = short <= STALL.close && turnedOff <= STALL.turn;
    // (at its place — its guide there, only the arm leaving it off — within the fingers' reach of it (`SEATS`), a thing in one hand is
    // seated on it there, what the arm leaves made up in the fingers rather than waited on: put there then, it sits exactly on it)
    const side = seating(f), led = guided.position.distanceTo(goal) <= near && guided.quaternion.angleTo(guide.goal.quaternion) <= TURNED;
    const resting = rested(f, carrier, goal, turns(f) ? guide.goal.quaternion : undefined);
    if (side && led && short <= SEATS && !resting.spins && turnedOff <= STALL.turn && guide.off <= near && (dip === 0 || f.time - since >= seconds) && f.time - ended.time < 1.5 * f.dt) {
      // (the thing as it stood with its end a sub-step before, as `restingAt` reads them: a sub-step apart, a moving body's place would
      // seem off it by as far as it moves in one)
      seated = seat(person, side, thing, carrier.moved(f.time) ? carrier.prev : carrier.current, ended);
      return false;
    }
    ended.position.copy(guide.goal.position);
    ended.quaternion.copy(guide.goal.quaternion);
    ended.time = f.time;
    if (resting.rests && (turnedOff <= TURNED || late) && (dip === 0 || f.time - since >= seconds)) {
      if (!end || guide.off <= near) return true;
      // (at rest where its own body holds it, short of its end: the body stands in its way, and no further waiting brings it there)
      if (!blocked) {
        blocked = true;
        f.dev?.append(f.time, { check: 'carry: held clear of its own body, off its end (m)', value: guide.off, limit: near, where: thing.object.name, detail: inTheWay(guide) });
        request.fail();
      }
      return false;
    }
    // (standing still short of its end: as near as the arms take it — there, within `STALL.close`, a hand's joints holding it a few
    // millimetres off; else late, no waiting brings it nearer)
    // (still on its end, however the end and the body under it sway: a thing held short of a point the body carries moves with it)
    const offset = _off.subVectors(carrier.current.position, goal);
    if (Number.isNaN(still) || offset.distanceTo(was) > STALL.moved || (turns(f) && carrier.current.quaternion.angleTo(wasTurned) > STALL.turned)) {
      still = f.time;
      was.copy(offset);
      wasTurned.copy(carrier.current.quaternion);
    }
    const stalled = f.time - still > STALL.seconds;
    if (stalled && (short > near || turnedOff > TURNED) && close && (!end || guide.off <= near)) return true;
    if (!late && (f.time - stood > RESTING || (stalled && !close))) {
      late = true;
      const turned = turnedOff > TURNED ? `, turned ${(turnedOff * 180 / Math.PI).toFixed(0)}° off its turn` : '';
      f.dev?.append(f.time, { check: `late carry: course end distance after ${(f.time - since).toFixed(1)} s (m)`, value: short, limit: near, where: thing.object.name,
        detail: `stopped ${cm(short)} cm off it${turned}: ${guide.off > near ? inTheWay(guide) : limits(person, thing, guide)}` });
      if (end) request.fail();
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
function limits(person: Reacher, thing: Thing, guide: Guide): string {
  const goal = guide.goal;
  return Object.entries(person.holding).flatMap(([side, hold]) => hold?.thing === thing
    ? [`${side} hand ${limitOf(person, sideOf(side))(_g.copy(hold.goal.position).applyQuaternion(goal.quaternion).add(goal.position))}`] : []).join('; ');
}

/** why a carried thing its own body holds off its end is not there */
const inTheWay = (guide: Guide) => `its own trunk and head hold it ${cm(guide.off)} cm off its end: the body stands too near it`;

const cm = (m: number) => (100 * m).toFixed(1);

/** each hold's arm as a carry moves it: one through all the carry's stages and its keeping after, so its brakes and its fit carry on
 * across them rather than starting afresh at each */
const tips = new WeakMap<Hold, ChainTip>();
function tipOf(hold: Hold, hand: string): ChainTip {
  let tip = tips.get(hold);
  if (!tip) tips.set(hold, (tip = new ChainTip(`${hand}Arm`)));
  return tip;
}

/** Keep each held grip on its own arm; a released or replaced hold stops participating. */
export function holdAlong(person: Reacher, request: Request, thing: Thing, guide: Guide, to: Live<Goal>, until?: (f: Frame) => boolean, keep = false) {
  const hands = Object.entries(person.holding).flatMap(([hand, hold]) => hold?.thing === thing
    ? [{ side: sideOf(hand), hold, tip: tipOf(hold, hand) }] : []);
  // (in one hand, it hangs from the hand as the hand grasps it: the hand goes where the thing is to go, turned with it)
  const single = hands.length === 1 ? grasped(person, hands[0].side, thing) : null;
  const step = ({ side, tip }: (typeof hands)[number]) => (f: Frame) => {
    const carrier = guide.read(f, to), hold = person.holding[side], carried = carrier.carriedBy === person;
    if (!hold || hold.thing !== thing) return;
    // (the hand on the carrier, its motion the carrier's: a goal the body carries — a pouch on its chest — is followed with the body however
    // briskly it runs, only the way to it braked)
    if (single) {
      const goal = single(f);
      bringShoulder(person, f, side, _g.copy(goal.position).applyQuaternion(carrier.current.quaternion).add(carrier.current.position), 1, 0, carried);
      handStep(person, f, side, goal, { on: carrier, ...HOLD, lead: true }, tip);
      return;
    }
    bringShoulder(person, f, side, _g.copy(hold.goal.position).applyQuaternion(carrier.current.quaternion).add(guide.goal.position), 1, 0, carried);
    person.carrying.set(thing.object, carrier);
    handStep(person, f, side, hold.goal, { on: carrier, thing, ...HOLD, lead: true }, tip);
  };
  return parallel<Frame>('race', ...hands.map((hand) => {
    const move = step(hand);
    if (keep) hand.hold.keep = move;
    return during(request, `hand.${hand.side}`, 'asked', move, until);
  }));
}

/** where a carried course ends, followed as its frame moves it: a thing has come to rest there once within 5 mm of it (or as near as its
 * course asks) and moving with it to within 5 cm/s and turning with it to within 0.5 rad/s (5 cm/s a hand's breadth out), read as the
 * thing and the end were a sub-step before */
const END = { distance: 0.005, speed: 0.05, spin: 0.5 };

/** how a carried thing stands at its course's end (`at`): whether it has come to rest there, as `END` has it, within `near` of it, and
 * whether, at an end that sets a turn (`turn`), it still turns there — a thing swung through its end's turn is not in it as it passes */
function restingAt(near: number): (f: Frame, carrier: Carrier, at: Readonly<Vector3>, turn?: Readonly<Quaternion>) => { rests: boolean; spins: boolean } {
  let end: Carrier | null = null;
  return (f, carrier, at, turn) => {
    end ??= new Carrier(new Vector3().copy(at), new Quaternion().copy(turn ?? IDENTITY));
    if (!end.moved(f.time)) end.move(f.time, at, turn ?? IDENTITY);
    // (a thing its body moves is moved after the hands, so not yet this sub-step; one hanging from a hand is read where the hand is now)
    const [thing, before] = carrier.moved(f.time) ? [carrier.prev, carrier.prev2] : [carrier.current, carrier.prev];
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
