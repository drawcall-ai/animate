import { Quaternion } from 'three';
import type { Frame } from '../../core/body';
import type { Item } from '../../core/carrier';
import type { Humanoid } from '../humanoid';
import { SIDES } from '../bones';
import { HOLD, handStep } from '../arms';
import { ChainTip } from '../../core/tip';
import { gripOf } from './grips';

/** The last hold pose carried by the root, unless another mover owns this step. */
function passive<W>(item: Item, f: Frame<W>) {
  const turn = f.current.rotation(0).clone().multiply(new Quaternion().copy(f.prev.rotation(0)).invert());
  return {
    position: item.current.position.clone().sub(f.prev.position(0)).applyQuaternion(turn).add(f.current.position(0)),
    quaternion: turn.multiply(item.current.quaternion),
  };
}

/** Explicit movers run first; only an otherwise unsupported hold inherits body travel. */
export function followHeld<W>(h: Humanoid<W>): (f: Frame<W>) => void {
  const arms = { left: new ChainTip('leftArm'), right: new ChainTip('rightArm') };
  return (f) => {
    const items = new Set(SIDES.flatMap((side) => h.holding[side]?.item ?? []));
    for (const item of items) {
      if (item.supported || item.wornBy || item.moved(f.time)) continue;
      const at = passive(item, f);
      item.move(f.time, at.position, at.quaternion);
      for (const side of SIDES) {
        const held = h.holding[side];
        if (held?.item !== item) continue;
        handStep(h, f, side, gripOf(item, held.grip), { on: item, ...HOLD }, arms[side]);
      }
    }
  };
}
