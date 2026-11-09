import { Box3, Matrix4, Ray, Quaternion, Vector3 } from 'three';
import { parallel, action } from '@pmndrs/timeline';
import type { Frame } from '../../kernel/frame';
import { REACHED, REACHING, type Goal } from '../../kernel/goal';
import { pointSegmentDistance } from '../../kernel/math';
import { seedOf } from '../../kernel/random';
import { reached } from '../../kernel/tip';
import { during, type Request } from '../../kernel/requests';
import { grasp, held, onBody, worn } from '../../things/hold';
import { fixes, gripAt, holdOn, type Taking } from './take';
import { padOff, pressingIn, runOf, TOUCH, touching } from './press';
import { reaching } from './arms';
import { INDEX, type Side } from '../../species/humanoid/bones';
import type { Reacher } from './reacher';
import type { Pace } from '../handling';
import { BODY_RADIUS, LOAD_RESERVE } from './clearance';
import { ARM } from './trunk';
import { following, lateWatch, LEADING, reachTime } from './reach';

// The hands' last reach onto the grips they take: each round what is in its way to the face nearest its grip (or, for a fingertip, in
// along its button's face), timed together, the leading hand first, then all closing on their grips at once.

/** An outside staging point beyond the arm’s reach is followed this long after its planned arrival before closing on the exact grip. */
const STAGING = 0.4;

