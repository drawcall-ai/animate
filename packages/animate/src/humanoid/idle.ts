import { action, parallel } from '@pmndrs/timeline';
import type { Frame } from '../core/body';
import type { Behaviour } from '../core/goal';
import { hangArms } from './arms';
import { balance } from './balance/balance';
import type { Humanoid } from './humanoid';
import { lookAround } from './look';
import type { Stance } from './stance';
import { Legs } from '../core/legs/legs';
import { createAsks, takeAsks } from './asks';
import { checkSupport } from './balance/checks';
import { humanGait, humanLegs } from './legs';

/**
 * The humanoid's base, endless, root to tip: `balance` (root, legs, trunk), `hangArms`,
 * `lookAround`. Run the tasks after it, in parallel: what a task writes wins, and what it lets go
 * of these take back on from where it is. `seed` fixes the variation of sway, breathing and spontaneous weight shifts.
 */
export function idle<W>(h: Humanoid<W>, options: { stance?: Partial<Stance>; seed?: number; legs?: 'old' | 'core' } = {}): Behaviour<W> {
  return function* () {
    if (options.legs === 'core') return yield* parallel<Frame<W>>('all', core(h), hangArms(h), lookAround(h, { seed: options.seed }));
    yield* parallel<Frame<W>>('all', balance(h, options), hangArms(h), lookAround(h, { seed: options.seed }));
  };
}

// Temporary stage 0 adapter: posture and h.feet/h.gait publication follow in later stages.
function core<W>(h: Humanoid<W>): Behaviour<W> {
  return function* () {
    const legs = new Legs(h.pose, humanLegs(h.proportions), humanGait(h.proportions));
    const asks = createAsks();
    yield* action<Frame<W>>({ update: (f) => {
      if (f.dev) checkSupport(h, f, f.dev);
      const { go } = takeAsks(h.asks, asks);
      if (go) legs.toward(f, { position: go.to, velocity: go.velocity }, go);
      else {
        const position = f.current.position(0).clone(), quaternion = f.current.rotation(0).clone();
        legs.update(f, { speed: 0, root: () => ({ position, quaternion }) });
      }
    } });
  };
}
