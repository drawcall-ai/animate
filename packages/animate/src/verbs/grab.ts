import { Vector3, type Object3D } from 'three';
import { selfOf, type Body, type ByHand } from '../body/body';
import { bodyOf } from '../things/hold';
import { Thing } from '../things/thing';
import type { AnySpecies } from '../species/define';
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
 * reaches the grips or the hand turn remains unmet after the planned reach plus four seconds. Grips set position only by default:
 * `userData.handTurn = true` takes the empty’s orientation; an axis [x, y, z] allows roll about that line in its frame.
 */
export function grab<S extends AnySpecies>(body: Body<S>, thing: Object3D, grips: ByHand<S, string>, options: GrabOptions = {}): Verb {
  const named = Object.entries<string | undefined>(grips).flatMap(([hand, grip]) => grip === undefined ? [] : [{ hand, grip }]);
  if (!named.length) throw new Error('grab: name a grip for a hand');
  return verb(body, 'grab', (request) => function* () {
    const self = selfOf(body), held = Thing.of(thing), on = bodyOf(thing);
    if (on) self.meet(on);
    for (const { grip } of named) checkScale(self.frame, held.grip(grip).node);
    yield* self.handling.take(request, held, named, options);
  }, options.until);
}

/** development: a grip whose world scale is not uniform has no one turn a hand can take */
function checkScale(f: { time: number; dev?: { append(time: number, problem: { check: string; value: number; limit: number; where: string }): void } }, node: Object3D): void {
  if (!f.dev) return;
  node.updateWorldMatrix(true, false);
  const scale = new Vector3().setFromMatrixScale(node.matrixWorld), spread = Math.max(scale.x, scale.y, scale.z) / Math.min(scale.x, scale.y, scale.z) - 1;
  if (spread > 1e-6) f.dev.append(f.time, { check: 'grip with a non-uniform world scale (spread)', value: spread, limit: 0, where: node.name });
}
