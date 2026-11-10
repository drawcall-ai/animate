import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import type { Frame } from '../../kernel/frame';
import { movingPoint, type Placement, type Goal } from '../../kernel/goal';
import { leftOf } from '../../kernel/math';
import { loadFactor } from '../../kernel/load';
import { type Waypoint } from '../../kernel/timed-path';
import { noticing } from '../../look/gaze';
import { during, type Request } from '../../kernel/requests';
import { carriedBy, handsOn, heldMass, lift, supported, take } from '../../things/hold';
import type { Thing } from '../../things/thing';
import { paceAt, type HandOptions } from '../../body/hand-staging';
import type { CarryPath } from '../../things/carry-path';
import { floorUnder } from '../legs/height';
import { SIDES, sideOf } from '../anatomy/bones';
import { ARM_REACH, PROTRACTION } from './shoulder';
import { BODY_RADIUS, LOAD_RESERVE } from './load-clearance';
import { footing, walkingToReach, type ReachWalk } from './standing-spot';
import { CARRYING, Guide } from './guide';
import { closeOn, holdAlong, travel } from './travel';
import { regripping, type Regripping } from './grasp';
import type { Person } from '../person';

/** Tuned: a load heavier than this (kg) lifted off its support first gets the anticipatory knee dip (the APA below): a lighter one is just taken */
const PREPARED = 2;
/** Artistic calibration (s): a brief preparatory lift, a slower precise raise, begun early enough to overlap arrival. */
const LIFT = 0.5, RAISE = 1.3, RAISE_LEAD = 0.9;
/** Tuned: how far (rad) the body may still have to turn to its stand as a transfer's raise begins */
const RAISE_TURN = 0.5;
/** Tuned (a box shelved overhead, gear put on a horse): a transfer's walk sets off once the load has risen this share of its way to the body */
const APPROACH_RISE = 2 / 3;
/** a carry's pace along a way it goes straight to (m/s, its mean; unless told) and how long it takes at least (s), however quick */
const ALONG = { speed: 0.5, least: 0.4 };
/** how far a grab lifts a loose thing clear of what it rests on (m, default body), in how long (s), how far from the hips it draws it in to
 * at most (× the arm's length; tuned: in reach with the back bowed no more than holding asks), and how near it comes to rest (m: clear) */
const CLEAR = { height: 0.03, seconds: 0.4, out: 0.8, near: 0.015 };

/** Carry the route, one `Guide` from its first leg through the hold at its end. */
export function* carrying(person: Person, request: Request, thing: Thing, path: CarryPath, options: HandOptions) {
  // (each place on its way, as near as the thing came as it went there: one the arms cannot take it to is passed short, and that way may be
  // what kept it out of something)
  const passed = path.points.slice(0, -1).map(() => Infinity), passing = (point: (f: Frame) => Goal, k: number) => k === passed.length ? point : (f: Frame) => {
    const goal = point(f);
    passed[k] = Math.min(passed[k], person.movingFrameOf(thing.object).current.position.distanceTo(goal.position));
    return goal;
  };
  const way = { ...path, points: path.points.map(passing) };
  const sides = handsOn(person, thing).map(sideOf);
  const resting = supported(thing);
  yield* lifting(person, request, thing);
  const held = sides.map((side) => {
    const hold = person.holding[side];
    if (!hold) throw new Error(`carry: the ${side} hand let go`);
    hold.idle = undefined;
    // (stood to as by its grip empties, as a grab is: a palm's way back from each turns with the hand on the way there)
    return { side, hold, at: thing.grip(hold.grip).at.position };
  });
  // (stood back far enough that the thing, as it will be placed, keeps clear of the trunk)
  const placed = way.points[way.points.length - 1](person.frame);
  const things = [{ bounds: thing.bounds, position: placed.position.clone(), quaternion: (placed.quaternion ?? person.movingFrameOf(thing.object).current.quaternion).clone() }];
  const plan = way.own ? 'there' : footing(person, { place: way.points[way.points.length - 1], held, things }, options.step ?? true);
  if (plan !== 'there' && 'nowhere' in plan) return request.fail({ ...plan.nowhere, where: thing.object.name });
  const end = way.points[way.points.length - 1];
  // (in one hand, its grasp planned for its end as it comes there)
  const grasp = regripping(person, thing, end);
  // (the hands as brisk as the way is quick, in turning it as in moving it: `CARRYING` is a calm carry's, along its way at `ALONG.speed`)
  const brisk = paceAt(options.speed, { speed: ALONG.speed, accel: CARRYING.accel }).accel / CARRYING.accel;
  const guide = new Guide(person, thing, { ...CARRYING, accel: CARRYING.accel * brisk, turnAccel: CARRYING.turnAccel * brisk, turnSpeed: CARRYING.turnSpeed * Math.sqrt(brisk) }, way.clear);
  const moving = () => along(person, request, thing, way, guide, resting, grasp, options.speed);
  // (a spot before the chest stood behind the eyes of a body bowed over what it lifts, the head turned back over its shoulder for it: `noticing`'s `own`)
  if (plan === 'there') yield* parallel<Frame>('race', noticing(person, request, (f) => end(f).position, { own: !way.watched }), moving());
  else yield* transferring(person, request, thing, way, plan, guide, resting, grasp);
  passed.forEach((nearest, k) => {
    if (nearest > PASSED * person.scale) person.warn(`passed ${thing.object.name} ${way.names[k]}`, `a carry of "${thing.object.name}" came no nearer its ${way.names[k]} than ${(100 * nearest).toFixed(0)} cm, as far as the arms took it, and went on: if it must go that way, stand nearer first`);
  });
  request.met();
  noteCrossed(person, thing);
  const kept = guide.paced();
  // (at the end of a story's `until`: on the place it was asked to, not where a guide kept it clear of the body)
  request.there = () => {
    const goal = end(person.frame);
    return closeOn(person.movingFrameOf(thing.object).current, goal.position, goal.quaternion ?? kept.goal.quaternion);
  };
  yield* holdAlong(person, request, thing, kept, end, undefined, way.own);
}

