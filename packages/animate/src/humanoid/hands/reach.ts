import { Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import type { Frame } from '../../core/body';
import type { Item } from '../../core/carrier';
import type { Behaviour, Target } from '../../core/goal';
import { seeded, seedOf } from '../../core/random';
import { reached } from '../../core/tip';
import { handTo } from '../arms';
import { INDEX, SIDES, type Side } from '../bones';
import type { Humanoid } from '../humanoid';
import { lerp } from '../math';
import { closeHand, gripOf, held, openHand, type Grips, type Holds } from './grips';

// The hands to their grips: each in a reach's time, the two not each other's mirror image.

/** the longest the hands take to get to their grips, unless told (s) */
const REACHING = 4;

/**
 * The hands open, go to their grips together (one shared condition: each stays on its way until
 * every one is there; the body bowing and bending as low as they are) and close on them. Both
 * going, the right hand leads and the left sets off a moment after it, a little slower (`LEADING`,
 * seeded by what it goes for), its arm kept as it is till then. A hand not there within `limit` s throws.
 */
export function reachFor<W>(h: Humanoid<W>, holds: Holds, { limit = REACHING } = {}): Behaviour<W> {
  const hands = held(holds);
  const there = (f: Frame<W>) => hands.every(({ side, item, grip }) => reached(f.prev2, f.prev, f.dt, INDEX[`${side}Hand`], gripOf(item, grip), item));
  const until = (f: Frame<W>, _: unknown, time: number) => {
    if (there(f)) return true;
    if (time > limit) throw new Error(`the hands did not get to their grips in ${limit} s`);
    return false;
  };
  // (each hand gliding to its grip in the time a reach that far takes; both going, the other a
  // moment after the leading one, a little slower)
  const lagging = hands.length > 1;
  const reach = (side: Side, item: Item, grip: string): Behaviour<W> =>
    function* () {
      const { delay, slower } = lagging && side !== LEADING ? following(item, { [side]: grip }) : { delay: 0, slower: 0 };
      const at = item.toWorld(gripOf(item, grip), _world).position;
      const seconds = reachTime(h.pose.position(INDEX[`${side}Hand`]).distanceTo(at) / h.proportions.scale, seedOf(grip, Math.round(at.x * 1000), Math.round(at.z * 1000))) / (1 - slower);
      yield* handTo(h, side, gripOf(item, grip), { on: item, until, seconds, after: delay })();
    };
  return function* () {
    for (const { side } of hands) yield* openHand(h, side)();
    yield* parallel<Frame<W>>('all', ...hands.map(({ side, item, grip }) => reach(side, item, grip)));
    for (const { side, item, grip } of hands) yield* closeHand(h, side, item, grip)();
  };
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
export function following(item: Item, grips: Grips) {
  const at = item.current.position;
  const rand = seeded(seedOf(...SIDES.map((s) => grips[s] ?? ''), Math.round(at.x * 1000), Math.round(at.y * 1000), Math.round(at.z * 1000)));
  return { delay: lerp(FOLLOWING.delay[0], FOLLOWING.delay[1], rand()), slower: lerp(FOLLOWING.slower[0], FOLLOWING.slower[1], rand()) };
}

const _world: Target & { velocity: Vector3; spin: Vector3 } = { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() };
