import { Box3, Matrix4, Ray, Quaternion, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import type { Frame } from '../../kernel/frame';
import { REACHED, REACHING, type Goal } from '../../kernel/goal';
import { lerp, pointSegmentDistance } from '../../kernel/math';
import { seeded, seedOf } from '../../kernel/random';
import { lateReach, Progress, reached, unmet } from '../../kernel/tip';
import { during, type Request } from '../../kernel/requests';
import { grasp, held, onBody, worn } from '../../things/hold';
import type { Hold } from '../../things/resolve';
import { PointVelocity } from '../../kernel/track';
import { CALM, HOLD, reaching } from './arms';
import { armReaches, footing, walking } from './stand';
import { noticing } from '../../look/gaze';
import { INDEX, SIDES, type Side } from '../../species/humanoid/bones';
import type { Reacher } from './reacher';
import { paceOf, type Manner } from '../handling';
import { BODY_RADIUS, LOAD_RESERVE } from './clearance';

/** An outside guide beyond the arm's reach is followed this long after its planned arrival before closing on the exact grip. */
const STAGING = 0.4;

/** A hand's hold to take: the hand, and the hold it takes. */
export interface Taking extends Hold {
  side: Side;
}

/** where a grip is in the world this sub-step, as the person tracks its thing */
export function gripAt(person: Reacher, take: Pick<Taking, 'thing' | 'goal'>, f: Frame, out = new Vector3()): Vector3 {
  const frame = person.track(take.thing.object).at(f.time).current;
  return out.copy(take.goal.position).applyQuaternion(frame.quaternion).add(frame.position);
}

/** Hands close together after reaching every grip; route staging is separate from final closure. */
export function* reachFor(person: Reacher, request: Request, takes: readonly Taking[], motion?: { speed: number; accel?: number }) {
  const began = person.frame.time;
  const there = (f: Frame) => takes.every((take) => reached(f, person.hands[take.side], take.goal, person.track(take.thing.object)));
  const close = () => takes.forEach((take) => grasp(person, take.side, { thing: take.thing, grip: take.grip, goal: take.goal }));
  if (there(person.frame)) return close();
  let late = false, ends = Infinity;
  const progress = takes.map(() => new Progress());
  // (past its planned end, a hand off its grip that has stopped there fails the reach at once; one still moving, `REACHING` s on. The
  // legs stepping under it, it is watched afresh after)
  const stopped = (f: Frame) => takes.some((take, k) => {
    if (!person.locomotion.settled) progress[k].reset();
    const off = unmet(f, person.hands[take.side], take.goal, person.track(take.thing.object));
    return (off.distance > REACHED.distance || off.angle > REACHED.angle) && progress[k].stopped(f, person.hands[take.side], off.at);
  });
  const until = (ready: (f: Frame) => boolean) => (f: Frame) => {
    request.eta = Math.max(0, ends - f.time);
    if (ready(f)) return true;
    if (!late && f.time > ends && (stopped(f) || f.time > ends + REACHING)) {
      late = true;
      for (const take of takes) {
        if (lateReach(f, person.hands[take.side], take.goal, `${take.thing.object.name} ${take.side} ${take.grip}`, person.track(take.thing.object), limitOf(person, take.side))) request.fail();
      }
    }
    return false;
  };
  const plan = takes.map((take) => {
    const frame = person.track(take.thing.object).current, seed = frame.position;
    const from = person.pose.position(person.hands[take.side]).clone().sub(frame.position).applyQuaternion(frame.quaternion.clone().invert());
    // (what the body wears or holds moves with it, held clear of it: the hand goes to its grip directly; and a corner behind the hips as
    // the body stands now, the way on from which passes them within twice the trunk's radius, is no way round it — tuned: a hand starting
    // back at the side of a body still turning to the thing would come forward through the trunk)
    const hips = person.pose.position(0), toward = _toward.subVectors(frame.position, hips).setY(0), trunk = 2 * BODY_RADIUS * person.proportions.height;
    const world = (point: Vector3) => point.clone().applyQuaternion(frame.quaternion).add(frame.position);
    const through = (corner: Vector3, next: Vector3) => world(corner).sub(hips).dot(toward) < 0 && pointSegmentDistance(hips, world(corner), world(next)) < trunk;
    const detour = onBody(person, take.thing) ? [] : aroundHeld(person, take.side, world(from), world(take.goal.position))
      .map((point) => point.sub(frame.position).applyQuaternion(frame.quaternion.clone().invert()));
    // The wrist path leaves room for the whole palm as its orientation changes during the reach.
    const reserve = LOAD_RESERVE * person.scale + (0.08 + 0.013) * person.proportions.height;
    const route = [...detour, ...(onBody(person, take.thing) ? []
      : outside(take.thing.bounds, take.goal.position, detour.at(-1) ?? from, reserve))]
      .filter((point, k, all) => k === all.length - 1 || !through(point, all[k + 1]));
    const points = route.length ? route : [take.goal.position];
    let was = from;
    const lengths = points.map((point) => { const length = was.distanceTo(point); was = point; return length; });
    const distance = lengths.reduce((sum, length) => sum + length, 0);
    const at = gripAt(person, take, person.frame);
    const { delay, slower } = takes.length > 1 && take.side !== LEADING ? following(seed, { [take.side]: take.grip }) : { delay: 0, slower: 0 };
    const seconds = reachTime(distance / person.scale, seedOf(take.grip, Math.round(at.x * 1000), Math.round(at.z * 1000))) / (1 - slower) / person.tempo;
    return { ...take, points, lengths, distance, route, delay, seconds };
  });
  const finish = plan.find(({ side }) => side === LEADING)?.seconds ?? plan[0].seconds;
  const lasts = (hand: (typeof plan)[number]) => motion ? hand.distance / motion.speed + motion.speed / (motion.accel ?? CALM.accel) : Math.max(hand.delay, finish - hand.seconds) + hand.seconds;
  ends = began + Math.max(...plan.map(lasts));
  request.eta = ends - began;
  for (const take of takes) grasp(person, take.side, null);
  yield* parallel<Frame>('all', ...plan.map((hand) => function* () {
    for (const [i, position] of hand.points.entries()) {
      const began = person.frame.time;
      const seconds = hand.distance > 0 ? hand.seconds * hand.lengths[i] / hand.distance : hand.seconds;
      const after = i === 0 ? Math.max(hand.delay, finish - hand.seconds) : 0;
      ends = Math.max(ends, began + seconds + after);
      // (on the way round, already turning as it will hold it)
      const goal = hand.route.length ? { ...hand.goal, position } : hand.goal;
      const ready = hand.route.length
        ? until((f) => i < hand.points.length - 1 ? f.time >= began + seconds + after
          : reached(f, person.hands[hand.side], { position }, person.track(hand.thing.object)) || f.time >= began + seconds + after + STAGING)
        : until(there);
      const on = person.track(hand.thing.object);
      const pace = motion ? { accel: motion.accel ?? CALM.accel, speed: motion.speed } : { seconds, after };
      yield* during(request, `hand.${hand.side}`, 'asked', reaching(person, hand.side, goal, { on, thing: hand.thing, lead: !worn(hand.thing), ...pace }), ready);
    }
  }));
  // (both hands reach the outside staging points before closing on the actual grips)
  if (plan.some(({ route }) => route.length)) {
    yield* parallel<Frame>('all', ...plan.map((hand) => during(request, `hand.${hand.side}`, 'asked',
      reaching(person, hand.side, hand.goal, { on: person.track(hand.thing.object), thing: hand.thing, lead: !worn(hand.thing) }), until(there))));
  }
  close();
}

/** Put a reaching hand on its own side of a held obstacle before it closes on an external grip. */
function aroundHeld(person: Reacher, side: Side, from: Vector3, target: Vector3): Vector3[] {
  const root = person.pose.position(0), turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), person.locomotion.facing);
  const back = turn.clone().invert(), start = from.clone().sub(root).applyQuaternion(back), end = target.clone().sub(root).applyQuaternion(back);
  const direction = end.clone().sub(start), length = direction.length(), ray = new Ray(start, direction.normalize());
  for (const thing of held(person)) {
    if (person.holding[side]?.thing === thing) continue;
    const frame = person.track(thing.object).current;
    const position = frame.position.clone().sub(root).applyQuaternion(back), rotation = back.clone().multiply(frame.quaternion);
    const box = thing.bounds.clone().applyMatrix4(new Matrix4().compose(position, rotation, new Vector3(1, 1, 1)))
      .expandByScalar(LOAD_RESERVE * person.scale + (0.08 + 0.013) * person.proportions.height);
    const hit = ray.intersectBox(box, new Vector3());
    if (!hit || hit.distanceTo(start) > length) continue;
    const edge = side === 'left' ? box.max.x : box.min.x;
    return [start.clone().setX(edge), end.clone().setX(edge)].map((point) => point.applyQuaternion(turn).add(root));
  }
  return [];
}

