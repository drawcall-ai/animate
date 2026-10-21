import { Box3, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import type { Frame } from '../../core/body';
import { gripOf, type Item } from '../../core/carrier';
import { REACHED, type Behaviour, type Target, REACHING } from '../../core/goal';
import { seeded, seedOf } from '../../core/random';
import { reached } from '../../core/tip';
import { handTo } from '../arms';
import { SIDES, type Side } from '../bones';
import type { Humanoid } from '../humanoid';
import { lerp } from '../../core/math';
import { LOAD_RESERVE } from './clearance';
import { closeHand, held, openHand, type ItemGrips } from './grips';
import type { Grips } from '../../core/hands';
import { heldItems } from '../../core/worn';

// The hands to their grips: each in a reach's time, the two not each other's mirror image.


/**
 * The hands open, go to their grips together (already on them, they close at once) (one shared condition: each stays on its way until
 * every one is there; the body bowing and bending as low as they are) and close on them. Both
 * going, the right hand leads and the left sets off a moment after it, a little slower (`LEADING`,
 * seeded by what it goes for), its arm kept as it is till then. Hands not there within `limit` s are a problem in the dev log
 * (`Body.log`), and they keep going: lateness never throws.
 */
export function reachFor(h: Humanoid, holds: Grips, { limit = REACHING } = {}): Behaviour {
  return function* () {
    const hands = held(holds), began = h.frame.time;
    const there = (f: Frame) => hands.every(({ side, item, grip }) => reached(f, h.hands[side], gripOf(item, grip), item));
    // (hands at their grips already close at once)
    if (hands.every(({ side, item, grip }) => h.pose.position(h.hands[side]).distanceTo(item.toWorld(gripOf(item, grip), _world).position) <= REACHED.distance)) {
      for (const { side, item, grip } of hands) yield* closeHand(h, side, item, grip)();
      return;
    }
    let late = false;
    const until = (ready: (f: Frame) => boolean) => (f: Frame) => {
      if (ready(f)) return true;
      if (!late && f.time - began > limit) {
        late = true;
        for (const { side, item, grip } of hands) {
          const value = f.prev.position(h.hands[side]).distanceTo(item.toWorld(gripOf(item, grip), _world, f.time).position);
          f.dev?.append(f.time, { check: `late reach: grip distance after ${limit} s (m)`, value, limit: REACHED.distance, where: `${item.name} ${side} ${grip}` });
        }
      }
      return false;
    };
    const plan = hands.map(({ side, item, grip }) => {
      const goal = gripOf(item, grip);
      const from = h.pose.position(h.hands[side]).clone().sub(item.current.position).applyQuaternion(item.current.quaternion.clone().invert());
      // (what the body wears or holds moves with it, held clear of it: the hand goes to its grip directly)
      const route = item.wornBy || heldItems(h).includes(item) ? [] : outside(item, goal.position, from, LOAD_RESERVE * h.scale);
      const points = route.length ? route : [goal.position];
      let was = from;
      const lengths = points.map((point) => { const length = was.distanceTo(point); was = point; return length; });
      const distance = lengths.reduce((sum, length) => sum + length, 0);
      const at = item.toWorld(goal, _world).position;
      const { delay, slower } = hands.length > 1 && side !== LEADING ? following(item, { [side]: grip }) : { delay: 0, slower: 0 };
      const seconds = reachTime(distance / h.scale, seedOf(grip, Math.round(at.x * 1000), Math.round(at.z * 1000))) / (1 - slower);
      return { side, item, goal, points, lengths, distance, route, delay, seconds };
    });
    const arrived = until((f) => plan.every(({ side, item, points }) => reached(f, h.hands[side], { position: points[points.length - 1] }, item)));
    const finish = plan.find(({ side }) => side === LEADING)?.seconds ?? plan[0].seconds;
    for (const { side } of hands) yield* openHand(h, side)();
    yield* parallel<Frame>('all', ...plan.map((p) => function* () {
      for (const [i, position] of p.points.entries()) {
        const began = h.frame.time;
        const seconds = p.distance > 0 ? p.seconds * p.lengths[i] / p.distance : p.seconds;
        const after = i === 0 ? Math.max(p.delay, finish - p.seconds) : 0;
        const goal = p.route.length ? { position } : p.goal;
        const ready = p.route.length
          ? i === p.points.length - 1 ? arrived : until((f) => f.time >= began + seconds + after)
          : until(there);
        yield* handTo(h, p.side, goal, { on: p.item, lead: !p.item.wornBy, seconds, after, until: ready })();
      }
    }));
    // Both hands reach the outside staging points before closing on the actual grips.
    if (plan.some(({ route }) => route.length)) yield* parallel<Frame>('all', ...plan.map(({ side, item, goal }) => handTo(h, side, goal, { on: item, lead: !item.wornBy, until: until(there) })));
    for (const { side, item, grip } of hands) yield* closeHand(h, side, item, grip)();
  };
}

/** Route around the envelope to its nearest grip face; the final closure is separate. */
function outside(item: Item, grip: Vector3, from: Vector3, reserve: number): Vector3[] {
  const bounds = item.bounds, size = bounds.getSize(new Vector3());
  if (size.x * size.y * size.z === 0) return [];
  const box = bounds.clone().expandByScalar(reserve);
  const { axis, end } = face(bounds, grip), sign = end ? 1 : -1;
  const edge = (end ? box.max : box.min).getComponent(axis);
  const outer = grip.clone().setComponent(axis, sign > 0 ? Math.max(grip.getComponent(axis), edge) : Math.min(grip.getComponent(axis), edge));
  // Keep the same reserve toward the starting height, rather than lowering to grip
  // height before closure; the outside wrist still has to settle within REACHED.
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
 * how long a calm reach `distance` away to take something takes (s; m, default body): Fitts' law,
 * MT = a + b · log2(2 D / W) (recalled, not checked: a ~0.25 s, b ~0.15 s/bit at everyday precision,
 * a grip ~4 cm wide), varied ±10% (seeded by `seed`) — a 50 cm reach ~0.95 s peaking ~1 m/s, a
 * 10 cm one ~0.6 s
 */
function reachTime(distance: number, seed: number): number {
  const bits = Math.log2(Math.max(1, (2 * distance) / FITTS.width));
  return (FITTS.a + FITTS.b * bits) * (1 + FITTS.vary * (2 * seeded(seed)() - 1));
}

const FITTS = { a: 0.25, b: 0.15, width: 0.04, vary: 0.1 };

/** the hand that leads where both work (a right-handed body): the other goes a moment after it, a little slower */
export const LEADING: Side = 'right';
/**
 * how much later (s) and slower (share of its pace) the other hand goes: not the leading hand's
 * mirror image. (Hands reaching together start within a few tens of ms of each other — Kelso,
 * Southard & Goodman 1979, recalled, not checked; this is a little more, so the two read apart.)
 */
const FOLLOWING = { delay: [0.06, 0.12], slower: [0.05, 0.1] };

/** how much later and slower the other hand goes for `item` by `grips` (seeded by them and where it is: the same each run) */
export function following(item: Item, grips: ItemGrips) {
  const at = item.current.position;
  const rand = seeded(seedOf(...SIDES.map((s) => grips[s] ?? ''), Math.round(at.x * 1000), Math.round(at.y * 1000), Math.round(at.z * 1000)));
  return { delay: lerp(FOLLOWING.delay[0], FOLLOWING.delay[1], rand()), slower: lerp(FOLLOWING.slower[0], FOLLOWING.slower[1], rand()) };
}

const _world: Target & { velocity: Vector3; spin: Vector3 } = { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() };
