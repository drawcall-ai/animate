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
const LIFT = 0.75;
const RAISE = 1.1;
const LOWER = 0.75;
// Tuned anticipation: approach once the lift clears its support, raise 0.7 s before arrival.
const LIFT_CLEAR = 0.08;
const ARRIVING = 0.7;
// Tuned default-stature metres: keep the rise ahead of the face and outside the destination until the final transfer.
const OUTSIDE = 0.22;
const BELOW = 0.1;

/** Lift close to the body while setting off, then raise outside the destination on arrival and transfer onto it. */
export function place<W>(h: Humanoid<W>, item: Item, to: Live<Placement, W>): Behaviour<W> {
  return withGaze(h, (f) => live(to, f).position, function* () {
    const body = carried(h);
    const near = arriving(h, ARRIVING);
    yield* parallel<Frame<W>>('all', function* () {
      yield* when<W>((f) => !item.supported && item.current.position.y >= body(f).position.y - LIFT_CLEAR * h.scale);
      yield* approach(h, to)();
    }, function* () {
      yield* carry(h, item, [[LIFT, body]])();
      yield* hold(h, item, { to: body, until: near })();
      yield* carry(h, item, [[RAISE, (f) => {
        const goal = body(f);
        goal.position.addScaledVector(forwardOf(h.gait.facing), OUTSIDE * h.scale);
        goal.position.y = Math.max(goal.position.y, live(to, f).position.y - BELOW * h.scale);
        return goal;
      }], [LOWER, to]])();
    });
  });
}
