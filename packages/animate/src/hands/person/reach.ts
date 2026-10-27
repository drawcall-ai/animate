import { Box3, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import type { Frame } from '../../kernel/frame';
import { REACHED, REACHING, type Goal } from '../../kernel/goal';
import { lerp } from '../../kernel/math';
import { seeded, seedOf } from '../../kernel/random';
import { reached } from '../../kernel/tip';
import { during, type Request } from '../../kernel/requests';
import { grasp, onBody, worn } from '../../things/hold';
import type { Hold } from '../../things/resolve';
import { CALM, reaching } from './arms';
import { armReaches, footing, walking } from './stand';
import { noticing } from '../../look/gaze';
import { SIDES, type Side } from '../../species/humanoid/bones';
import type { Reacher } from './reacher';
import type { Pace } from '../handling';
import { LOAD_RESERVE } from './clearance';

/** Tuned: a staging point outside a thing that the arm falls short of (a load capping the bow) is left this long (s) after its time is up,
 * the hand closing on its grip from as near as it got */
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

/**
 * The hands open, go to their grips together (already on them, they close at once) — one shared condition: each stays on its way until
 * every one is there, the body bowing and bending as low as they are — and close on them. Both going, the right hand leads and the left
 * sets off a moment after it, a little slower (`LEADING`, seeded by what it goes for), its arm kept as it is till then. A hand routes
 * round the outside of the thing it reaches into (a box's handle from outside). Hands not there within `REACHING` s are a problem in the
 * dev log, and they keep going: lateness never throws.
 */
export function* reachFor(person: Reacher, request: Request, takes: readonly Taking[], motion?: { speed: number; accel?: number }) {
  const began = person.frame.time;
  const there = (f: Frame) => takes.every((take) => reached(f, person.hands[take.side], take.goal, person.track(take.thing.object)));
  const close = () => takes.forEach((take) => grasp(person, take.side, { thing: take.thing, grip: take.grip, goal: take.goal }));
  // (hands at their grips already close at once)
  if (takes.every((take) => person.pose.position(person.hands[take.side]).distanceTo(gripAt(person, take, person.frame)) <= REACHED.distance)) return close();
  let late = false, ends = Infinity;
  const until = (ready: (f: Frame) => boolean) => (f: Frame) => {
    request.eta = Math.max(0, ends - f.time);
    if (ready(f)) return true;
    if (!late && f.time - began > REACHING) {
      late = true;
      for (const take of takes) {
        const value = f.prev.position(person.hands[take.side]).distanceTo(gripAt(person, take, f));
        f.dev?.append(f.time, { check: `late reach: grip distance after ${REACHING} s (m)`, value, limit: REACHED.distance, where: `${take.thing.object.name} ${take.side} ${take.grip}` });
      }
    }
    return false;
  };
  const plan = takes.map((take) => {
    const frame = person.track(take.thing.object).current, seed = frame.position;
    const from = person.pose.position(person.hands[take.side]).clone().sub(frame.position).applyQuaternion(frame.quaternion.clone().invert());
    // (what the body wears or holds moves with it, held clear of it: the hand goes to its grip directly)
    const route = onBody(person, take.thing) ? [] : outside(take.thing.bounds, take.goal.position, from, LOAD_RESERVE * person.scale);
    const points = route.length ? route : [take.goal.position];
    let was = from;
    const lengths = points.map((point) => { const length = was.distanceTo(point); was = point; return length; });
    const distance = lengths.reduce((sum, length) => sum + length, 0);
    const at = gripAt(person, take, person.frame);
    const { delay, slower } = takes.length > 1 && take.side !== LEADING ? following(seed, { [take.side]: take.grip }) : { delay: 0, slower: 0 };
    const seconds = reachTime(distance / person.scale, seedOf(take.grip, Math.round(at.x * 1000), Math.round(at.z * 1000))) / (1 - slower) / person.tempo;
    return { ...take, points, lengths, distance, route, delay, seconds };
  });
  const staged = (f: Frame) => plan.every((hand) => reached(f, person.hands[hand.side], { position: hand.points[hand.points.length - 1] }, person.track(hand.thing.object)));
  const finish = plan.find(({ side }) => side === LEADING)?.seconds ?? plan[0].seconds;
  // (when the hands will be there: at a pace asked, as long as that pace takes the farthest)
  const lasts = (hand: (typeof plan)[number]) => motion ? hand.distance / motion.speed + motion.speed / (motion.accel ?? CALM.accel) : Math.max(hand.delay, finish - hand.seconds) + hand.seconds;
  ends = began + Math.max(...plan.map(lasts));
  request.eta = ends - began;
  for (const take of takes) grasp(person, take.side, null);
  yield* parallel<Frame>('all', ...plan.map((hand) => function* () {
    for (const [i, position] of hand.points.entries()) {
      const began = person.frame.time;
      const seconds = hand.distance > 0 ? hand.seconds * hand.lengths[i] / hand.distance : hand.seconds;
      const after = i === 0 ? Math.max(hand.delay, finish - hand.seconds) : 0;
      // (on the way round, already turning as it will hold it)
      const goal = hand.route.length ? { ...hand.goal, position } : hand.goal;
      const ready = hand.route.length
        ? until((f) => (i === hand.points.length - 1 && staged(f)) || f.time >= began + seconds + after + (i === hand.points.length - 1 ? STAGING : 0))
        : until(there);
      const on = person.track(hand.thing.object);
      // (at a speed asked, the hand goes there at that pace, braking in; else in the time a calm reach that far takes)
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

/** Route around the envelope to its nearest grip face; the final closure is separate. */
function outside(bounds: Box3, grip: Vector3, from: Vector3, reserve: number): Vector3[] {
  const size = bounds.getSize(new Vector3());
  if (size.x * size.y * size.z === 0) return [];
  const box = bounds.clone().expandByScalar(reserve);
  // (the face of the bounds nearest the grip)
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
  return [corner, outer];
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

/**
 * Hands to targets, taking nothing: from where the body stands if the arms reach them (the trunk turning — a shoulder up to its
 * half-width nearer — and bowing for them), else it walks up first (borrowed legs); the eyes on them (borrowed); the hands going (asked)
 * as the walk will arrive within `NEAR` s, each in the time a calm reach that far takes or at the pace asked. Met once they are there; they
 * keep there. `false` if it can stand nowhere in reach.
 */
export function* reachingTo(person: Reacher, request: Request, aims: readonly { side: Side; target: (f: Frame) => Goal }[], pace: Pace) {
  const inReach = aims.every(({ side, target }) => armReaches(person, target(person.frame).position, side, true));
  const plan = inReach ? 'there' : footing(person, { grips: aims.map(({ side, target }) => ({ side, at: target(person.frame).position.clone() })), mass: 0 });
  if (plan === 'nowhere') {
    request.fail();
    return;
  }
  let stood = plan === 'there';
  const near = () => stood || (plan !== 'there' && plan.walk.eta <= NEAR);
  const middle = (f: Frame) => aims.reduce((sum, { target }) => sum.add(target(f).position), _middle.set(0, 0, 0)).divideScalar(aims.length);
  const there = (f: Frame) => aims.every(({ side, target }) => reached(f, person.hands[side], target(f)));
  const going = aims.map(({ side, target }) => {
    const distance = person.pose.position(person.hands[side]).distanceTo(target(person.frame).position);
    const { speed } = pace, accel = pace.accel ?? CALM.accel;
    if (speed !== undefined) return { side, step: reaching(person, side, target, { accel, speed }), lasts: distance / speed + speed / accel };
    const seconds = reachTime(distance / person.scale, seedOf(side, Math.round(distance * 1000))) / person.tempo;
    return { side, step: reaching(person, side, target, { seconds }), lasts: seconds };
  });
  // (what it moves arrives once the farthest hand does: the hands set off `NEAR` s before a walk arrives)
  const lasts = Math.max(...going.map((hand) => hand.lasts));
  let setOff = NaN;
  yield* parallel<Frame>('all', function* () {
    if (plan === 'there') return;
    if (!(yield* walking(request, plan, Math.max(0, lasts - NEAR)))) request.fail();
    stood = true;
  }, function* () {
    yield* parallel<Frame>('race', noticing(person, request, middle), function* () {
      yield* action<Frame>({ until: near });
      const eta = (f: Frame) => void (request.eta = Math.max(0, (Number.isNaN(setOff) ? (setOff = f.time) : setOff) + lasts - f.time));
      yield* parallel<Frame>('race', ...going.map(({ side, step }) => during(request, `hand.${side}`, 'asked', step)), action<Frame>({ update: eta, until: there }));
    });
  });
  if (request.outcome === 'failed') return;
  request.met();
  // (there, it keeps its hands there till its story moves on)
  yield* parallel<Frame>('all', ...going.map(({ side, step }) => during(request, `hand.${side}`, 'asked', step)));
}

/** the hands set off once the walk will arrive within this (s) */
const NEAR = 0.6;
const _middle = new Vector3();