/** Hands close together after reaching every grip; route staging is separate from final closure. */
export function* approach(person: Reacher, request: Request, takes: readonly Taking[], motion?: Pace) {
  // (a fingertip let go of first draws back off its button, not dragged across it to what it takes next)
  yield* action<Frame>({ until: (f) => takes.every((take) => f.time >= person.drawingBack[take.side]) });
  const began = person.frame.time;
  // (a fingertip must meet its grip where the hand is free to turn on it: its hold would keep what its reach left; one that fixes the hand makes up what the wrist can turn, on a thing not lifted, and what it cannot stays off, said in the dev log if the hand holds on till its turn is made up: a press let go sooner goes unread)
  const exact = ({ thing, grip }: Taking) => thing.grip(grip).point !== 'palm' && !fixes(thing.grip(grip));
  // (a fingertip is there as its pad meets its button, while the hand's turn still settles: a press is a touch, not a pose)
  const there = (f: Frame) => takes.every((take) => touching(person, take, f) || (!exact(take) && reached(f, person.hands[take.side], take.goal, person.track(take.thing.object))));
  const close = () => takes.forEach((take) => grasp(person, take.side, holdOn(person, take)));
  if (there(person.frame)) return close();
  let ends = Infinity;
  const late = lateWatch(person, request, takes.map((take) => ({
    side: take.side, goal: () => take.goal, on: () => person.track(take.thing.object), where: `${take.thing.object.name} ${take.side} ${take.grip}`,
  })));
  const until = (ready: (f: Frame) => boolean) => (f: Frame) => {
    request.eta = Math.max(0, ends - f.time);
    if (ready(f)) return true;
    late(f, ends);
    // (a wrist on its goal, its pad still off the grip: nothing `late` judges)
    const off = f.time > ends + REACHING ? takes.find((take) => exact(take) && !touching(person, take, f)) : undefined;
    if (off) {
      f.dev?.append(f.time, { check: 'late reach: a fingertip still off its grip (m)', value: padOff(person, off, f), limit: TOUCH * person.scale, where: `${off.thing.object.name} ${off.side} ${off.grip}` });
      request.fail();
    }
    return false;
  };
  const plan = takes.map((take) => {
    const frame = person.track(take.thing.object).current, seed = frame.position;
    const local = (point: Vector3) => point.clone().sub(frame.position).applyQuaternion(frame.quaternion.clone().invert());
    const from = local(person.pose.position(person.hands[take.side]));
    // (what the body wears or holds moves with it, held clear of it: the hand goes to its grip directly; and a corner behind the hips as
    // the body stands now, the way on from which passes them within twice the trunk's radius, is no way round it — tuned: a hand starting
    // back at the side of a body still turning to the thing would come forward through the trunk)
    const hips = person.pose.position(0), toward = _toward.subVectors(frame.position, hips).setY(0), trunk = 2 * BODY_RADIUS * person.proportions.height;
    const world = (point: Vector3) => point.clone().applyQuaternion(frame.quaternion).add(frame.position);
    const through = (corner: Vector3, next: Vector3) => world(corner).sub(hips).dot(toward) < 0 && pointSegmentDistance(hips, world(corner), world(next)) < trunk;
    const detour = onBody(person, take.thing) ? [] : aroundHeld(person, take.side, world(from), world(take.goal.position))
      .map((point) => point.sub(frame.position).applyQuaternion(frame.quaternion.clone().invert()));
    // (a fingertip comes to its button in one sweep ending in a run in along the face's normal (`pressingIn`), not round the thing's
    // bounds: its face is the side it comes from)
    const run = runOf(person, take);
    const route = run ? [] : [...detour, ...(onBody(person, take.thing) ? []
      : outside(take.thing.bounds, take.goal, detour.at(-1) ?? from, handOf(person, take.side, local(person.pose.position(INDEX[`${take.side}UpperArm`])))))]
      .filter((point, k, all) => k === all.length - 1 || !through(point, all[k + 1]));
    const points = run ? [run, take.goal.position] : route.length ? route : [take.goal.position];
    let was = from;
    const lengths = points.map((point) => { const length = was.distanceTo(point); was = point; return length; });
    const distance = lengths.reduce((sum, length) => sum + length, 0);
    const at = gripAt(person, take, person.frame);
    const { delay, slower } = takes.length > 1 && take.side !== LEADING ? following(seed, { [take.side]: take.grip }) : { delay: 0, slower: 0 };
    const seconds = reachTime(distance / person.scale, seedOf(take.grip, Math.round(at.x * 1000), Math.round(at.z * 1000))) / (1 - slower) / person.tempo;
    return { ...take, from, points, lengths, distance, route, delay, seconds, run };
  });
  const finish = plan.find(({ side }) => side === LEADING)?.seconds ?? plan[0].seconds;
  const lasts = (hand: (typeof plan)[number]) => motion ? hand.distance / motion.speed + motion.speed / motion.accel : Math.max(hand.delay, finish - hand.seconds) + hand.seconds;
  ends = began + Math.max(...plan.map(lasts));
  request.eta = ends - began;
  for (const take of takes) grasp(person, take.side, null);
  let staged = 0;
  yield* parallel<Frame>('all', ...plan.map((hand) => function* () {
    if (hand.run) {
      const after = Math.max(hand.delay, finish - hand.seconds);
      ends = Math.max(ends, person.frame.time + after + hand.seconds);
      yield* during(request, `hand.${hand.side}`, 'asked', pressingIn(person, hand, after), until(there));
      return;
    }
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
      const pace = motion ? { accel: motion.accel, speed: motion.speed } : { seconds, after, straight: hand.route.length > 0 };
      yield* during(request, `hand.${hand.side}`, 'asked', reaching(person, hand.side, goal, { on, thing: hand.thing, lead: !worn(hand.thing), ...pace }), ready);
    }
    staged++;
    // (staged first, it is held there for the other: let go, it would fall toward its hang and set off for its grip from that fall)
    if (hand.route.length) yield* during(request, `hand.${hand.side}`, 'asked', reaching(person, hand.side, { ...hand.goal, position: hand.points[hand.points.length - 1] },
      { on: person.track(hand.thing.object), thing: hand.thing, lead: !worn(hand.thing) }), () => staged === plan.length);
  }));
  // (both hands reach the outside staging points before closing on the actual grips: the closing judged late from as long after it sets
  // off as a reach that far takes — a hand held up short of its staging point, by as long as it may wait there, `STAGING`, found the end
  // planned for the whole approach already past as it set off for its grip, and was failed on its way)
  if (plan.some(({ route }) => route.length)) {
    const f = person.frame;
    for (const hand of plan) {
      const distance = f.prev.position(person.hands[hand.side]).distanceTo(gripAt(person, hand, f));
      ends = Math.max(ends, f.time + reachTime(distance / person.scale, seedOf(hand.grip, Math.round(distance * 1000))) / person.tempo);
    }
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
      .expandByScalar(LOAD_RESERVE * person.scale + (ARM.length + ARM.hand) * person.proportions.height);
    const hit = ray.intersectBox(box, new Vector3());
    if (!hit || hit.distanceTo(start) > length) continue;
    const edge = side === 'left' ? box.max.x : box.min.x;
    return [start.clone().setX(edge), end.clone().setX(edge)].map((point) => point.applyQuaternion(turn).add(root));
  }
  return [];
}

