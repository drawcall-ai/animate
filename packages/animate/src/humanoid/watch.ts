import { watch } from '../core/dev';
import type { Item } from '../core/carrier';
import type { Behaviour } from '../core/goal';
import type { Body } from '../core/body';
import { gazeOff } from '../core/gaze';
import { heldItems } from '../core/worn';

/**
 * Eyes should lead a new grip by seconds (0.4–0.6 s in Land, Mennie & Rusted 1999).
 * Compose before the story so holding still describes the previous final pose. Taking
 * one's own worn item by feel is excluded. The head's comfortable eye range allows the
 * eyes to look within the head: down further than up or aside (its gaze's range).
 */
export function eyesOnBefore(h: Body, item: Item, seconds: number): Behaviour {
  const gazer = h.gazer;
  if (!gazer) throw new Error('eyesOnBefore: the body has no gaze');
  return function* () {
    let since: number | null = null;
    let held = false;
    yield* watch('eyesOnBefore', (f) => {
      const on = gazeOff(gazer, f.prev, item.current.position) === 0;
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
