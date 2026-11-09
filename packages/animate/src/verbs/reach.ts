import { selfOf, type Body, type ByHand } from '../body';
import type { AnySpecies } from '../species/define';
import { finder, handTarget, type Target } from '../things/target';
import { verb, type Verb } from './story';
import type { HandOptions } from '../body/hand-staging';

/**
 * Reaches each hand named to its target (an `Object3D` turns a person's hand toward its turn as far as the wrist goes, a creature's exactly; `track` holds a person's hand exactly so), taking nothing: from where it stands if
 * it can reach (each target within 0.95 of `species.person.armLength` of its shoulder, as the trunk turns it), else, if it can walk, is
 * not driven and `step` allows, it walks up first (borrowed legs) and stays where it stood, its eyes on the targets (borrowed), the hands
 * going as it arrives (asked), the body turning, bowing, bending or rising on its toes for them. It picks where to stand as it starts, and
 * again whenever a target has moved about 10 cm from where it planned for. A mover, it ends once the hands are there and still, within 1 cm and 2° (or stopped within 1.5 cm: as near as the arm comes);
 * its hold ends with the verb, so `until: Infinity` (raced) stays there. It throws `Missed` if it can stand nowhere in reach (with `step:
 * false`: if it cannot reach from where it stands), or a hand stops getting nearer its unmet position or turn once the planned reach is
 * over (or is still off it four seconds on), balance-support steps aside. Given `until`, a target out of reach for a while is followed on,
 * and it returns `true` if the hands are on their targets as that ends, else `false`.
 */
export function reach<S extends AnySpecies>(body: Body<S>, targets: ByHand<S, Target>, options: HandOptions = {}): Verb {
  const named = Object.entries<Target | undefined>(targets).flatMap(([hand, target]) => target === undefined ? [] : [{ hand, target: handTarget(target, 'reach') }]);
  if (!named.length) throw new Error('reach: name a target for a hand');
  if (options.speed !== undefined && !(options.speed > 0 && options.speed < Infinity)) throw new Error(`reach: a speed of ${options.speed}`);
  return verb(body, 'reach', (request) => function* () {
    const self = selfOf(body);
    yield* self.handStaging.reach(request, named.map(({ hand, target }) => ({ hand, target: finder(self, target) })), options);
  }, { until: options.until });
}
