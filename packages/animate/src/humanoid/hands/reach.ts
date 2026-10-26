import { Box3, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import type { Frame } from '../../core/frame';
import { REACHED, REACHING, type Target } from '../../core/goal';
import { lerp } from '../../core/math';
import { seeded, seedOf } from '../../core/random';
import { reached } from '../../core/tip';
import { during, type Request } from '../../body/requests';
import { grasp, onBody, worn } from '../../body/hold';
import type { Local, Thing } from '../../body/things';
import { CALM, reaching } from '../arms';
import { SIDES, type Side } from '../bones';
import type { Person } from '../person';
import { LOAD_RESERVE } from './clearance';

// The hands to their grips: each in a reach's time, the two not each other's mirror image.

/** A hand's hold to take: the hand, the thing, the empty it takes it by and where that is in the thing's frame. */
export interface Taking {
  side: Side;
  thing: Thing;
  grip: string;
  at: Local;
}

/** where a grip is in the world this sub-step, as `h` tracks its thing */
export function gripAt(h: Person, take: Pick<Taking, 'thing' | 'at'>, f: Frame, out = new Vector3()): Vector3 {
  const frame = h.track(take.thing.object).at(f.time).current;
  return out.copy(take.at.position).applyQuaternion(frame.quaternion).add(frame.position);
}

/**
 * The hands open, go to their grips together (already on them, they close at once) — one shared condition: each stays on its way until
 * every one is there, the body bowing and bending as low as they are — and close on them. Both going, the right hand leads and the left
 * sets off a moment after it, a little slower (`LEADING`, seeded by what it goes for), its arm kept as it is till then. A hand routes
 * round the outside of the thing it reaches into (a box's handle from outside). Hands not there within `REACHING` s are a problem in the
 * dev log, and they keep going: lateness never throws.
 */
export function* reachFor(h: Person, request: Request, takes: readonly Taking[], motion?: { speed: number; accel?: number }) {
  const began = h.frame.time;
  const goalOf = (take: Taking): Target => ({ position: take.at.position });
  const there = (f: Frame) => takes.every((take) => reached(f, h.hands[take.side], goalOf(take), h.track(take.thing.object)));
  // (hands at their grips already close at once)
  if (takes.every((take) => h.pose.position(h.hands[take.side]).distanceTo(gripAt(h, take, h.frame)) <= REACHED.distance)) {
    for (const take of takes) grasp(h, take.side, { thing: take.thing, grip: take.grip, at: take.at });
    return;
  }
  let late = false;
  const until = (ready: (f: Frame) => boolean) => (f: Frame) => {
    if (ready(f)) return true;
    if (!late && f.time - began > REACHING) {
      late = true;
      for (const take of takes) {
        const value = f.prev.position(h.hands[take.side]).distanceTo(gripAt(h, take, f));
        f.dev?.append(f.time, { check: `late reach: grip distance after ${REACHING} s (m)`, value, limit: REACHED.distance, where: `${take.thing.object.name} ${take.side} ${take.grip}` });
      }
    }
    return false;
  };
  const plan = takes.map((take) => {
    const frame = h.track(take.thing.object).current, seed = frame.position;
    const from = h.pose.position(h.hands[take.side]).clone().sub(frame.position).applyQuaternion(frame.quaternion.clone().invert());
    // (what the body wears or holds moves with it, held clear of it: the hand goes to its grip directly)
    const route = onBody(h, take.thing) ? [] : outside(take.thing.bounds, take.at.position, from, LOAD_RESERVE * h.scale);
    const points = route.length ? route : [take.at.position];
    let was = from;
    const lengths = points.map((point) => { const length = was.distanceTo(point); was = point; return length; });
    const distance = lengths.reduce((sum, length) => sum + length, 0);
    const at = gripAt(h, take, h.frame);
    const { delay, slower } = takes.length > 1 && take.side !== LEADING ? following(seed, { [take.side]: take.grip }) : { delay: 0, slower: 0 };
    const seconds = reachTime(distance / h.scale, seedOf(take.grip, Math.round(at.x * 1000), Math.round(at.z * 1000))) / (1 - slower) / h.tempo;
    return { ...take, points, lengths, distance, route, delay, seconds };
  });
  const arrived = until((f) => plan.every((p) => reached(f, h.hands[p.side], { position: p.points[p.points.length - 1] }, h.track(p.thing.object))));
  const finish = plan.find(({ side }) => side === LEADING)?.seconds ?? plan[0].seconds;
  for (const take of takes) grasp(h, take.side, null);
  yield* parallel<Frame>('all', ...plan.map((p) => function* () {
    for (const [i, position] of p.points.entries()) {
      const began = h.frame.time;
      const seconds = p.distance > 0 ? p.seconds * p.lengths[i] / p.distance : p.seconds;
      const after = i === 0 ? Math.max(p.delay, finish - p.seconds) : 0;
      const goal = p.route.length ? { position } : goalOf(p);
      const ready = p.route.length
        ? i === p.points.length - 1 ? arrived : until((f) => f.time >= began + seconds + after)
        : until(there);
      const on = h.track(p.thing.object);
      // (at a speed asked, the hand goes there at that pace, braking in; else in the time a calm reach that far takes)
      const pace = motion ? { accel: motion.accel ?? CALM.accel, speed: motion.speed } : { seconds, after };
      yield* during(request, `hand.${p.side}`, 'asked', reaching(h, p.side, goal, { on, thing: p.thing, lead: !worn(p.thing), ...pace }), ready);
    }
  }));
  // (both hands reach the outside staging points before closing on the actual grips)
  if (plan.some(({ route }) => route.length)) {
    yield* parallel<Frame>('all', ...plan.map((p) => during(request, `hand.${p.side}`, 'asked',
      reaching(h, p.side, goalOf(p), { on: h.track(p.thing.object), thing: p.thing, lead: !worn(p.thing) }), until(there))));
  }
  for (const take of takes) grasp(h, take.side, { thing: take.thing, grip: take.grip, at: take.at });
}

/** Route around the envelope to its nearest grip face; the final closure is separate. */
function outside(bounds: Box3, grip: Vector3, from: Vector3, reserve: number): Vector3[] {
  const size = bounds.getSize(new Vector3());
  if (size.x * size.y * size.z === 0) return [];
  const box = bounds.clone().expandByScalar(reserve);
  const { axis, end } = face(bounds, grip), sign = end ? 1 : -1;
  const edge = (end ? box.max : box.min).getComponent(axis);
  const outer = grip.clone().setComponent(axis, sign > 0 ? Math.max(grip.getComponent(axis), edge) : Math.min(grip.getComponent(axis), edge));
  // Keep the same reserve toward the starting height, rather than lowering to grip height before closure; the outside wrist still has
  // to settle within REACHED.
  if (axis !== 1) outer.y = grip.y + Math.max(-reserve, Math.min(reserve, from.y - grip.y));
  const corner = from.clone().setComponent(axis, outer.getComponent(axis));
  return [corner, outer];
}

function face(bounds: Box3, point: Vector3) {
  let axis = 0, end = 0, gap = Infinity;
  for (let i = 0; i < 3; i++) for (const side of [0, 1]) {
    const distance = Math.abs(point.getComponent(i) - (side ? bounds.max : bounds.min).getComponent(i));
    if (distance < gap) { gap = distance; axis = i; end = side; }
  }
  return { axis, end };
}

/**
 * how long a calm reach `distance` away to take something takes (s; m, default body): Fitts' law, MT = a + b · log2(2 D / W) (recalled,
 * not checked: a ~0.25 s, b ~0.15 s/bit at everyday precision, a grip ~4 cm wide), varied ±10% (seeded by `seed`) — a 50 cm reach ~0.95
 * s peaking ~1 m/s, a 10 cm one ~0.6 s
 */
export function reachTime(distance: number, seed: number): number {
  const bits = Math.log2(Math.max(1, (2 * distance) / FITTS.width));
  return (FITTS.a + FITTS.b * bits) * (1 + FITTS.vary * (2 * seeded(seed)() - 1));
}

const FITTS = { a: 0.25, b: 0.15, width: 0.04, vary: 0.1 };

/** the hand that leads where both work (a right-handed body): the other goes a moment after it, a little slower */
export const LEADING: Side = 'right';
/**
 * how much later (s) and slower (share of its pace) the other hand goes: not the leading hand's mirror image. (Hands reaching together
 * start within a few tens of ms of each other — Kelso, Southard & Goodman 1979, recalled, not checked; this is a little more, so the two
 * read apart.)
 */
const FOLLOWING = { delay: [0.06, 0.12], slower: [0.05, 0.1] };

/** how much later and slower the other hand goes for a thing `at` a place by its grips (seeded by them and where it is: the same each run) */
export function following(at: Readonly<Vector3>, grips: Partial<Record<Side, string>>) {
  const rand = seeded(seedOf(...SIDES.map((s) => grips[s] ?? ''), Math.round(at.x * 1000), Math.round(at.y * 1000), Math.round(at.z * 1000)));
  return { delay: lerp(FOLLOWING.delay[0], FOLLOWING.delay[1], rand()), slower: lerp(FOLLOWING.slower[0], FOLLOWING.slower[1], rand()) };
}
