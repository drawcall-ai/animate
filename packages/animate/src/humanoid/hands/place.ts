import { parallel } from '@pmndrs/timeline';
import type { Frame } from '../../core/body';
import type { Item } from '../../core/carrier';
import { live, type Behaviour, type Live, type Placement } from '../../core/goal';
import { withGaze } from '../look';
import { carried } from '../goal';
import type { Humanoid } from '../humanoid';
import { arriving, waitForWalk } from '../walk';
import { carry, hold } from './carry';
import { approach } from './grab';

// Tuned against stable-yard wrist tracking: lift into carry, then transfer while the feet finish turning.
const LIFT = 0.5;
// Tuned lift split: draw in at the support height over half the course, then rise.
const DRAW_SHARE = 0.5;
const RAISE = 1.3;
// Tuned anticipation (s): one last step plus the loaded course’s ease-in before visible rise.
export const RAISE_LEAD = 0.9;
/** Lift close to the body, approach, then transfer onto the destination during the last step.
 * A live destination follows translation and rotation throughout the approach and transfer. */
export function place<W>(h: Humanoid<W>, item: Item, to: Live<Placement, W>): Behaviour<W> {
  return withGaze(h, (f) => live(to, f).position, function* () {
    const atBody = carried(h);
    // Read from the support and standing carry: the draw-in leg keeps the lower height.
    const drawHeight = Math.min(item.current.position.y, atBody(h.frame).position.y);
    yield* carry(h, item, [[LIFT * DRAW_SHARE, (f) => {
      const goal = atBody(f);
      goal.position.y = drawHeight;
      return goal;
    }], [LIFT * (1 - DRAW_SHARE), atBody]])();
    yield* waitForWalk(h);
    const near = arriving(h, RAISE_LEAD);
    yield* parallel<Frame<W>>('all', approach(h, to), function* () {
      yield* hold(h, item, { to: atBody, until: near })();
      yield* carry(h, item, [[RAISE, to]])();
      yield* hold(h, item, { to, until: () => h.gait.eta === Infinity })();
    });
  });
}