/** how far short of a place on its way (m, default body) a carry may pass it unsaid */
const PASSED = 0.1;

/** how far (m, default body) a thing in both hands may end with the left hand to the right of the right before the dev log says so */
const CROSSED = 0.05;

/** said in a dev log: a thing in both hands ended with the arms crossed, as its target's turn had it */
function noteCrossed(person: Person, thing: Thing): void {
  const f = person.frame, { left, right } = person.holding;
  if (!f.dev || left?.thing !== thing || right?.thing !== thing) return;
  const crossed = _v.subVectors(f.prev.position(person.hands.right), f.prev.position(person.hands.left)).dot(leftOf(person.locomotion.facing));
  if (crossed > CROSSED * person.scale) f.dev.append(f.time, { check: 'arms crossed at the end of a carry (m)', value: crossed, limit: CROSSED * person.scale, where: thing.object.name });
}

/** the transfer of a load: lifted to the body, carried there as the legs walk (`plan`), raised onto its place over the last of the walk */
function* transferring(person: Person, request: Request, thing: Thing, way: CarryPath, plan: ReachWalk, guide: Guide, resting: boolean, grasp: Regripping) {
  const end = way.points[way.points.length - 1];
  const movingFrame = person.movingFrameOf(thing.object);
  const from = movingFrame.current.position.y, watched = movingFrame.current.position.clone();
  // (keeping the turn from the body's facing that it has now: a box taken by grips the other way round — a hand-over's — has its arms as they
  // are. Levelled if its +Y stands near up, a tray or cup a little tilted; a thing held otherwise is held so — a sword point down, a plank
  // lying — turning it upright for the walk would swing it through the arm's reach of it)
  const turn = movingFrame.current.quaternion.clone().premultiply(new Quaternion().setFromAxisAngle(UP, -person.locomotion.facing));
  const atBody = carried(person, _v.copy(UP).applyQuaternion(turn).y >= LEVELS ? turn.set(0, turn.y, 0, turn.w).normalize() : turn);
  const rise = atBody(person.frame).position.y - from;
  let lifted = rise <= 0, approached = false;
  // (raised onto its place as the body comes there turned as it stands: begun before it has turned, the load would turn to its place's
  // facing ahead of the body, its grips swung out of the hands' reach)
  // (a load's knees wait for the feet (`bringShoulder`): going low under one, it waits for them too)
  const lead = loadFactor(heldMass(person)) > 1 && end(person.frame).position.y < floorUnder(person) + person.proportions.hipHeight ? 0 : RAISE_LEAD;
  const near = () => plan.walk.arrival <= lead && plan.walk.unturned <= RAISE_TURN;
  const eyes = (f: Frame) => lifted ? end(f).position : watched;
  // (the time to its end, `lift` s of the lift still to go: the walk up to the raise, alongside the lift, then the raise — unknown, ∞,
  // before the walk has first stepped)
  const onward = (lift = 0) => Math.max(lift, plan.walk.arrival - RAISE_LEAD) + RAISE / loadFactor(thing.mass);
  const walked = (f: Frame) => {
    request.eta = onward();
    return atBody(f);
  };
  yield* parallel<Frame>('race', noticing(person, request, eyes), function* () {
    yield* parallel<Frame>('all', function* () {
      yield* action<Frame>({ until: () => lifted || movingFrame.current.position.y >= from + rise * APPROACH_RISE });
      // (setting off, the eyes leave where it was for where it goes: held on the empty spot, they would swing across behind the body)
      lifted = true;
      const stall = yield* walkingToReach(request, plan);
      if (stall) request.fail(stall);
      approached = true;
    }, function* () {
      // (its turn for the walk is the guide's, at a calm pace; the arm's joints no quicker: a turn past what the wrist holds has the arm change its
      // fit, every joint swinging at once, and at a held hand's pace their turns add up, what hangs from the hand flung at 2000°/s)
      yield* travel(person, request, thing, [[LIFT, atBody]], guide, resting, { eta: onward, walks: true, armTurn: CARRYING.turnSpeed });
      lifted = true;
      yield* holdAlong(person, request, thing, guide.paced(1, undefined, CARRYING.turnSpeed), walked, near);
      // (raised onto it, to come to rest on it once the body has come there, not merely passing within reach of it, or it is let go of past
      // it — or stalled short of it, or late: a carry ends what it cannot finish. The raise's own end: on it, the carry is there, not set
      // out again for it in a leg of its own while the body's last step takes it off)
      yield* travel(person, request, thing, way.points.map((point) => [RAISE / way.points.length, point]), guide, false, { grasp, walks: true, end: true, ready: () => approached });
    });
  });
}

