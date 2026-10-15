import type { Vector3 } from 'three';
import type { Frame } from '../../core/body';
import type { Item } from '../../core/carrier';
import type { Behaviour, Target } from '../../core/goal';
import { INDEX, SIDES, type Side } from '../bones';
import type { Humanoid } from '../humanoid';

// Grips: what each hand takes hold of, and the hands closing and opening on them.

/** Which of an item's grips each hand takes (by name). */
export type Grips = Partial<Record<Side, string>>;

/** What each hand takes hold of: an item, by which of its grips. */
export type Holds = Partial<Record<Side, readonly [Item, string]>>;

/** Hand `side` open (a stub: the hand has no fingers yet): holding nothing, at once. */
export function openHand<W>(h: Humanoid<W>, side: Side): Behaviour<W> {
  return function* () {
    h.holding[side] = null;
  };
}

/** Hand `side` closed on `item`'s grip `grip` (a stub: marked held at once, no fingers yet). */
export function closeHand<W>(h: Humanoid<W>, side: Side, item: Item, grip: string): Behaviour<W> {
  return function* () {
    h.holding[side] = { item, grip };
  };
}

/** the holds, side by side */
export function held(holds: Holds) {
  return SIDES.flatMap((side) => {
    const hold = holds[side];
    return hold ? [{ side, item: hold[0], grip: hold[1] }] : [];
  });
}

/** grip `name` of `item`: a target in its frame */
export function gripOf(item: Item, name: string): Target {
  const g = item.grips[name];
  if (!g) throw new Error(`"${item.name}" has no grip "${name}"`);
  return g;
}

/** the name of the grip hand `side` takes (it must take one) */
export function grip(grips: Grips, side: Side): string {
  const name = grips[side];
  if (name === undefined) throw new Error(`no grip for the ${side} hand`);
  return name;
}

/** Grips of one item currently taken by this body. */
export function gripsOf<W>(h: Humanoid<W>, item: Item): Grips {
  return Object.fromEntries(SIDES.flatMap((side) => h.holding[side]?.item === item ? [[side, h.holding[side]?.grip]] : []));
}

/** Held items, counting a two-handed load once. */
export function heldItems<W>(h: Humanoid<W>): Item[] {
  return [...new Set(SIDES.flatMap((side) => h.holding[side]?.item ?? []))];
}

/** Grip errors in the completed pose. */
export function offGrips<W>(f: Frame<W>, hands: readonly { side: Side; item: Item; grip: string; at: Readonly<Vector3> }[]): string[] {
  return hands.map(({ side, item, grip, at }) => {
    return `"${item.name}" ${side} grip "${grip}": ${f.prev.position(INDEX[`${side}Hand`]).distanceTo(at).toFixed(3)} m off`;
  });
}
