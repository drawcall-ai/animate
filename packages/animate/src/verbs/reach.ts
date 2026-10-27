import { selfOf, type Body, type HandOf } from '../body/body';
import type { AnySpecies } from '../species/define';
import { finder, type Target } from './targets';
import { verb, type Until, type Verb } from './story';

/** How a reach goes. */
export interface ReachOptions {
  /** the hand's speed (m/s; default the time a calm reach that far takes, Fitts') */
  speed?: number;
  /** its acceleration with `speed` (m/s²) */
  accel?: number;
  /** ends on this instead of arriving: a target that moves is followed until then */
  until?: Until;
}

/**
 * Reaches each hand named to its target (an `Object3D` turns the hand as it is turned), taking nothing: from where it stands if the arms
 * reach them, else it walks up first (borrowed legs), its eyes on the targets (borrowed), the hands going as it arrives (asked), the body
 * turning, bowing, bending or rising on its toes for them. A mover, it ends once the hands are there and keeps them there. It returns `false` if it can stand nowhere in reach.
 */
export function reach<S extends AnySpecies>(body: Body<S>, targets: Partial<Record<HandOf<S>, Target>>, options: ReachOptions = {}): Verb {
  const named = Object.entries<Target | undefined>(targets).flatMap(([hand, target]) => target === undefined ? [] : [{ hand, target }]);
  if (!named.length) throw new Error('reach: name a target for a hand');
  return verb(body, 'reach', (request) => function* () {
    const self = selfOf(body);
    yield* self.handling.reach(request, named.map(({ hand, target }) => ({ hand, target: finder(self, target) })), options);
  }, options.until);
}