/** carried straight along `way` (no walk): its points timed by their lengths at `speed`, the last straight at its own */
function* along(person: Person, request: Request, thing: Thing, way: CarryPath, guide: Guide, resting: boolean, grasp: Regripping, speed = ALONG.speed * person.tempo) {
  const least = ALONG.least;
  let points = way.points;
  if (way.outside > 0) {
    yield* travel(person, request, thing, timed(person, thing, points.slice(0, way.outside), speed, least),
      guide, resting, { clear: 'parts' });
    points = points.slice(way.outside);
    resting = false;
  }
  const straight = (way.last !== undefined || way.outside > 0) && points.length > 1;
  const first = straight ? points.slice(0, -1) : points;
  yield* travel(person, request, thing, timed(person, thing, first, speed, least), guide, resting, { end: !straight, grasp: straight ? undefined : grasp });
  if (straight) yield* travel(person, request, thing, timed(person, thing, points.slice(-1), way.last ?? speed, least), guide, false, { on: points[points.length - 2], end: true, grasp });
}

/** waypoints through `points` (from where the thing is now), each timed by its length at `speed` (m/s), the whole at least `least` s */
function timed(person: Person, thing: Thing, points: readonly ((f: Frame) => Goal)[], speed: number, least: number): Waypoint[] {
  const f = person.frame;
  let from = person.movingFrameOf(thing.object).current.position.clone();
  const lengths = points.map((point) => {
    const to = point(f).position, length = from.distanceTo(to);
    from = to.clone();
    return length;
  });
  const total = lengths.reduce((sum, length) => sum + length, 0), seconds = Math.max(least, total / speed);
  return points.map((point, k) => [total > 0 ? seconds * lengths[k] / total : seconds / points.length, point]);
}

