import { Vector3, type Object3D } from 'three';
import { selfOf, type Body, type HandOf } from '../body/body';
import { bodyOf } from '../body/hold';
import { Thing } from '../body/things';
import type { AnySpecies } from '../core/species';
import { taking } from '../core/hands';
import { Person, sideOf } from '../humanoid/person';
import { grabbing } from '../humanoid/hands/grab';
import { liftingClear } from '../humanoid/hands/carry';
import { verb, type Until, type Verb } from './story';

/** How a grab goes. */
export interface GrabOptions {
  /** the hands' speed to the grips (m/s; default the time a calm reach that far takes, Fitts') */
  speed?: number;
  /** the hands' acceleration with `speed` (m/s²) */
  accel?: number;
  /** ends on this instead of holding */
  until?: Until;
}

/**
 * Takes hold of `thing` with each hand named in `grips` by an empty under the thing (`{ right: 'handle' }`; the thing's own name: its
 * origin): it walks up to stand in reach (borrowed legs), its eyes find the grips first (borrowed), its hands rise before it arrives and
 * reach them as it does (asked), the body bowing and bending as low as they are. A mover, it ends holding. A loose thing with a mass (on
 * no body) is lifted clear of what it rests on; anything else stays where it is, and the hands follow it. It returns `false` if no stand
 * reaches the grips.
 */
export function grab<S extends AnySpecies>(body: Body<S>, thing: Object3D, grips: Partial<Record<HandOf<S>, string>>, options: GrabOptions = {}): Verb {
  const named = Object.entries<string | undefined>(grips).flatMap(([hand, grip]) => grip === undefined ? [] : [{ hand, grip }]);
  if (!named.length) throw new Error('grab: name a grip for a hand');
  return verb(body, 'grab', (request) => function* () {
    const self = selfOf(body), held = Thing.of(thing);
    const loose = held.massive && !bodyOf(thing);
    for (const { grip } of named) checkScale(self.frame, held.grip(grip).node);
    if (!(self instanceof Person)) {
      if (named.length > 1) throw new Error('grab: a creature takes hold with one hand at a time');
      yield* taking(self, request, named[0].hand, held, named[0].grip);
      if (request.outcome !== 'failed') request.met();
      return;
    }
    const takes = named.map(({ hand, grip }) => ({ side: sideOf(hand), thing: held, grip, at: held.grip(grip).at }));
    if (!(yield* grabbing(self, request, takes, options.speed === undefined ? undefined : { speed: options.speed, accel: options.accel }))) return;
    if (loose) yield* liftingClear(self, request, held);
    request.met();
  }, options.until);
}

/** development: a grip whose world scale is not uniform has no one turn a hand can take */
function checkScale(f: { time: number; dev?: { append(time: number, problem: { check: string; value: number; limit: number; where: string }): void } }, node: Object3D): void {
  if (!f.dev) return;
  node.updateWorldMatrix(true, false);
  const scale = new Vector3().setFromMatrixScale(node.matrixWorld);
  const spread = Math.max(scale.x, scale.y, scale.z) / Math.min(scale.x, scale.y, scale.z) - 1;
  if (spread > 1e-6) f.dev.append(f.time, { check: 'grip with a non-uniform world scale (spread)', value: spread, limit: 0, where: node.name });
}