/** Route around the envelope to its nearest grip face; the final closure is separate. */
function outside(bounds: Box3, grip: Vector3, from: Vector3, reserve: number): Vector3[] {
  const size = bounds.getSize(new Vector3());
  if (size.x * size.y * size.z === 0) return [];
  const box = bounds.clone().expandByScalar(reserve);
  let axis = 0, end = 0, gap = Infinity;
  for (let i = 0; i < 3; i++) for (const side of [0, 1]) {
    const distance = Math.abs(grip.getComponent(i) - (side ? bounds.max : bounds.min).getComponent(i));
    if (distance < gap) [gap, axis, end] = [distance, i, side];
  }
  const sign = end ? 1 : -1;
  const edge = (end ? box.max : box.min).getComponent(axis);
  const outer = grip.clone().setComponent(axis, sign > 0 ? Math.max(grip.getComponent(axis), edge) : Math.min(grip.getComponent(axis), edge));
  // Keep the same reserve toward the starting height, rather than lowering to grip height before closure; the outside wrist still has
  // to settle within REACHED.
  if (axis !== 1) outer.y = grip.y + Math.max(-reserve, Math.min(reserve, from.y - grip.y));
  const corner = from.clone().setComponent(axis, outer.getComponent(axis));
  // A corner already reached must not restart the arm on a near-zero-duration glide.
  return from.distanceTo(corner) <= REACHED.distance ? [outer] : [corner, outer];
}

