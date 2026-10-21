import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../../core/body';
import { gripOf, type Carrier, type Item } from '../../core/carrier';
import { REACHED, type Target } from '../../core/goal';
import { ChainTip } from '../../core/tip';
import { handStep } from '../arms';
import { INDEX, SIDES, type Side } from '../bones';
import type { Humanoid } from '../humanoid';
import { grip, gripsOf, type Grips } from './grips';
import { heldItems } from '../../core/worn';

/** Tuned: how briskly a holding hand keeps to its grip as the item or the body moves (m/s², m/s, rad/s², rad/s): a firm hold, far quicker
 * than a reach, so it never trails what it holds */
const HOLD = { accel: 30, speed: 3, turnAccel: 200, turnSpeed: 15 };

/**
 * How far a hand may be from a grip it starts holding (m): a reach ends once the wrist is within
 * `REACHED.distance`, and the same frame's hold step and fit may pull it up to ~2 cm more (tuned
 * against the scenes' grabs, none of which comes closer than 1 cm to this limit).
 */
const GRIP_TAKEN = REACHED.distance + 0.02;

const _taken: Target & { velocity: Vector3; spin: Vector3 } = { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() };

/** One owner of held hands and carried-item fitting, after all body and item movers. */
export function followHeld(h: Humanoid): (f: Frame) => void {
  const arms = { left: new ChainTip('leftArm'), right: new ChainTip('rightArm') };
  const previous: Partial<Record<Side, readonly [Item, string]>> = {};
  return (f) => {
    // Preserve acquisition points before wrist fitting can move an item onto a distant hand.
    const taking = f.dev ? SIDES.flatMap((side) => {
      const held = h.holding[side], was = previous[side];
      previous[side] = held ? [held.item, held.grip] : undefined;
      if (!held || (was?.[0] === held.item && was[1] === held.grip)) return [];
      const { item, grip: name } = held;
      return [{ side, item, name, at: item.toWorld(gripOf(item, name), _taken).position.clone() }];
    }) : [];
    for (const item of heldItems(h)) {
      const aim = h.carrying.get(item);
      // (what another moves — a scene, another body — the hands keep to, the body not coming along for it)
      const moved = item.moved(f.time);
      if (!aim && !item.supported && !item.wornBy && !moved) {
        const turn = new Quaternion().copy(f.current.rotation(0)).multiply(new Quaternion().copy(f.prev.rotation(0)).invert());
        const at = item.current.position.clone().sub(f.prev.position(0)).applyQuaternion(turn).add(f.current.position(0));
        item.move(f.time, at, turn.multiply(item.current.quaternion));
      }
      const grips = gripsOf(h, item);
      const sides = SIDES.filter((side) => grips[side] !== undefined);
      for (const side of sides) {
        const bones = [INDEX[`${side}Shoulder`], ...f.current.skeleton.chain(`${side}Arm`)];
        if (bones.some((bone) => !f.current.local(bone).equals(f.prev.local(bone)))) continue;
        handStep(h, f, side, gripOf(item, grip(grips, side)), { on: aim ?? item, ...HOLD, lead: !item.wornBy && !moved }, arms[side]);
      }
      // (an item another body has moved this sub-step — handed over, both hands on it — that one carries: these keep to it)
      if (aim && !item.moved(f.time)) fit(h, f, item, aim, grips, sides);
      // Worn-item contact has one rigid owner; check after that owner and both arms moved.
      // A carried item instead fits compliant wrists; its course owns endpoint accuracy.
      if (f.dev && item.wornBy) for (const side of sides) {
        const at = item.toWorld(gripOf(item, grip(grips, side)), _taken).position;
        const value = f.current.position(h.hands[side]).distanceTo(at);
        if (value > REACHED.distance) f.dev.append(f.time, { check: 'held grip distance (m)', value, limit: REACHED.distance, where: `${item.name} ${side}` });
      }
    }
    for (const { side, item, name, at } of taking) {
      const value = f.current.position(h.hands[side]).distanceTo(at);
      if (value > GRIP_TAKEN) f.dev?.append(f.time, { check: 'grip activation distance (m)', value, limit: GRIP_TAKEN, where: `${item.name} ${side} ${name}` });
    }
    h.carrying.clear();
  };
}

/**
 * `item` moved (at `f`'s time) where the wrists hold it: as `aim` has it, carried along with the
 * wrists — turned so the line between two grips lies along the line between the wrists, moved so
 * their middle is the wrists' middle
 */
function fit(h: Humanoid, f: Frame, item: Item, aim: Carrier, grips: Grips, sides: readonly Side[]) {
  const at = (side: Side, out: Vector3) => out.copy(gripOf(item, grip(grips, side)).position).applyQuaternion(aim.current.quaternion).add(aim.current.position);
  const wrist = (side: Side, out: Vector3) => out.copy(f.current.position(h.hands[side]));
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
