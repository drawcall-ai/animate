import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../../core/body';
import type { Carrier, Item } from '../../core/carrier';
import { ChainTip } from '../../core/tip';
import { handStep } from '../arms';
import { INDEX, SIDES, type Side } from '../bones';
import type { Humanoid } from '../humanoid';
import { grip, gripOf, gripsOf, heldItems, type Grips } from './grips';

const aims = new WeakMap<object, Map<Item, Carrier>>();

export function carryAims(h: object): Map<Item, Carrier> {
  let items = aims.get(h);
  if (!items) aims.set(h, items = new Map());
  return items;
}

const HOLD = { accel: 30, speed: 3, turnAccel: 200, turnSpeed: 15 };

/** One owner of held hands and carried-item fitting, after all body and item movers. */
export function followHeld<W>(h: Humanoid<W>): (f: Frame<W>) => void {
  const arms = { left: new ChainTip('leftArm'), right: new ChainTip('rightArm') };
  return (f) => {
    for (const item of heldItems(h)) {
      const aim = carryAims(h).get(item);
      if (!aim && !item.supported && !item.wornBy && !item.moved(f.time)) {
        const turn = new Quaternion().copy(f.current.rotation(0)).multiply(new Quaternion().copy(f.prev.rotation(0)).invert());
        const at = item.current.position.clone().sub(f.prev.position(0)).applyQuaternion(turn).add(f.current.position(0));
        item.move(f.time, at, turn.multiply(item.current.quaternion));
      }
      const grips = gripsOf(h, item);
      const sides = SIDES.filter((side) => grips[side] !== undefined);
      for (const side of sides) {
        const bones = [INDEX[`${side}Shoulder`], ...f.current.skeleton.chain(`${side}Arm`)];
        if (bones.some((bone) => !f.current.local(bone).equals(f.prev.local(bone)))) continue;
        handStep(h, f, side, gripOf(item, grip(grips, side)), { on: aim ?? item, ...HOLD, lead: !item.wornBy }, arms[side]);
      }
      if (aim) fit(f, item, aim, grips, sides);
    }
    carryAims(h).clear();
  };
}

/**
 * `item` moved (at `f`'s time) where the wrists hold it: as `aim` has it, carried along with the
 * wrists — turned so the line between two grips lies along the line between the wrists, moved so
 * their middle is the wrists' middle
 */
function fit<W>(f: Frame<W>, item: Item, aim: Carrier, grips: Grips, sides: readonly Side[]) {
  const at = (side: Side, out: Vector3) => out.copy(gripOf(item, grip(grips, side)).position).applyQuaternion(aim.current.quaternion).add(aim.current.position);
  const wrist = (side: Side, out: Vector3) => out.copy(f.current.position(INDEX[`${side}Hand`]));
  const turn = _turn.identity();
  if (sides.length === 2) {
    const held = _a.subVectors(at('right', _g1), at('left', _g2)).normalize();
    const hands = _b.subVectors(wrist('right', _w1), wrist('left', _w2)).normalize();
    turn.setFromUnitVectors(held, hands);
  }
  const middle = _m.set(0, 0, 0);
  const hands = _h.set(0, 0, 0);
  for (const side of sides) {
    middle.add(at(side, _g1));
    hands.add(wrist(side, _w1));
  }
  middle.divideScalar(sides.length);
  hands.divideScalar(sides.length);
  const position = _p.subVectors(aim.current.position, middle).applyQuaternion(turn).add(hands);
  item.move(f.time, position, _q.copy(turn).multiply(aim.current.quaternion));
}

const _p = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _m = new Vector3();
const _h = new Vector3();
const _g1 = new Vector3();
const _g2 = new Vector3();
const _w1 = new Vector3();
const _w2 = new Vector3();
const _q = new Quaternion();
const _turn = new Quaternion();
