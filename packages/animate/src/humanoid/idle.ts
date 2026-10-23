import { parallel } from '@pmndrs/timeline';
import type { Frame, IdleOptions } from '../core/body';
import type { Behaviour } from '../core/goal';
import { hangArms } from './arms';
import { driven } from './driven';
import { isPerson, type Humanoid } from './humanoid';
import type { Body } from '../core/body';
import { creature } from '../core/legs/creature';
import { lookAround } from './look';
import { stride } from './stride';

/**
 * A person's base, endless, root to tip: its legs and balance (`stride`: walking where asked; with `root`, the scene owns the root — a
 * player — and the legs keep up with it), its free arms hanging, `lookAround`; the story runs over it: what it writes wins, and what it
 * lets go of these take back on from where it is. `seed` fixes the variation of sway, breathing and spontaneous weight shifts.
 */
export function personIdle(h: Humanoid, options: IdleOptions = {}): Behaviour {
  const { root } = options;
  return function* () {
    const legs = root ? driven(h, root, options.seed) : stride(h, options);
    yield* parallel<Frame>('all', legs, hangArms(h), lookAround(h, { seed: options.seed }));
  };
}

/** A body's base to compose by hand (with `idle: false`): a person's (`personIdle`), else its species' legs and carriage. */
export function idle(body: Body, options: IdleOptions = {}): Behaviour {
  return isPerson(body) ? personIdle(body, options) : creature(body, options.attention, options.root);
}
