import { Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import type { Frame } from '../../kernel/frame';
import { Carrier } from '../../kernel/carrier';
import { type Live, type Goal } from '../../kernel/goal';
import { loadFactor } from '../../kernel/load';
import { course, type Waypoint } from '../../kernel/course';
import { during, type Request } from '../../kernel/requests';
import { handsOn, worn } from '../../things/hold';
import type { Thing } from '../../things/thing';
import type { Reacher } from './reacher';
import { handStep, HOLD } from './arms';
import { sideOf } from '../../species/humanoid/bones';
import { bringShoulder } from './bend';
import { ChainTip } from '../../kernel/tip';
import { following, LEADING, limitOf } from './reach';
import { grasped, planGrasp } from './grasp';
import { resolve, type Hold } from '../../things/resolve';
import type { Aim, CarryAim } from './aim';

// A carried thing along its course: the hands holding it on its aim, until it has come to rest at the course's end — or is late there,
// stalled short of it, or held off it by the body's own trunk and head — its one-handed grasp weighed for the end as it nears it.

/** the longest a carried thing takes to come to rest at its course's end once it is over, unless told (s); how long it stands still
 * (within `moved`, m) short of it to be as near as the arms take it, and how near it then is there (`close`, m) */
const RESTING = 2, STALL = { moved: 0.003, turned: 0.005, seconds: 0.3, close: 0.015, turn: 0.15 };
/** how near its end's turn (rad) a thing carried to a turned end is to have arrived: there, turned too */
const TURNED = 0.05;

/** Tuned: how long (s) before a carry's course ends the hand holding it alone weighs its grasp for its end (`planGrasp`): about where
 * the body will stand and how it will bow by then, with time for a regrip (`REGRIP`) before it comes there */
const PLANNED = 0.5;
/** Tuned: how long (s) a carry's course may be over, its thing not yet at rest at its end, before its hand plans its grasp again */
const SETTLING = 0.5;

/**
 * For a carry of `thing` to `end` in one hand, its grasp planned for its end (`planGrasp`, the end turned as the carry asks or else as
 * the thing is now): as it nears its end (`nearing`) — weighed each sub-step until its course is over, the end and the body as they
 * then stand, for as long as the grasp it has is kept as comfortable there: an end that moves on the body (a rifle's well, the rifle
 * held up to the eye, as the head turns from the pouch to it) is weighed where it has gone, not only where it was half a second before
 * — and once more, from the body as it then stands, if it has not come to rest there `SETTLING` s after its course is over
 * (`settling`): then a thing held turned off its end counts as not held by the grasp it has.
 */
export interface Grasping {
  /** weighed as the course nears its end, the last time as it is `over` */
  nearing: (f: Frame, over: boolean) => void;
  settling: (f: Frame) => void;
}

export function grasping(person: Reacher, thing: Thing, end: (f: Frame) => Goal): Grasping {
  const [hand, ...others] = handsOn(person, thing), hold = hand === undefined || others.length ? null : person.holding[hand];
  const plan = (f: Frame, settling = false) => {
    if (!hold) return false;
    const at = end(f);
    return planGrasp(person, sideOf(hand), thing, hold, { position: at.position, quaternion: at.quaternion ?? resolve(person, thing.object, _placed).quaternion }, settling);
  };
  let kept = true;
  return {
    nearing: (f, over) => {
      if (kept) kept = plan(f) && !over;
    },
    settling: once((f) => plan(f, true)),
  };
}

/** `act`, done the first time only */
function once(act: (f: Frame) => void): (f: Frame) => void {
  let done = false;
  return (f) => {
    if (done) return;
    done = true;
    act(f);
  };
}

/**
 * Follow a course with load compliance only on support take-up, until the thing rests within `near` of its course's end; report a late
 * settling endpoint. The `end` of a carry fails it instead of waiting on: once late, or once at rest where the body's own trunk and head
 * hold it off its end (a carry ends true only with the thing in place). Late is timed from the course's end — on a leg the carry `walks`,
 * from when the body stands. Its request's eta is `eta` of the course's time left (s; default that time): what the carry does besides the
 * course counted in.
 */
export function* travel(person: Reacher, request: Request, thing: Thing, waypoints: readonly Waypoint[], makeAim: Aim, resting: boolean,
  { near = END.distance, on, end = false, walks = false, ready, eta = (left) => left, grasp }: { near?: number; on?: (f: Frame) => Goal; end?: boolean; walks?: boolean; ready?: () => boolean; eta?: (left: number) => number; grasp?: Grasping } = {}) {
  const carrier = person.track(thing.object);
  const grips = Object.fromEntries(Object.entries(person.holding).flatMap(([side, hold]) => hold?.thing === thing ? [[sideOf(side), hold.grip]] : []));
  // (a hand carrying alone while the leading hand carries something of its own goes a moment after it; one beside a leading hand that
  // holds what the body wears — a rifle on its sling — goes at once)
  const leading = person.holding[LEADING]?.thing;
  const lag = grips[LEADING] === undefined && leading && !worn(leading) ? following(carrier.current.position, grips) : { delay: 0, slower: 0 };
  const factor = loadFactor(thing.mass);
  const aim = makeAim(factor);
  const from = carrier.current.position.y;
  // (take-up and compliance belong to lifting off a support, not every carried waypoint; mass slows the lift's acceleration and path)
  const load = resting ? factor - 1 : 0;
  const pace = (1 - lag.slower) / factor, path = course(carrier, waypoints, { pace, delay: lag.delay, on });
  const total = waypoints.reduce((sum, [seconds]) => sum + seconds / pace, 0);
  let began = NaN, since = NaN, stood = NaN, still = NaN, late = false, blocked = false, dip = 0;
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
  const there = (f: Frame) => {
    if (!path.over(f) || ready?.() === false) return false;
    if (Number.isNaN(since)) since = f.time;
    if (grasp && f.time - since > SETTLING) grasp.settling(f);
    // (its lateness timed from its course's end; on a leg the carry walks, from when the body stands, not while it still walks there)
    if (Number.isNaN(stood) && (!walks || !person.locomotion.moving)) stood = f.time;
    aim.read(f, to);
    const goal = aim.goal.position;
    // Load compliance: https://pmc.ncbi.nlm.nih.gov/articles/PMC4443842/ (F = k × displacement).
    // Tuned, not measured: an upward carry dips 2.7 cm over 0.8 s at 8 kg, then recovers.
    dip = 0.08 * load * Math.min(1, Math.max(0, goal.y - from) / 0.1);
    // (an end that sets a turn is arrived at turned too, not on its place alone — or, once late, on its place however it is turned)
    const turnedOff = turns(f) ? carrier.current.quaternion.angleTo(aim.goal.quaternion) : 0;
    if (rested(f, carrier, goal) && (turnedOff <= TURNED || late) && (dip === 0 || f.time - since >= seconds)) {
      if (!end || aim.off <= near) return true;
      // (at rest where its own body holds it, short of its end: the body stands in its way, and no further waiting brings it there)
      if (!blocked) {
        blocked = true;
        f.dev?.append(f.time, { check: 'carry: held clear of its own body, off its end (m)', value: aim.off, limit: near, where: thing.object.name, detail: inTheWay(aim) });
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
    const short = carrier.current.position.distanceTo(goal), stalled = f.time - still > STALL.seconds;
    const close = short <= STALL.close && turnedOff <= STALL.turn;
    if (stalled && (short > near || turnedOff > TURNED) && close && (!end || aim.off <= near)) return true;
    if (!late && (f.time - stood > RESTING || (stalled && !close))) {
      late = true;
      const turned = turnedOff > TURNED ? `, turned ${(turnedOff * 180 / Math.PI).toFixed(0)}° off its turn` : '';
      f.dev?.append(f.time, { check: `late carry: course end distance after ${(f.time - since).toFixed(1)} s (m)`, value: short, limit: near, where: thing.object.name,
        detail: `stopped ${cm(short)} cm off it${turned}: ${aim.off > near ? inTheWay(aim) : limits(person, thing, aim)}` });
      if (end) request.fail();
    }
    return false;
  };
  request.eta = eta(left(person.frame));
  yield* holding(person, request, thing, aim, (f) => {
    request.eta = eta(left(f));
    return to(f);
  }, there);
}

/** what holds each hand off where the carried thing's grips would be at its goal, as a late reach says it */
function limits(person: Reacher, thing: Thing, aim: CarryAim): string {
  const goal = aim.goal;
  return Object.entries(person.holding).flatMap(([side, hold]) => hold?.thing === thing
    ? [`${side} hand ${limitOf(person, sideOf(side))(_g.copy(hold.goal.position).applyQuaternion(goal.quaternion).add(goal.position))}`] : []).join('; ');
}

/** why a carried thing its own body holds off its end is not there */
const inTheWay = (aim: CarryAim) => `its own trunk and head hold it ${cm(aim.off)} cm off its end: the body stands too near it`;

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
export function holding(person: Reacher, request: Request, thing: Thing, aim: CarryAim, to: Live<Goal>, until?: (f: Frame) => boolean, keep = false) {
  const hands = Object.entries(person.holding).flatMap(([hand, hold]) => hold?.thing === thing
    ? [{ side: sideOf(hand), hold, tip: tipOf(hold, hand) }] : []);
  // (in one hand, it hangs from the hand as the hand grasps it: the hand goes where the thing is to go, turned with it)
  const single = hands.length === 1 ? grasped(person, hands[0].side, thing) : null;
  const step = ({ side, tip }: (typeof hands)[number]) => (f: Frame) => {
    const carrier = aim.read(f, to), hold = person.holding[side], carried = carrier.carriedBy === person;
    if (!hold || hold.thing !== thing) return;
    // (the hand on the carrier, its motion the carrier's: a goal the body carries — a pouch on its chest — is followed with the body however
    // briskly it runs, only the way to it braked)
    if (single) {
      const goal = single(f);
      bringShoulder(person, f, side, _g.copy(goal.position).applyQuaternion(carrier.current.quaternion).add(carrier.current.position), 1, 0, carried);
      handStep(person, f, side, goal, { on: carrier, ...HOLD, lead: true }, tip);
      return;
    }
    bringShoulder(person, f, side, _g.copy(hold.goal.position).applyQuaternion(carrier.current.quaternion).add(aim.goal.position), 1, 0, carried);
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
 * course asks) and moving with it to within 5 cm/s, read as the thing and the end were a sub-step before */
const END = { distance: 0.005, speed: 0.05 };

/** whether a carried thing has come to rest at its course's end, as `END` has it, within `near` of it */
function restingAt(near: number): (f: Frame, carrier: Carrier, at: Readonly<Vector3>) => boolean {
  let end: Carrier | null = null;
  return (f, carrier, at) => {
    end ??= new Carrier(new Vector3().copy(at));
    if (!end.moved(f.time)) end.move(f.time, at);
    // (a thing its body moves is moved after the hands, so not yet this sub-step; one hanging from a hand is read where the hand is now)
    const [thing, before] = carrier.moved(f.time) ? [carrier.prev, carrier.prev2] : [carrier.current, carrier.prev];
    const off = _v.subVectors(thing.position, before.position).sub(_g.subVectors(end.prev.position, end.prev2.position)).divideScalar(f.dt);
    return thing.position.distanceTo(end.prev.position) < near && off.length() < END.speed;
  };
}
const _placed = { position: new Vector3(), quaternion: new Quaternion() }, _v = new Vector3(), _g = new Vector3(), _off = new Vector3();
