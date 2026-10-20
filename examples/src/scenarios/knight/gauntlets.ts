import { Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { handTo, hold, INDEX, facingAt, onItem, wear, type Behaviour, type Frame, type Item, type Side, type Spot } from '@drawcall/animate';
import { headingOf } from '../../../../packages/animate/src/core/math';
import { along, at, eyesOn, take, turn, type Knight } from './knight';

type F = Frame;

/** where the other hand holds a gauntlet open for hand `side` (its wrist, in the chest's frame): before the belly, fingers ahead and 20° across, palm down */
const heldOpen = (side: Side) => {
  const s = side === 'left' ? 1 : -1;
  return at(0.07 * s, -0.17, 0.36, turn(0, (-110 * s * Math.PI) / 180, 0));
};

/**
 * A gauntlet on hand `side`: the other hand takes it off the table by its cuff (it lies on that
 * hand's side, fingers away: he faces the way they point) and holds it open before the belly; the
 * hand goes to its mouth and slides in (slowly, in line); worn on that hand, home on it. The other
 * hand is left holding the cuff: it lets go as the next thing sets off (`flow`).
 */
export function don(k: Knight, gauntlet: Item, side: Side, spot: Spot): Behaviour {
  const other: Side = side === 'left' ? 'right' : 'left';
  const fingers = new Vector3(side === 'left' ? 1 : -1, 0, 0).applyQuaternion(gauntlet.current.quaternion);
  return function* () {
    yield* take(k, { [other]: [gauntlet, 'cuff'] }, { face: headingOf(fingers.x, fingers.z), spot: { ...spot, aside: side === 'left' ? -0.1 : 0.1 } })();
    yield* along(k, gauntlet, [[1.0, heldOpen(side)]], { frame: facingAt(k.h, INDEX.chest, { position: new Vector3() }) })();
    const open = facingAt(k.h, INDEX.chest, heldOpen(side));
    yield* eyesOn(k, () => gauntlet.current.position, () => parallel<F>('race', slideIn(k, side, gauntlet, 'mouth', 'inside'), hold(k.h, gauntlet, { to: open })))();
    yield* wear(k.h, gauntlet, INDEX[`${side}Hand`], { to: { position: new Vector3(), quaternion: new Quaternion() } })();
  };
}

/**
 * Hand `side` into `item` (a gauntlet, a shield's straps): to its grip `entry`, in line, then slowly
 * on to its grip `inside` (fine work: a third of a reach's pace), turning as they say; until the
 * wrist is there (within 1 cm: the hand's turn is as near as the arm takes it). Not there within
 * SLIDING s, it throws.
 */
export function slideIn(k: Knight, side: Side, item: Item, entry: string, inside: string): Behaviour {
  const off = (grip: string) => (f: F) => f.prev.position(INDEX[`${side}Hand`]).distanceTo(onItem(item, item.grips[grip])(f).position);
  const until = (grip: string, within: number) => (f: F, _: unknown, time: number) => {
    if (off(grip)(f) < within) return true;
    if (time > SLIDING) throw new Error(`the ${side} hand did not get to the grip "${grip}" in ${SLIDING} s`);
    return false;
  };
  return function* () {
    yield* handTo(k.h, side, item.grips[entry], { on: item, until: until(entry, 0.02) })();
    yield* handTo(k.h, side, item.grips[inside], { on: item, accel: 3, speed: 0.4, until: until(inside, 0.01) })();
  };
}

const SLIDING = 4;