/** a hand as `outside` keeps it off what it reaches for: its fingers' way in its own frame, its length and half-thickness from the wrist,
 * the room it keeps (m; Drillis & Contini's hand, as `trunk.ts` has it), and where its shoulder is (the thing's frame) */
interface Hand { fingers: Vector3; length: number; radius: number; reserve: number; shoulder: Vector3 }

function handOf(person: Reacher, side: Side, shoulder: Vector3): Hand {
  const { height, offsets } = person.proportions;
  return { fingers: offsets[`${side}Hand`].clone().normalize(), length: ARM.length * height, radius: ARM.hand * height, reserve: LOAD_RESERVE * person.scale, shoulder };
}

/**
 * The way round the thing's envelope to the face nearest its grip, the wrist ending outside that face as far as the hand turned as it
 * will hold the grip (it turns so on the way round) is then clear of it by its reserve; the final closure onto the grip is separate.
 */
function outside(bounds: Box3, grip: Goal, from: Vector3, hand: Hand): Vector3[] {
  const size = bounds.getSize(new Vector3());
  if (size.x * size.y * size.z === 0) return [];
  const at = grip.position;
  let axis = 0, end = 0, gap = Infinity, seen = false;
  for (let i = 0; i < 3; i++) for (const side of [0, 1]) {
    const face = (side ? bounds.max : bounds.min).getComponent(i), distance = Math.abs(at.getComponent(i) - face);
    // (a grip on a face the hand is outside of already — a ribbon's end on the front of a thin medal — is taken from that side, not
    // round the thing to whichever face is nearest it)
    const facing = distance <= hand.radius + hand.reserve && (side ? 1 : -1) * (from.getComponent(i) - face) > 0;
    if ((facing && !seen) || (facing === seen && distance < gap)) [gap, axis, end, seen] = [distance, i, side, facing];
  }
  const sign = end ? 1 : -1;
  const face = (end ? bounds.max : bounds.min).getComponent(axis);
  // (how far inward of its wrist the hand reaches along the face's outward normal: to its fingers' end as it holds the grip — a grip
  // that sets no turn, the hand on in line with the arm held out from its shoulder to it)
  const fingers = grip.quaternion ? _fingers.copy(hand.fingers).applyQuaternion(grip.quaternion) : _fingers.subVectors(at, hand.shoulder).normalize();
  const inward = Math.max(0, -sign * fingers.getComponent(axis) * hand.length);
  const room = inward + hand.radius + hand.reserve;
  const out = Math.max(0, room - sign * (at.getComponent(axis) - face));
  const outer = at.clone().setComponent(axis, at.getComponent(axis) + sign * out);
  // Keep the same room toward the starting height, rather than lowering to grip height before closure; the outside wrist still has
  // to settle within REACHED.
  if (axis !== 1) outer.y = at.y + Math.max(-room, Math.min(room, from.y - at.y));
  // (a hand already outside that face goes straight on to it: the line stays outside it; one within, out to it first. A corner already
  // reached must not restart the arm on a near-zero-duration glide)
  if (sign * (from.getComponent(axis) - outer.getComponent(axis)) >= 0) return [outer];
  const corner = from.clone().setComponent(axis, outer.getComponent(axis));
  return from.distanceTo(corner) <= REACHED.distance ? [outer] : [corner, outer];
}

const _toward = new Vector3(), _fingers = new Vector3();
