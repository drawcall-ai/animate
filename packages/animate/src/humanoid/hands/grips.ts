import type { Item } from '../../core/carrier';
import type { Behaviour } from '../../core/goal';
import type { Grips } from '../../core/hands';
import { SIDES, type Side } from '../bones';
import type { Humanoid } from '../humanoid';

// Grips: what each hand takes hold of, and the hands closing and opening on them.

/** Which of an item's grips each hand takes (by name). */
export type ItemGrips = Partial<Record<Side, string>>;


/** Hand `side` open (a stub: the hand has no fingers yet): holding nothing, at once. */
export function openHand(h: Humanoid, side: Side): Behaviour {
  return function* () {
    h.holding[side] = null;
  };
}

/** Hand `side` closed on `item`'s grip `grip` (a stub: marked held at once, no fingers yet). */
export function closeHand(h: Humanoid, side: Side, item: Item, grip: string): Behaviour {
  return function* () {
    h.holding[side] = { item, grip };
  };
}

/** a person's holds, side by side */
export function held(holds: Grips) {
  for (const hand of Object.keys(holds)) if (!(SIDES as readonly string[]).includes(hand)) throw new Error(`a person has no hand "${hand}"`);
  return SIDES.flatMap((side) => {
    const hold = holds[side];
    return hold ? [{ side, item: hold[0], grip: hold[1] }] : [];
  });
}

/** the name of the grip hand `side` takes (it must take one) */
export function grip(grips: ItemGrips, side: Side): string {
  const name = grips[side];
  if (name === undefined) throw new Error(`no grip for the ${side} hand`);
  return name;
}

/** the grips of one item this body has taken, by side */
export function gripsOf(h: Humanoid, item: Item): ItemGrips {
  return Object.fromEntries(SIDES.flatMap((side) => h.holding[side]?.item === item ? [[side, h.holding[side]?.grip]] : []));
}

