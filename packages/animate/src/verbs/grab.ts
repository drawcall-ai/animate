import { Vector3, type Object3D } from 'three';
import { selfOf, type Body, type ByHand } from '../body/body';
import { bodyOf } from '../things/hold';
import type { Holder } from '../things/resolve';
import type { Frame } from '../kernel/frame';
import { Thing } from '../things/thing';
import type { AnySpecies } from '../species/define';
import { verb, type Verb } from './story';
import type { HandOptions } from '../hands/handling';

/**
 * Takes hold of `thing` with each hand named in `grips` by an empty under the thing (`{ right: 'handle' }`; the thing's own name: its
 * origin): it walks up to stand in reach (borrowed legs; with `step: false` it stays where it stands), its eyes find the grips first
 * (borrowed), its hands rise before it arrives and reach them as it does (asked), the body bowing and bending as low as they are. It
 * picks where to stand once, as it starts, from where its feet and the grips are then: a thing still moving, or feet still walking,
 * gives a stand for where they were; with no particular place to stand, leave the walking to it. A mover,
 * it ends holding. A loose thing with a mass (on no body) is lifted clear of what it rests on; anything else stays where it is, and the
 * hands follow it. It returns `false` if no stand reaches the grips (with `step: false`: if they are out of reach from where it stands) or
 * the hand position or turn remains unmet after the planned reach plus four seconds. Grips set position only by default (a thing held
 * so in one hand keeps its own turn, the hand's free twist not turning it): `userData.handTurn = true` turns the hand as the empty is
 * turned, as an `Object3D` target does (`Target`); an axis [x, y, z] allows roll about that line in its frame.
 */
export function grab<S extends AnySpecies>(body: Body<S>, thing: Object3D, grips: ByHand<S, string>, options: HandOptions = {}): Verb {
  const named = Object.entries<string | undefined>(grips).flatMap(([hand, grip]) => grip === undefined ? [] : [{ hand, grip }]);
  if (!named.length) throw new Error('grab: name a grip for a hand');
  if (options.speed !== undefined && !(options.speed > 0)) throw new Error(`grab: a speed of ${options.speed}`);
  if (options.speed === Infinity && !body.species.person) throw new Error('grab: `speed: Infinity` is a person’s');
  return verb(body, 'grab', (request) => function* () {
    const self = selfOf(body), held = Thing.of(thing), on = bodyOf(thing);
    if (on) self.meet(on);
    if (on && on !== self) checkShared(self.frame, on, held, named);
    for (const { grip } of named) checkScale(self.frame, held.grip(grip).node);
    yield* self.handling.take(request, held, named, options);
  }, options.until);
}

/** development: a grip another body's hand holds: two hands cannot be on one spot (a hand-over gives the taker grips of its own) */
function checkShared(f: Frame, holder: Holder, thing: Thing, named: readonly { hand: string; grip: string }[]): void {
  for (const { grip } of named) {
    const hand = Object.keys(holder.holding).find((side) => holder.holding[side]?.thing === thing && holder.holding[side]?.grip === grip);
    if (hand === undefined) continue;
    const name = holder.object.name || 'another body';
    f.dev?.append(f.time, { check: 'grip another body’s hand holds', value: 1, limit: 0, where: `${thing.object.name} ${grip}: ${name}’s ${hand} hand` });
  }
}

/** development: a grip whose world scale is not uniform has no one turn a hand can take */
function checkScale(f: { time: number; dev?: { append(time: number, problem: { check: string; value: number; limit: number; where: string }): void } }, node: Object3D): void {
  if (!f.dev) return;
  node.updateWorldMatrix(true, false);
  const scale = new Vector3().setFromMatrixScale(node.matrixWorld), spread = Math.max(scale.x, scale.y, scale.z) / Math.min(scale.x, scale.y, scale.z) - 1;
  if (spread > 1e-6) f.dev.append(f.time, { check: 'grip with a non-uniform world scale (spread)', value: spread, limit: 0, where: node.name });
}
