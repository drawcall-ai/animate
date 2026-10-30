import { Quaternion, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import type { Frame } from '../../kernel/frame';
import { Carrier } from '../../kernel/carrier';
import { movingPoint, type Live, type Motion, type Placement, type Goal } from '../../kernel/goal';
import { loadFactor } from '../../kernel/load';
import { TrackedPoint, TrackedRotation } from '../../kernel/track';
import { course, type Waypoint } from '../../kernel/course';
import { follow } from '../../kernel/follow';
import { noticing } from '../../look/gaze';
import { during, type Request } from '../../kernel/requests';
import { carriedBy, handsOn, heldMass, lift, supported } from '../../things/hold';
import type { Thing } from '../../things/thing';
import type { Reacher } from './reacher';
import { paceAt, type HandOptions } from '../handling';
import type { Clearance, Way } from '../route';
import { floorUnder } from '../../legs/person/legged';
import { handStep, HOLD } from './arms';
import { SIDES, sideOf } from '../../species/humanoid/bones';
import { ARM_REACH, bringShoulder, PROTRACTION } from './bend';
import { ChainTip } from '../../kernel/tip';
import { BODY_RADIUS, clearBody, LOAD_RESERVE } from './clearance';
import { following, LEADING, limitOf } from './reach';
import { footing, walking, type WalkUp } from './stand';
import { grasped, planGrasp } from './grasp';
import { resolve, type Hold } from '../../things/resolve';

/** how fast a held thing is carried where it is to go (m/s², m/s, rad/s², rad/s): calmly */
const CARRYING = { accel: 6, speed: 3, turnAccel: 8, turnSpeed: 4 } satisfies Motion;
/** the longest a carried thing takes to come to rest at its course's end once it is over, unless told (s) */
const RESTING = 2;
/** Tuned: a load heavier than this (kg) lifted off its support first gets the anticipatory knee dip (the APA below): a lighter one is just taken */
const PREPARED = 2;
/** Tuned: a held goal moved further than this (m, × the body's scale) to clear the neck and head is noted */
const CLEARED = 0.02;
/** Artistic calibration (s): a brief preparatory lift, a slower precise raise, begun early enough to overlap arrival. */
const LIFT = 0.5, RAISE = 1.3, RAISE_LEAD = 0.9;
/** Tuned: how far (rad) the body may still have to turn to its stand as a transfer's raise begins */
const RAISE_TURN = 0.5;
/** Tuned (a box shelved overhead, gear put on a horse): a transfer's walk sets off once the load has risen this share of its way to the body */
const APPROACH_RISE = 2 / 3;
/** a carry's pace along a way it goes straight to (m/s, its mean) and how long it takes at least (s), unless told */
const ALONG = { speed: 0.5, least: 0.4 };
/** how far a grab lifts a loose thing clear of what it rests on (m, default body), in how long (s), how far from the hips it draws it in to
 * at most (× the arm's length; tuned: in reach with the back bowed no more than holding asks), and how near it comes to rest (m: clear) */
const CLEAR = { height: 0.03, seconds: 0.4, out: 0.8, near: 0.015 };

/** Carry the route, retaining a fresh aim at each travel/hold boundary. */
export function* carrying(person: Reacher, request: Request, thing: Thing, way: Way, options: HandOptions) {
  const sides = handsOn(person, thing).map(sideOf);
  const resting = supported(thing);
  yield* lifting(person, request, thing);
  const held = sides.map((side) => {
    const hold = person.holding[side];
    if (!hold) throw new Error(`carry: the ${side} hand let go`);
    hold.keep = undefined;
    // (stood to as by its grip empties, as a grab is: a palm's way back from each turns with the hand on the way there)
    return { side, hold, at: thing.grip(hold.grip).at.position };
  });
  const plan = way.own ? 'there' : footing(person, { place: way.points[way.points.length - 1], held }, options.step ?? true);
  if (plan === 'nowhere') {
    request.fail();
    return;
  }
  const end = way.points[way.points.length - 1];
  // (in one hand, its grasp planned for its end as it comes there)
  const grasp = grasping(person, thing, end);
  // (the hands as brisk as the way is quick: `CARRYING` is a calm carry's, along its way at `ALONG.speed`)
  const aim = aimsFor(person, thing, { ...CARRYING, accel: paceAt(options.speed, { speed: ALONG.speed, accel: CARRYING.accel }).accel }, way.clear);
  if (plan === 'there') yield* parallel<Frame>('race', noticing(person, request, (f) => end(f).position), along(person, request, thing, way, aim, resting, grasp, options.speed));
  else yield* transferring(person, request, thing, way, plan, aim, resting, grasp);
  request.met();
  yield* holding(person, request, thing, aim(), end, undefined, way.own);
}

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
interface Grasping {
  /** weighed as the course nears its end, the last time as it is `over` */
  nearing: (f: Frame, over: boolean) => void;
  settling: (f: Frame) => void;
}

function grasping(person: Reacher, thing: Thing, end: (f: Frame) => Goal): Grasping {
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

/** the transfer of a load: lifted to the body, carried there as the legs walk (`plan`), raised onto its place over the last of the walk */
function* transferring(person: Reacher, request: Request, thing: Thing, way: Way, plan: WalkUp, aim: Aim, resting: boolean, grasp: Grasping) {
  const end = way.points[way.points.length - 1];
  const carrier = person.track(thing.object);
  const from = carrier.current.position.y, watched = carrier.current.position.clone();
  // (in both hands, squared to the body; in one, turned with the body as it was taken: a bucket by its handle, squared, would turn the
  // hand half round)
  const single = handsOn(person, thing).length === 1;
  const atBody = carried(person, single ? carrier.current.quaternion.clone().premultiply(new Quaternion().setFromAxisAngle(UP, -person.locomotion.facing)) : IDENTITY);
  const rise = atBody(person.frame).position.y - from;
  let lifted = rise <= 0, approached = false;
  // (raised onto its place as the body comes there turned as it stands: begun before it has turned, the load would turn to its place's
  // facing ahead of the body, its grips swung out of the hands' reach)
  const near = () => plan.walk.there <= RAISE_LEAD && plan.walk.unturned <= RAISE_TURN;
  const eyes = (f: Frame) => lifted ? end(f).position : watched;
  // (the time to its end, `lift` s of the lift still to go: the walk up to the raise, alongside the lift, then the raise — unknown, ∞,
  // before the walk has first stepped)
  const onward = (lift = 0) => Math.max(lift, plan.walk.there - RAISE_LEAD) + RAISE / loadFactor(thing.mass);
  const walked = (f: Frame) => {
    request.eta = onward();
    return atBody(f);
  };
  yield* parallel<Frame>('race', noticing(person, request, eyes), function* () {
    yield* parallel<Frame>('all', function* () {
      yield* action<Frame>({ until: () => lifted || carrier.current.position.y >= from + rise * APPROACH_RISE });
      // (setting off, the eyes leave where it was for where it goes: held on the empty spot, they would swing across behind the body)
      lifted = true;
      if (!(yield* walking(request, plan))) request.fail();
      approached = true;
    }, function* () {
      yield* travel(person, request, thing, [[LIFT, atBody]], aim, resting, { eta: onward });
      lifted = true;
      yield* holding(person, request, thing, aim(), walked, near);
      yield* travel(person, request, thing, way.points.map((point) => [RAISE / way.points.length, point]), aim, false, { grasp });
      // (come to rest on it, not passing it: ended as it went by within reach of its end, it was let go of past it)
      const rested = restingAt(END.distance);
      yield* holding(person, request, thing, aim(), end, (f) => approached && rested(f, carrier, end(f).position));
    });
  });
}

/** carried straight along `way` (no walk): its points timed by their lengths at `speed`, the last straight at its own */
function* along(person: Reacher, request: Request, thing: Thing, way: Way, aim: Aim, resting: boolean, grasp: Grasping, speed = ALONG.speed * person.tempo) {
  let points = way.points;
  if (way.outside > 0) {
    yield* travel(person, request, thing, timed(person, thing, points.slice(0, way.outside), speed),
      (factor) => aim(factor, 'parts'), resting);
    points = points.slice(way.outside);
    resting = false;
  }
  const straight = (way.last !== undefined || way.outside > 0) && points.length > 1;
  const first = straight ? points.slice(0, -1) : points;
  yield* travel(person, request, thing, timed(person, thing, first, speed), aim, resting, { end: !straight, grasp: straight ? undefined : grasp });
  if (straight) yield* travel(person, request, thing, timed(person, thing, points.slice(-1), way.last ?? speed), aim, false, { on: points[points.length - 2], end: true, grasp });
}

/** waypoints through `points` (from where the thing is now), each timed by its length at `speed` (m/s), the whole at least `ALONG.least` s */
function timed(person: Reacher, thing: Thing, points: readonly ((f: Frame) => Goal)[], speed: number): Waypoint[] {
  const f = person.frame;
  let from = person.track(thing.object).current.position.clone();
  const lengths = points.map((point) => {
    const to = point(f).position, length = from.distanceTo(to);
    from = to.clone();
    return length;
  });
  const total = lengths.reduce((sum, length) => sum + length, 0), seconds = Math.max(ALONG.least, total / speed);
  return points.map((point, k) => [total > 0 ? seconds * lengths[k] / total : seconds / points.length, point]);
}

/** Support take-up precedes lifting; heavy supported loads get an anticipatory knee dip. */
function* lifting(person: Reacher, request: Request, thing: Thing) {
  if (carriedBy(person, thing)) return;
  const f = person.frame;
  if (!thing.massive) f.dev?.append(f.time, { check: 'lifted a thing without userData.mass (kg)', value: 0, limit: 0, where: thing.object.name });
  // Tuned APA: 100 ms / 5 mm before support leaves; a low reach already prepares the knees.
  const hips = floorUnder(person) + person.proportions.hipHeight;
  if (supported(thing) && thing.mass > PREPARED && (thing.object.getWorldPosition(_v).y >= hips || hips - person.pose.position(0).y < 0.005 * person.scale)) {
    let since = NaN;
    yield* during(request, 'trunk', 'borrowed', () => person.poise.add({ lower: 0.005 * person.scale }),
      (frame) => (Number.isNaN(since) ? (since = frame.time, false) : frame.time - since >= 0.1 - 1e-9));
  }
  lift(person, thing);
}

/** a loose thing with a mass, held, lifted clear of what it rests on (`CLEAR`), then held as it is */
export function* liftingClear(person: Reacher, request: Request, thing: Thing) {
  const resting = supported(thing);
  yield* lifting(person, request, thing);
  const carrier = person.track(thing.object);
  // (first up off what it rests on, then drawn in toward the hips to within `CLEAR.out` of them: held at arm's length, the arms would
  // fall short of it once the reach no longer bows the body for them)
  const quaternion = carrier.current.quaternion.clone(), up = carrier.current.position.clone(), root = person.pose.position(0);
  // A bulky load must rise into reach as it comes clear of the trunk, rather than drawing in below that reachable height.
  up.y = Math.max(up.y + CLEAR.height * person.scale, floorUnder(person) + person.proportions.hipHeight + inReach(person, thing, true));
  const out = Math.hypot(up.x - root.x, up.z - root.z), most = CLEAR.out * person.proportions.armLength;
  const clear = out > most ? new Vector3(root.x + (up.x - root.x) * most / out, up.y, root.z + (up.z - root.z) * most / out) : up;
  const way: Waypoint[] = [[CLEAR.seconds / person.tempo, { position: up, quaternion }]];
  if (out > most) way.push([(out - most) / ALONG.speed / person.tempo, { position: clear, quaternion }]);
  // (in one hand, its grasp planned for where it comes clear)
  const grasp = grasping(person, thing, () => ({ position: clear, quaternion }));
  yield* travel(person, request, thing, way, aimsFor(person, thing, CARRYING, true), resting, { near: CLEAR.near * person.scale, grasp });
}

/**
 * Follow a course with load compliance only on support take-up, until the thing rests within `near` of its course's end; report a late
 * settling endpoint. The `end` of a carry fails it instead of waiting on: once late, or once at rest where the body's own trunk and head
 * hold it off its end (a carry ends true only with the thing in place). Its request's eta is `eta` of the course's time left (s; default
 * that time): what the carry does besides the course counted in.
 */
function* travel(person: Reacher, request: Request, thing: Thing, waypoints: readonly Waypoint[], makeAim: Aim, resting: boolean,
  { near = END.distance, on, end = false, eta = (left) => left, grasp }: { near?: number; on?: (f: Frame) => Goal; end?: boolean; eta?: (left: number) => number; grasp?: Grasping } = {}) {
  const carrier = person.track(thing.object);
  const grips = Object.fromEntries(Object.entries(person.holding).flatMap(([side, hold]) => hold?.thing === thing ? [[sideOf(side), hold.grip]] : []));
  const lag = grips[LEADING] === undefined && person.holding[LEADING] ? following(carrier.current.position, grips) : { delay: 0, slower: 0 };
  const factor = loadFactor(thing.mass);
  const aim = makeAim(factor);
  const from = carrier.current.position.y;
  // (take-up and compliance belong to lifting off a support, not every carried waypoint; mass slows the lift's acceleration and path)
  const load = resting ? factor - 1 : 0;
  const pace = (1 - lag.slower) / factor, path = course(carrier, waypoints, { pace, delay: lag.delay, on });
  const total = waypoints.reduce((sum, [seconds]) => sum + seconds / pace, 0);
  let began = NaN, since = NaN, stood = NaN, late = false, blocked = false, dip = 0;
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
    if (!path.over(f)) return false;
    if (Number.isNaN(since)) since = f.time;
    if (grasp && f.time - since > SETTLING) grasp.settling(f);
    // (its lateness timed from when the body stands where it carries it from: not while it still walks there)
    if (Number.isNaN(stood) && !person.locomotion.moving) stood = f.time;
    aim.read(f, to);
    const goal = aim.goal.position;
    // Load compliance: https://pmc.ncbi.nlm.nih.gov/articles/PMC4443842/ (F = k × displacement).
    // Tuned, not measured: an upward carry dips 2.7 cm over 0.8 s at 8 kg, then recovers.
    dip = 0.08 * load * Math.min(1, Math.max(0, goal.y - from) / 0.1);
    if (rested(f, carrier, goal) && (dip === 0 || f.time - since >= seconds)) {
      if (!end || aim.off <= near) return true;
      // (at rest where its own body holds it, short of its end: the body stands in its way, and no further waiting brings it there)
      if (!blocked) {
        blocked = true;
        f.dev?.append(f.time, { check: 'carry: held clear of its own body, off its end (m)', value: aim.off, limit: near, where: thing.object.name, detail: inTheWay(aim) });
        request.fail();
      }
      return false;
    }
    if (!late && f.time - stood > RESTING) {
      late = true;
      const off = carrier.current.position.distanceTo(goal);
      f.dev?.append(f.time, { check: `late carry: course end distance after ${RESTING} s (m)`, value: off, limit: near, where: thing.object.name,
        detail: `stopped ${cm(off)} cm off it: ${aim.off > near ? inTheWay(aim) : limits(person, thing, aim)}` });
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

/** each hold's arm as a carry moves it: one through all the carry's stages and its keeping after (a new one at each stage, its brakes
 * and its fit taken afresh, threw the arm off the way it went — a belt's tongue held at its end drifted 7 mm off it as the carry ended) */
const tips = new WeakMap<Hold, ChainTip>();
function tipOf(hold: Hold, hand: string): ChainTip {
  let tip = tips.get(hold);
  if (!tip) tips.set(hold, (tip = new ChainTip(`${hand}Arm`)));
  return tip;
}

/** Keep each held grip on its own arm; a released or replaced hold stops participating. */
function holding(person: Reacher, request: Request, thing: Thing, aim: CarryAim, to: Live<Goal>, until?: (f: Frame) => boolean, keep = false) {
  const hands = Object.entries(person.holding).flatMap(([hand, hold]) => hold?.thing === thing
    ? [{ side: sideOf(hand), hold, tip: tipOf(hold, hand) }] : []);
  // (in one hand, it hangs from the hand as the hand grasps it: the hand goes where the thing is to go, turned with it)
  const single = hands.length === 1 ? grasped(person, hands[0].side, thing) : null;
  const step = ({ side, tip }: (typeof hands)[number]) => (f: Frame) => {
    const carrier = aim.read(f, to), hold = person.holding[side], carried = carrier.carriedBy === person;
    if (!hold || hold.thing !== thing) return;
    if (single) {
      const goal = single(f, carrier);
      bringShoulder(person, f, side, goal.position, 1, 0, carried);
      handStep(person, f, side, goal, { ...HOLD, lead: true }, tip);
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

type Aim = (factor?: number, clearance?: Clearance) => CarryAim;

function aimsFor(person: Reacher, thing: Thing, motion: Motion, clear: Clearance): Aim {
  return (factor = 1, clearance = clear) => new CarryAim(person, thing, { ...motion, accel: motion.accel / factor }, clearance);
}

/** One load path: clear its course before following it, and judge the same endpoint. */
class CarryAim {
  readonly goal = { position: new Vector3(), quaternion: new Quaternion() };
  private readonly carrier: Carrier;
  private readonly nominal: Carrier;
  private readonly position = new TrackedPoint();
  private readonly rotation = new TrackedRotation();
  private readonly at = new Vector3();
  private readonly turned = new Quaternion();
  private time = NaN;
  /** whether a goal moved clear of the head has been noted */
  private cleared = false;
  /** how far (m) the body's own trunk and head held the last goal read off where it was asked to go: none for a goal on its own head
   * (a cup put to the mouth stops in front of it by design), else the body stands in the way of its end */
  off = 0;
  /** whether it has set out, and how much of the push clear of the body it set out with it has not yet taken up, the two sub-steps before */
  private setOut = false;
  private readonly unpushed = [new Vector3(), new Vector3()];

  /** the middle of the grips both its hands hold it by, where the palms close on it (its frame; held in one, its origin) */
  private readonly pivot = new Vector3();

  constructor(private readonly person: Reacher, private readonly thing: Thing, private readonly motion: Motion, private readonly clear: Clearance) {
    const own = person.track(thing.object);
    const grips = Object.values(person.holding).flatMap((hold) => hold?.thing === thing ? [thing.grip(hold.grip).at.position] : []);
    // (held in both hands; one hand's thing goes where its course has it, the hand with it)
    if (grips.length > 1) for (const grip of grips) this.pivot.addScaledVector(grip, 1 / grips.length);
    this.nominal = new Carrier(own.current.position, own.current.quaternion);
    this.carrier = new Carrier(own.current.position, own.current.quaternion);
    this.nominal.prev.position.copy(own.prev.position);
    this.nominal.prev.quaternion.copy(own.prev.quaternion);
  }

  read(f: Frame, to: Live<Goal>): Carrier {
    if (this.time === f.time) return this.carrier;
    this.time = f.time;
    const { nominal: aim, goal, person, thing, motion } = this;
    // (its track read where it stands as the sub-step begins, before the hands move it: what tells when it has come to rest)
    person.track(thing.object);
    // (kept clear as it is turned on its way, not as its hand has it: the hand short of the turn its grasp asks, a lance tilted 0.1 rad
    // by it reached 0.7 m further back, the aim was pushed on ahead, the arm stretched after it and the lance tilted further)
    const current = aim.current;
    const target: Goal = typeof to === 'function' ? to(f) : to;
    this.carrier.carriedBy = target.carriedBy;
    goal.position.copy(target.position);
    // (a goal that sets no turn keeps the one the aim set out with: the thing's own turn, a hand's lag in it, is not fed back)
    goal.quaternion.copy(target.quaternion ?? this.nominal.current.quaternion);
    // Continue the intended motion, rather than feeding wrist-fitting lag back into it.
    const turned = this.rotation.follow(aim.prev.quaternion, aim.current.quaternion, goal.quaternion,
      { accel: motion.turnAccel ?? CARRYING.turnAccel, speed: motion.turnSpeed }, f.dt, this.turned);
    // (a goal in the neck or head — a cup put to the mouth — is carried clear of them in front: noted once, so it is no silent change)
    const moved = this.clear ? clearBody(person, f, thing, goal.position, turned, current, this.clear !== 'head', this.clear === 'parts') : 0;
    this.off = this.clear === 'head' ? 0 : goal.position.distanceTo(target.position);
    if (moved > CLEARED * person.scale && !this.cleared && f.dev) {
      this.cleared = true;
      f.dev.note(f.time, { check: 'held goal moved clear of the head (m)', value: moved, limit: CLEARED * person.scale, where: thing.object.name });
    }
    // (followed about the middle of its grips, where the hands are: turning, a thing held off its middle lags about them, not about its
    // own origin, and does not swing off them)
    const pivot = this.pivot, held = (at: Placement, turn: Quaternion, out: Vector3) => out.copy(pivot).applyQuaternion(turn).add(at.position);
    this.position.follow(held(aim.prev, aim.prev.quaternion, _p1), held(aim.current, aim.current.quaternion, _p2), held(goal, goal.quaternion, _p3), motion, f.dt, this.at);
    this.at.sub(_p1.copy(pivot).applyQuaternion(turned));
    // Constraint correction is not velocity to feed back into the intended path.
    aim.move(f.time, this.at, turned);
    const aimed = _aimed.copy(this.at);
    if (this.clear) clearBody(person, f, thing, this.at, turned, current, this.clear !== 'head', this.clear === 'parts');
    // (a thing set out from against the body — taken there — is drawn off it at the aim's own pace, not snapped clear: the push it set
    // out with is let go of from there to none)
    const [prev2, prev] = this.unpushed;
    if (!this.setOut) {
      this.setOut = true;
      prev.copy(prev2.subVectors(this.at, aimed));
    }
    const left = follow(prev2, prev, ZERO, motion, f.dt, _left);
    prev2.copy(prev);
    prev.copy(left);
    this.carrier.move(f.time, this.at.sub(left), turned);
    return this.carrier;
  }
}

/** A comfortable carry in front of the hips, following the body: where a transfer carries its load, turned `turn` from the body's facing. */
function carried(person: Reacher, turn: Readonly<Quaternion>): (f: Frame) => Placement & { velocity: Vector3 } {
  // Recalled load law: shorten the lever arm with squared pace effort (35 → 19 cm at 8 kg).
  const at = movingPoint(person, 0, () => ({ position: new Vector3(0, 0, CARRY_AHEAD / loadFactor(heldMass(person)) ** 2), quaternion: turn.clone() }),
    () => new Quaternion().setFromAxisAngle(UP, person.locomotion.facing));
  return (f: Frame) => {
    const goal = at(f);
    // (a lift rises out of its squat: its height follows the floor under the feet, not the lowered pelvis)
    // (its grips at the carry's height: a bucket by its handle hangs below the hand, not raised on it to the shoulder)
    const hold = person.holding.left ?? person.holding.right, thing = hold?.thing;
    const grips = thing ? handsOn(person, thing).flatMap((hand) => {
      const held = person.holding[hand];
      return held ? [thing.grip(held.grip).at.position.y] : [];
    }) : [];
    const gripsAt = grips.length ? grips.reduce((sum, y) => sum + y, 0) / grips.length : 0;
    const above = Math.max(CARRY_HEIGHT * person.scale - gripsAt, thing ? inReach(person, thing) : -Infinity);
    goal.position.y = floorUnder(person) + person.proportions.hipHeight + above;
    goal.velocity.y = 0;
    return { position: goal.position, quaternion: goal.quaternion, velocity: goal.velocity };
  };
}

/** Minimum carry height that puts every held grip in reach without intersecting the trunk. */
function inReach(person: Reacher, thing: Thing, wideOnly = false): number {
  const proportions = person.proportions, o = proportions.offsets, reach = ARM_REACH * proportions.armLength + PROTRACTION * proportions.height;
  const ahead = BODY_RADIUS * proportions.height + LOAD_RESERVE * person.scale - thing.bounds.min.z;
  return Math.max(-Infinity, ...SIDES.map((side) => {
    const hold = person.holding[side];
    if (hold?.thing !== thing) return -Infinity;
    const grip = hold.goal.position;
    const shoulder = o[`${side}Shoulder`].clone().add(o[`${side}UpperArm`]);
    const across = Math.hypot(grip.x - shoulder.x, ahead + grip.z - o.spine.z - o.chest.z - shoulder.z);
    if (wideOnly && across < ARM_REACH * proportions.armLength) return -Infinity;
    return proportions.shoulderHeight - proportions.hipHeight - Math.sqrt(Math.max(0, reach ** 2 - across ** 2)) - grip.y;
  }));
}

/** Tuned carry staging (m at default stature): how far ahead of the hips a load is carried, clear of the thighs with room for two hands,
 * and how far above standing hip height, independent of the pelvis's squat */
const CARRY_AHEAD = 0.35, CARRY_HEIGHT = 0.12;
const UP = new Vector3(0, 1, 0), IDENTITY = new Quaternion(), ZERO = new Vector3(), _placed = { position: new Vector3(), quaternion: new Quaternion() }, _v = new Vector3(), _g = new Vector3(), _aimed = new Vector3(), _left = new Vector3();
const [_p1, _p2, _p3] = [new Vector3(), new Vector3(), new Vector3()];
