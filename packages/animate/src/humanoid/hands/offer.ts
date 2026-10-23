import { parallel } from '@pmndrs/timeline';
import type { Body, Frame } from '../../core/body';
import type { Item } from '../../core/carrier';
import type { Behaviour, Placement } from '../../core/goal';
import { forwardOf } from '../../core/math';
import { when } from '../../core/when';
import { Humanoid } from '../humanoid';
import { carried } from '../goal';
import { hold } from './carry';
import { release } from './release';

/** whether `body` holds `item` in any of its hands */
export const holds = (body: Body, item: Item): boolean => Object.values(body.holding).some((held) => held?.item === item);

/** whether `giver` offers `item`: from when its `offer` begins to hold it out until it lets go — the taker's cue to come for it */
export const offered = (giver: Body, item: Item): boolean => item.offeredBy === giver;

/**
 * Handing `item` to `to`: the body holds it out toward the other (a person at arm's length before its chest, another body where its
 * hand rests), its eyes on it, and lets go once the other has it in a hand — whatever the other does to take it (its own `grab`). A
 * hand-over is two stories meeting on a condition: one offers, the other comes for it once it is `offered` and takes it; neither
 * waits on time.
 */
export function offer(body: Body, item: Item, to: Body): Behaviour {
  const hands = () => (Object.keys(body.holding) as string[]).filter((hand) => body.holding[hand]?.item === item);
  return function* () {
    if (!hands().length) throw new Error(`offer: "${item.name}" is not held`);
    const out = body instanceof Humanoid ? (f: Frame): Placement => {
      // (held out halfway to the other, at a reach before the chest: the other comes for it)
      const at = f.prev.position(0), toward = to.pose.position(0).clone().sub(at).setY(0), far = toward.length();
      const ahead = Math.min(far / 2, OUT * body.proportions.armLength);
      const forward = far > 1e-6 ? toward.divideScalar(far) : forwardOf(body.yaw);
      return { position: at.clone().setY(body.proportions.shoulderHeight - DOWN * body.scale).addScaledVector(forward, ahead), quaternion: item.current.quaternion.clone() };
    } : carried(body);
    item.offeredBy = body;
    try {
      yield* parallel<Frame>('race', hold(body, item, { to: out }), when(() => holds(to, item)));
    } finally {
      item.offeredBy = null;
    }
    yield* release(body, hands())();
  };
}

/** Tuned: a person holds something out this share of its arm before it, this far (m, × its scale) below its shoulders */
const OUT = 0.85, DOWN = 0.25;
