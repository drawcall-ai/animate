import type { Frame } from '../../core/body';
import type { Carrier } from '../../core/carrier';
import { ChainTip } from '../../core/tip';
import { handStep } from '../arms';
import type { Side } from '../bones';
import type { Humanoid } from '../humanoid';
import { gripOf } from './grips';

// Tuned held-contact pace; the shoulder and wrist are coupled, so refine their geometry twice.
const HOLD = { accel: 30, speed: 3, turnAccel: 200, turnSpeed: 15 };
const arms = new WeakMap<object, Record<Side, ChainTip>>();

/** The held hand follows its grip once per step, whether explicitly carried or passive. */
export function holdHand<W>(h: Humanoid<W>, f: Frame<W>, side: Side, on?: Carrier) {
  const held = h.holding[side];
  if (!held || held.time === f.time) return;
  let pair = arms.get(h);
  if (!pair) {
    pair = { left: new ChainTip('leftArm'), right: new ChainTip('rightArm') };
    arms.set(h, pair);
  }
  const arm = pair[side];
  for (let pass = 0; pass < 2; pass++) handStep(h, f, side, gripOf(held.item, held.grip), { on: on ?? held.item, ...HOLD, lead: !held.item.wornBy }, arm);
}