/**
 * how long a calm reach `distance` away to take something takes (s; m, default body): Fitts' law, MT = a + b · log2(2 D / W) (recalled,
 * not checked: a ~0.25 s, b ~0.15 s/bit at everyday precision, a grip ~4 cm wide), varied ±10% (seeded by `seed`) — a 50 cm reach ~0.95
 * s peaking ~1 m/s, a 10 cm one ~0.6 s
 */
function reachTime(distance: number, seed: number): number {
  const bits = Math.log2(Math.max(1, (2 * distance) / FITTS.width));
  return (FITTS.a + FITTS.b * bits) * (1 + FITTS.vary * (2 * seeded(seed)() - 1));
}

const FITTS = { a: 0.25, b: 0.15, width: 0.04, vary: 0.1 };

/** the hand that leads where both work (a right-handed body): the other goes a moment after it, a little slower */
export const LEADING: Side = 'right';
/** how much later (s) and slower (share of its pace) the other hand goes: not the leading hand's mirror image. (Hands reaching together
 * start within a few tens of ms of each other — Kelso, Southard & Goodman 1979, recalled, not checked; this is a little more, so the two
 * read apart.) */
const FOLLOWING = { delay: [0.06, 0.12], slower: [0.05, 0.1] };

/** how much later and slower the other hand goes for a thing `at` a place by its grips (seeded by them and where it is: the same each run) */
export function following(at: Readonly<Vector3>, grips: Partial<Record<Side, string>>) {
  const rand = seeded(seedOf(...SIDES.map((s) => grips[s] ?? ''), Math.round(at.x * 1000), Math.round(at.y * 1000), Math.round(at.z * 1000)));
  return { delay: lerp(FOLLOWING.delay[0], FOLLOWING.delay[1], rand()), slower: lerp(FOLLOWING.slower[0], FOLLOWING.slower[1], rand()) };
}

