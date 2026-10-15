import { watch } from '../core/dev';
import type { Item } from '../core/carrier';
import type { Behaviour } from '../core/goal';
import type { Humanoid } from './humanoid';
import { gazeOff } from '../core/gaze';
import { heldItems } from './hands/grips';

/**
 * Eyes should lead a new grip by seconds (0.4–0.6 s in Land, Mennie & Rusted 1999).
 * Compose before the story so holding still describes the previous final pose. Taking
 * one's own worn item by feel is excluded. The head's comfortable eye range allows the
 * eyes to look within the head: down further than up or aside (see Humanoid's gazer).
 */
export function eyesOnBefore<W>(h: Humanoid<W>, item: Item, seconds: number): Behaviour<W> {
  return function* () {
    let since: number | null = null;
    let held = false;
    yield* watch<W>('eyesOnBefore', (f) => {
      const on = gazeOff(h.gazer, f.prev, item.current.position) === 0;
      if (on) since ??= f.time;
      else since = null;
      const holding = heldItems(h).includes(item);
      const took = holding && !held;
      held = holding;
      if (!took || item.wornBy === h) return null;
      const value = since === null ? 0 : f.time - since;
      return value + 1e-9 < seconds ? { check: 'gaze lead shortfall (s)', value: seconds - value, limit: 0, where: 'head' } : null;
    })();
  };
}
