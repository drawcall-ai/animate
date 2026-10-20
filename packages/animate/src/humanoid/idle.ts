import { parallel } from '@pmndrs/timeline';
import type { Frame } from '../core/body';
import type { Behaviour, Live } from '../core/goal';
import { hangArms } from './arms';
import { balance } from './balance/balance';
import { driven } from './driven';
import type { DrivenRoot } from '../core/legs/stepper';
import type { Humanoid } from './humanoid';
import { lookAround } from './look';
import type { Stance } from '../core/asks';
import { stride } from './stride';

/** Not public: the legs `idle` stands and walks on until the core engine replaces `balance` (the parity tests compare the two). */
export const legSystem: { path: 'old' | 'core' } = { path: 'old' };

/**
 * The humanoid's base, endless, root to tip: `balance` (root, legs, trunk), `hangArms`,
 * `lookAround`. Run the tasks after it, in parallel: what a task writes wins, and what it lets go
 * of these take back on from where it is. `seed` fixes the variation of sway, breathing and spontaneous weight shifts.
 * `root`: the scene owns the root (a player), `driven` legs keep up with it instead of `balance`.
 */
export function idle<W>(h: Humanoid<W>, options: { stance?: Partial<Stance>; seed?: number; root?: Live<DrivenRoot, W> } = {}): Behaviour<W> {
  const { root } = options, path = legSystem.path;
  return function* () {
    const legs = root ? driven(h, root) : path === 'core' ? stride(h, options) : balance(h, options);
    yield* parallel<Frame<W>>('all', legs, hangArms(h), lookAround(h, { seed: options.seed }));
  };
}
