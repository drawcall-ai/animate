import { parallel } from '@pmndrs/timeline';
import type { Frame } from '../core/body';
import type { Behaviour } from '../core/goal';
import { hangArms } from './arms';
import { balance } from './balance/balance';
import type { Humanoid } from './humanoid';
import { lookAround } from './look';
import type { Stance } from './stance';
import { stride } from './stride';

/**
 * The humanoid's base, endless, root to tip: `balance` (root, legs, trunk), `hangArms`,
 * `lookAround`. Run the tasks after it, in parallel: what a task writes wins, and what it lets go
 * of these take back on from where it is. `seed` fixes the variation of sway, breathing and spontaneous weight shifts.
 */
export function idle<W>(h: Humanoid<W>, options: { stance?: Partial<Stance>; seed?: number; legs?: 'old' | 'core' } = {}): Behaviour<W> {
  return function* () {
    if (options.legs === 'core') return yield* parallel<Frame<W>>('all', stride(h, options), hangArms(h), lookAround(h, { seed: options.seed }));
    yield* parallel<Frame<W>>('all', balance(h, options), hangArms(h), lookAround(h, { seed: options.seed }));
  };
}
