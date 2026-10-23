import { parallel } from '@pmndrs/timeline';
import type { Frame } from '../../core/body';
import type { Item } from '../../core/carrier';
import { live, type Behaviour, type Live, type Placement } from '../../core/goal';
import { withGaze } from '../../core/gaze';
import { carried } from '../goal';
import { Humanoid } from '../humanoid';
import type { Body } from '../../core/body';
import { put } from '../../core/hands';
import { arriving } from '../../core/walk';
import { when } from '../../core/when';
import { carry, hold } from './carry';
import { approach } from './grab';

// Inherited unchanged from iteration 10 (c3f8368); never re-tuned (unloaded s).
const LIFT = 0.5;
// Inherited unchanged from iteration 12 (818a966), which combined raise and transfer into one course.
const RAISE = 1.3;
// Inherited unchanged from iteration 11 (3cad1b6); never re-tuned (anticipation s).
export const RAISE_LEAD = 0.9;
// Original tuning provenance is unrecorded. Retained against pickup-shelf and stable-morning
// placement/clearance regressions: travel starts after two thirds of positive rise.
const APPROACH_RISE = 2 / 3;
/** Lift close to the body, approach, then transfer onto the destination during the last step.
 * A live destination follows translation and rotation throughout the approach and transfer. */
export function place(body: Body, item: Item, to: Live<Placement>): Behaviour {
  // (another body walks up, takes it there in its hand and lets go)
  if (!(body instanceof Humanoid)) return put(body, item, to);
  const h = body;
  return function* () {
    let lifting = true;
    const watched = item.current.position.clone();
    yield* withGaze(h, (f) => lifting ? watched : live(to, f).position, function* () {
      const atBody = carried(h);
      const from = item.current.position.y;
      const rise = atBody(h.frame).position.y - from;
      const near = arriving(h, RAISE_LEAD);
      let approached = false;
      yield* parallel<Frame>('all', function* () {
        // Extension and turning overlap; a level or downward carry has no rise to wait for.
        yield* when(() => rise <= 0 || item.current.position.y >= from + rise * APPROACH_RISE);
        // (setting off, the eyes leave where it was for where it goes: held on the empty spot, they would be left behind over a
        // shoulder as the body turns away, and swing across to the other once it is behind)
        lifting = false;
        yield* approach(h, to)();
        approached = true;
      }, function* () {
        yield* carry(h, item, [[LIFT, atBody]])();
        lifting = false;
        yield* hold(h, item, { to: atBody, until: near })();
        yield* carry(h, item, [[RAISE, to]])();
        yield* hold(h, item, { to, until: () => approached })();
      });
    })();
  };
}