/** Support take-up precedes lifting; heavy supported loads get an anticipatory knee dip. */
function* lifting(person: Person, request: Request, thing: Thing) {
  // (what hangs from one of the two hands on it goes into both as a carry starts: only that carry's guide then moves it)
  if (carriedBy(person, thing)) return take(person, thing);
  // Tuned APA: 100 ms / 5 mm before support leaves; a low reach already prepares the knees.
  const hips = floorUnder(person) + person.proportions.hipHeight;
  if (supported(thing) && thing.mass > PREPARED && (thing.object.getWorldPosition(_v).y >= hips || hips - person.pose.position(0).y < 0.005 * person.scale)) {
    let since = NaN;
    yield* during(request, 'trunk', 'borrowed', () => person.asks.add({ lower: 0.005 * person.scale }),
      (frame) => (Number.isNaN(since) ? (since = frame.time, false) : frame.time - since >= 0.1 - 1e-9));
  }
  lift(person, thing);
}

/** a loose thing with a mass, held, lifted clear of what it rests on (`CLEAR`), then held as it is */
export function* liftingClear(person: Person, request: Request, thing: Thing) {
  const resting = supported(thing);
  yield* lifting(person, request, thing);
  const movingFrame = person.movingFrameOf(thing.object);
  // (first up off what it rests on, then drawn in toward the hips to within `CLEAR.out` of them: held at arm's length, the arms would
  // fall short of it once the reach no longer bows the body for them)
  const quaternion = movingFrame.current.quaternion.clone(), up = movingFrame.current.position.clone(), root = person.pose.position(0);
  up.y += CLEAR.height * person.scale;
  const out = Math.hypot(up.x - root.x, up.z - root.z), most = CLEAR.out * person.proportions.armLength;
  const clear = out > most ? new Vector3(root.x + (up.x - root.x) * most / out, up.y, root.z + (up.z - root.z) * most / out) : up;
  const way: Waypoint[] = [[CLEAR.seconds / person.tempo, { position: up, quaternion }]];
  if (out > most) way.push([(out - most) / ALONG.speed / person.tempo, { position: clear, quaternion }]);
  // (in one hand, its grasp planned for where it comes clear)
  const grasp = regripping(person, thing, () => ({ position: clear, quaternion }));
  yield* travel(person, request, thing, way, new Guide(person, thing, CARRYING, true), resting, { near: CLEAR.near * person.scale, grasp });
}

/** A comfortable carry in front of the hips, following the body: where a transfer carries its load, turned `turn` from the body's facing. */
function carried(person: Person, turn: Readonly<Quaternion>): (f: Frame) => Placement & { velocity: Vector3 } {
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
    const above = Math.max(CARRY_HEIGHT * person.scale - gripsAt, thing ? inReach(person, thing, turn) : -Infinity);
    goal.position.y = floorUnder(person) + person.proportions.hipHeight + above;
    goal.velocity.y = 0;
    return { position: goal.position, quaternion: goal.quaternion, velocity: goal.velocity };
  };
}

/** Minimum carry height that puts every held grip in reach without intersecting the trunk, the thing turned `turn` from the body's facing. */
function inReach(person: Person, thing: Thing, turn: Readonly<Quaternion>): number {
  const proportions = person.proportions, o = proportions.offsets, reach = ARM_REACH * proportions.armLength + PROTRACTION * proportions.height;
  const ahead = BODY_RADIUS * proportions.height + LOAD_RESERVE * person.scale - _bounds.copy(thing.bounds).applyMatrix4(_turn.makeRotationFromQuaternion(turn)).min.z;
  return Math.max(-Infinity, ...SIDES.map((side) => {
    const hold = person.holding[side];
    if (hold?.thing !== thing) return -Infinity;
    const grip = _v.copy(hold.goal.position).applyQuaternion(turn);
    const shoulder = o[`${side}Shoulder`].clone().add(o[`${side}UpperArm`]);
    const across = Math.hypot(grip.x - shoulder.x, ahead + grip.z - o.spine.z - o.chest.z - shoulder.z);
    return proportions.shoulderHeight - proportions.hipHeight - Math.sqrt(Math.max(0, reach ** 2 - across ** 2)) - grip.y;
  }));
}

/** Tuned carry staging (m at default stature): how far ahead of the hips a load is carried, clear of the thighs with room for two hands,
 * and how far above standing hip height, independent of the pelvis's squat */
const CARRY_AHEAD = 0.35, CARRY_HEIGHT = 0.12;
/** Tuned: a walk levels what it carries if the cosine of the angle between the thing's own +Y and up is at least this (45°) */
const LEVELS = Math.SQRT1_2;
const UP = new Vector3(0, 1, 0), _v = new Vector3(), _bounds = new Box3(), _turn = new Matrix4();
