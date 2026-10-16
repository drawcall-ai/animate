import { parallel } from '@pmndrs/timeline';
import type { Frame } from '../../core/body';
import type { Item } from '../../core/carrier';
import type { Behaviour, Placement } from '../../core/goal';
import { forwardOf } from '../../core/math';
import { withGaze } from '../look';
import { carried } from '../goal';
import type { Humanoid } from '../humanoid';
import { arriving } from '../walk';
import { carry, hold } from './carry';
import { approach } from './grab';

/** Carry at the body, then raise in front of the face as the approach arrives and place the load. */
export function place<W>(h: Humanoid<W>, item: Item, to: Placement): Behaviour<W> {
  return withGaze(h, to.position, function* () {
    const chest = carried(h);
    yield* carry(h, item, [[0.75, chest]])();
    let stood = false;
    const near = arriving(h, 0.7);
    yield* parallel<Frame<W>>('all', function* () {
      yield* approach(h, to)();
      stood = true;
    }, function* () {
      yield* hold(h, item, { to: chest, until: (f) => stood || near(f) })();
      yield* carry(h, item, [[1.1, (f) => {
        const goal = chest(f);
        goal.position.addScaledVector(forwardOf(h.gait.facing), 0.13 * h.scale);
        goal.position.y = Math.max(goal.position.y, to.position.y - 0.1 * h.scale);
        return goal;
      }], [0.75, to]])();
    });
  });
}
