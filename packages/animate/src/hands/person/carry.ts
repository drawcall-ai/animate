import { Quaternion, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import type { Frame } from '../../kernel/frame';
import { movingPoint, type Placement, type Goal } from '../../kernel/goal';
import { loadFactor } from '../../kernel/load';
import { type Waypoint } from '../../kernel/course';
import { noticing } from '../../look/gaze';
import { during, type Request } from '../../kernel/requests';
import { carriedBy, handsOn, heldMass, lift, supported } from '../../things/hold';
import type { Thing } from '../../things/thing';
import type { Reacher } from './reacher';
import { paceAt, type HandOptions } from '../handling';
import type { Way } from '../route';
import { floorUnder } from '../../legs/person/legged';
import { SIDES, sideOf } from '../../species/humanoid/bones';
import { ARM_REACH, PROTRACTION } from './bend';
import { BODY_RADIUS, LOAD_RESERVE } from './clearance';
import { footing, walking, type WalkUp } from './stand';
import { guidesFor, CARRYING, type Guides } from './guide';
import { holdAlong, travel } from './travel';
import { regripping, type Regripping } from './grasp';

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

/** Carry the route, retaining a fresh guide at each travel/hold boundary. */
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
  // (stood back far enough that the thing, as it will be placed, keeps clear of the trunk)
  const placed = way.points[way.points.length - 1](person.frame);
  const things = [{ bounds: thing.bounds, position: placed.position.clone(), quaternion: (placed.quaternion ?? person.track(thing.object).current.quaternion).clone() }];
  const plan = way.own ? 'there' : footing(person, { place: way.points[way.points.length - 1], held, things }, options.step ?? true);
  if (plan === 'nowhere') {
    request.fail();
    return;
  }
  const end = way.points[way.points.length - 1];
  // (in one hand, its grasp planned for its end as it comes there)
  const grasp = regripping(person, thing, end);
  // (the hands as brisk as the way is quick, in turning it as in moving it: `CARRYING` is a calm carry's, along its way at `ALONG.speed`)
  const brisk = paceAt(options.speed, { speed: ALONG.speed, accel: CARRYING.accel }).accel / CARRYING.accel;
  const guides = guidesFor(person, thing, { ...CARRYING, accel: CARRYING.accel * brisk, turnAccel: CARRYING.turnAccel * brisk, turnSpeed: CARRYING.turnSpeed * Math.sqrt(brisk) }, way.clear);
  if (plan === 'there') yield* parallel<Frame>('race', noticing(person, request, (f) => end(f).position), along(person, request, thing, way, guides, resting, grasp, options.speed));
  else yield* transferring(person, request, thing, way, plan, guides, resting, grasp);
  request.met();
  yield* holdAlong(person, request, thing, guides(), end, undefined, way.own);
}

/** the transfer of a load: lifted to the body, carried there as the legs walk (`plan`), raised onto its place over the last of the walk */
function* transferring(person: Reacher, request: Request, thing: Thing, way: Way, plan: WalkUp, guides: Guides, resting: boolean, grasp: Regripping) {
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
      yield* travel(person, request, thing, [[LIFT, atBody]], guides, resting, { eta: onward, walks: true });
      lifted = true;
      yield* holdAlong(person, request, thing, guides(), walked, near);
      yield* travel(person, request, thing, way.points.map((point) => [RAISE / way.points.length, point]), guides, false, { grasp, walks: true });
      // (come to rest on it once the body has come there, not merely passing within reach of it, or it is let go of past it — or stalled
      // short of it, or late: a carry ends what it cannot finish)
      yield* travel(person, request, thing, [[0, end]], guides, false, { walks: true, end: true, ready: () => approached });
    });
  });
}

/** carried straight along `way` (no walk): its points timed by their lengths at `speed`, the last straight at its own */
function* along(person: Reacher, request: Request, thing: Thing, way: Way, guides: Guides, resting: boolean, grasp: Regripping, speed = ALONG.speed * person.tempo) {
  const least = ALONG.least;
  let points = way.points;
  if (way.outside > 0) {
    yield* travel(person, request, thing, timed(person, thing, points.slice(0, way.outside), speed, least),
      (factor) => guides(factor, 'parts'), resting);
    points = points.slice(way.outside);
    resting = false;
  }
  const straight = (way.last !== undefined || way.outside > 0) && points.length > 1;
  const first = straight ? points.slice(0, -1) : points;
  yield* travel(person, request, thing, timed(person, thing, first, speed, least), guides, resting, { end: !straight, grasp: straight ? undefined : grasp });
  if (straight) yield* travel(person, request, thing, timed(person, thing, points.slice(-1), way.last ?? speed, least), guides, false, { on: points[points.length - 2], end: true, grasp });
}

/** waypoints through `points` (from where the thing is now), each timed by its length at `speed` (m/s), the whole at least `least` s */
function timed(person: Reacher, thing: Thing, points: readonly ((f: Frame) => Goal)[], speed: number, least: number): Waypoint[] {
  const f = person.frame;
  let from = person.track(thing.object).current.position.clone();
  const lengths = points.map((point) => {
    const to = point(f).position, length = from.distanceTo(to);
    from = to.clone();
    return length;
  });
  const total = lengths.reduce((sum, length) => sum + length, 0), seconds = Math.max(least, total / speed);
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
  const grasp = regripping(person, thing, () => ({ position: clear, quaternion }));
  yield* travel(person, request, thing, way, guidesFor(person, thing, CARRYING, true), resting, { near: CLEAR.near * person.scale, grasp });
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
const UP = new Vector3(0, 1, 0), IDENTITY = new Quaternion(), _v = new Vector3();
