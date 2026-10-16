import { parallel } from '@pmndrs/timeline';
import type { Frame } from '../../core/body';
import type { Item } from '../../core/carrier';
import { live, type Behaviour, type Live, type Placement } from '../../core/goal';
import { forwardOf } from '../../core/math';
import { when } from '../../core/when';
import { withGaze } from '../look';
import { carried } from '../goal';
import type { Humanoid } from '../humanoid';
import { arriving } from '../walk';
import { carry, hold } from './carry';
import { approach } from './grab';

// Tuned unloaded course seconds: lift into a carry, raise on arrival, then lower onto the support.
const LIFT = 0.5;
const RAISE = 1.1;
const LOWER = 0.75;
// Tuned anticipation: approach once the lift clears its support, raise on arrival before foot settling.
const LIFT_CLEAR = 0.08;
export const RAISE_LEAD = 0.3;
// Tuned default-stature metres: keep the rise ahead of the face and outside the destination until the final transfer.
const OUTSIDE = 0.35;
const BELOW = 0.1;

/** Lift close to the body while setting off, then raise outside the destination on arrival and transfer onto it.
 * A live destination follows translation and rotation throughout the approach and transfer. */
export function place<W>(h: Humanoid<W>, item: Item, to: Live<Placement, W>): Behaviour<W> {
  return withGaze(h, (f) => live(to, f).position, function* () {
    const atBody = carried(h);
    const height = Math.min(item.current.position.y, atBody(h.frame).position.y);
    // The raise must read this approach’s ETA, after both lift clearance and any sibling walk.
    let approaching = false;
    const near = arriving(h, RAISE_LEAD);
    yield* parallel<Frame<W>>('all', function* () {
      yield* when<W>((f) => !item.supported && item.current.position.y >= atBody(f).position.y - LIFT_CLEAR * h.scale);
      if (h.asks.go) yield* when(() => h.gait.eta === Infinity);
      approaching = true;
      yield* approach(h, to)();
    }, function* () {
      // Draw the load below the bowed head before lifting it into the standing carry.
      yield* carry(h, item, [[LIFT / 2, (f) => {
        const goal = atBody(f);
        goal.position.y = height;
        return goal;
      }], [LIFT / 2, atBody]])();
      yield* hold(h, item, { to: atBody, until: (f) => approaching && near(f) && !h.gait.moving })();
      yield* carry(h, item, [[RAISE, (f) => {
        const goal = atBody(f);
        goal.quaternion = live(to, f).quaternion ?? goal.quaternion;
        goal.position.addScaledVector(forwardOf(h.gait.facing), OUTSIDE * h.scale);
        goal.position.y = Math.max(goal.position.y, live(to, f).position.y - BELOW * h.scale);
        return goal;
      }], [LOWER, to]])();
    });
  });
}