/** Follow targets with borrowed walking; replan after movement while keeping each hand's motion history. */
export function* reachingTo(person: Reacher, request: Request, aims: readonly { side: Side; target: (f: Frame) => Goal }[], pace: Manner) {
  const motion = paceOf(pace, CALM);
  aims = aims.map(({ side, target }) => {
    const sample = new PointVelocity();
    let velocity = new Vector3();
    let time = NaN;
    return { side, target: (f: Frame) => {
      const goal = target(f);
      if (time !== f.time) {
        velocity = sample.read(goal.position, f.time - time, motion.speed);
        time = f.time;
      }
      return { ...goal, velocity: goal.velocity ?? velocity };
    } };
  });
  const middle = (f: Frame) => aims.reduce((sum, { target }) => sum.add(target(f).position), _middle.set(0, 0, 0)).divideScalar(aims.length);
  const there = (f: Frame) => aims.every(({ side, target }) => reached(f, person.hands[side], target(f)));
  const going = aims.map(({ side, target }) => {
    const distance = person.pose.position(person.hands[side]).distanceTo(target(person.frame).position);
    const { speed } = pace, { accel } = motion;
    // (at an explicit hand speed, its joints keep to the moving point as briskly as to a held grip)
    if (speed !== undefined) return { side, step: reaching(person, side, target, { ...HOLD, accel, speed }), lasts: distance / speed + speed / accel };
    const seconds = reachTime(distance / person.scale, seedOf(side, Math.round(distance * 1000))) / person.tempo;
    return { side, step: reaching(person, side, target, { seconds }), lasts: seconds };
  });
  const lasts = Math.max(...going.map((hand) => hand.lasts));
  let setOff = NaN, late = false;
  const progress = aims.map(() => new Progress());
  const stopped = (f: Frame) => aims.some(({ side, target }, k) => {
    const off = unmet(f, person.hands[side], target(f));
    return (off.distance > REACHED.distance || off.angle > REACHED.angle) && progress[k].stopped(f, person.hands[side], off.at);
  });
  const eta = (f: Frame) => {
    // Balance can interrupt the final reach with a support step; its time is not time spent failing to reach.
    if (!person.locomotion.settled) {
      setOff += f.dt;
      progress.forEach((hand) => hand.reset());
    }
    request.eta = Math.max(0, setOff + lasts - f.time);
    // (past its planned end, a hand off its target that has stopped there fails the reach at once; one still moving, `REACHING` s on)
    if (late || f.time <= setOff + lasts || !(stopped(f) || f.time > setOff + lasts + REACHING)) return;
    late = true;
    for (const { side, target } of aims) if (lateReach(f, person.hands[side], target(f), side, undefined, limitOf(person, side))) request.fail();
  };
  yield* parallel<Frame>('all', function* () {
    for (;;) {
      const planned = aims.map(({ target }) => target(person.frame).position.clone());
      const moved = (f: Frame) => aims.some(({ target }, i) => target(f).position.distanceTo(planned[i]) > MOVED * person.scale);
      const inReach = aims.every(({ side }, i) => armReaches(person, planned[i], side, true));
      const held = aims.map(({ side }, i) => ({ side, at: planned[i].clone().sub(middle(person.frame)) }));
      const plan = inReach ? 'there' : footing(person, { place: (f) => ({ position: middle(f).clone(), quaternion: _turn }), held }, pace.step ?? true);
      let stalled = plan === 'nowhere', arrived = false;
      const setsOff = (f: Frame) => {
        if (Number.isNaN(setOff) && (plan === 'there' || (plan !== 'nowhere' && plan.walk.eta <= NEAR))) setOff = f.time;
        return !Number.isNaN(setOff);
      };
      if (plan !== 'nowhere') yield* parallel<Frame>('race', noticing(person, request, middle), function* () {
        yield* parallel<Frame>('all', action<Frame>({ until: setsOff }), function* () {
          if (plan === 'there') return;
          yield* parallel<Frame>('race', function* () {
            stalled = !(yield* walking(request, plan, Math.max(0, lasts - NEAR)));
          }, action<Frame>({ until: moved }));
        });
        if (!stalled) yield* action<Frame>({ update: eta, until: (f) => moved(f) || (arrived = there(f)) });
      });
      if (stalled) request.fail();
      if (arrived) request.met();
      if (stalled || arrived) yield* action<Frame>({ until: moved });
    }
  }, function* () {
    yield* action<Frame>({ until: () => !Number.isNaN(setOff) });
    yield* parallel<Frame>('all', ...going.map(({ side, step }) => during(request, `hand.${side}`, 'asked', step)));
  });
}

/**
 * what held hand `side` off a point `at` (world) it reached for, as the body stands: further than the arm held out straight from the
 * shoulder, or nearer the trunk than the arm is kept clear of it; else something within reach (a joint's range, the other hand, the
 * body's balance)
 */
export function limitOf(person: Reacher, side: Side): (at: Vector3) => string {
  return (at) => {
    const pose = person.pose, arm = person.proportions.armLength, shoulder = pose.position(INDEX[`${side}UpperArm`]).distanceTo(at);
    if (shoulder > STRAIGHT * arm) return `beyond the arm’s reach: the shoulder ${shoulder.toFixed(2)} m from it, the arm ${arm.toFixed(2)} m`;
    const hips = pose.position(0), chest = pose.position(INDEX.chest), clear = BODY_RADIUS * person.proportions.height;
    const trunk = pointSegmentDistance(at, hips, chest);
    if (trunk < 2 * clear) return `trunk clearance: it is ${trunk.toFixed(2)} m from the trunk’s axis, the arm kept ${clear.toFixed(2)} m clear of it`;
    return 'within reach: held off by a joint’s range, the other hand or the body’s balance';
  };
}

/** how far out a hand reaches from the shoulder, its arm straight (× the arm's length) */
const STRAIGHT = 0.98;

/** Artistic calibration: 0.6 s overlaps hand preparation with arrival without starting the reach a full stride away. */
const NEAR = 0.6;
/** Tuned: a target moved this far (m, default body) from where it was planned for is planned for again */
const MOVED = 0.1;
const _middle = new Vector3(), _turn = new Quaternion(), _toward = new Vector3();
