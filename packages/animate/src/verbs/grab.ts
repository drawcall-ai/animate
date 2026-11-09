import { Vector3, type Object3D } from 'three';
import { selfOf, type Body, type ByHand } from '../body';
import { bodyOf } from '../things/hold';
import type { Self } from '../body/self';
import { Thing } from '../things/thing';
import type { AnySpecies } from '../species/define';
import { verb, type Verb } from './story';
import { letGo } from '../body/let-go';
import type { GrabOptions } from '../body/hand-staging';
import { personOf } from './person-of';
import { holdingAtOnce } from '../person/hands/grab';
import type { Request } from '../kernel/requests';

/**
 * Takes hold of `thing` with each hand named in `grips` by an empty under the thing (`{ right: 'handle' }`; the thing's own name: its
 * origin): it walks up to stand in reach (borrowed legs; with `step: false` it stays where it stands), its eyes find the grips first
 * (borrowed), its hands rise before it arrives and reach them as it does (asked), the body bowing and bending as low as they are. It picks
 * where to stand once, as it starts, from where its feet and the grips are then: a thing still moving, or feet still walking, gives a
 * stand for where they were; with no particular place to stand, leave the walking to it. A mover, it ends holding, its fingers closed. A
 * named hand that holds something else lets go of it as it sets off, as `release` would (what the body wears, a rifle on its mount, stays
 * there, held by any other hand on it). A loose thing with a mass (on no body) is lifted clear of what it rests on; anything else — a part
 * of what the other hand holds, a pouch's magazine — stays where it is, and the hands follow it. If no stand reaches the grips (with
 * `step: false`: they are out of reach from where it stands), the hands go as far as they can for as long as a reach there takes, the eyes on
 * them, and it throws `Missed`; as it does if a hand stops getting nearer its unmet position or turn
 * once the planned reach is over (or is still off it four seconds on), or if a pad a facing fixes has not come within 1 cm of its grip by the
 * time its turn is made up (up to 0.4 s after it touches: the grab waits for that). What each empty asks of the hand (`grip`) is fixed as the
 * grab starts, within what its grip leaves free, from where the body stands, and the hand keeps it on the thing while it holds it. Given
 * `until`, it returns `true` if every hand holds its grip as that ends, else `false`. With `already`, a person's story starts holding it (`GrabOptions`).
 */
export function grab<S extends AnySpecies>(body: Body<S>, thing: Object3D, grips: ByHand<S, string>, options: GrabOptions = {}): Verb {
  const named = Object.entries<string | undefined>(grips).flatMap(([hand, grip]) => grip === undefined ? [] : [{ hand, grip }]);
  if (!named.length) throw new Error('grab: name a grip for a hand');
  if (options.speed !== undefined && !(options.speed > 0 && options.speed < Infinity)) throw new Error(`grab: a speed of ${options.speed}`);
  if (options.already && options.speed !== undefined) throw new Error('grab: already holding it, the hands have no way to go at a `speed`: give one or the other');
  const self = selfOf(body);
  // (as it starts: what its hands hold else let go, the grips looked over)
  const starting = (request: Request) => {
    const held = Thing.of(thing), on = bodyOf(thing), hands = Object.keys(self.hands);
    for (const { hand } of named) if (!hands.includes(hand)) throw new Error(`grab: a ${body.species.name ?? 'custom species'} has no hand "${hand}", only ${hands.join(', ') || 'none'}`);
    // (a named hand holding something else lets go of it first, as `release` would, without backing out)
    for (const { hand } of named) {
      const was = self.holding[hand]?.thing;
      if (was && was !== held) letGo(self, was, [hand], undefined, false);
    }
    if (on) self.meet(on);
    if (on && on !== self) checkShared(on, held, named);
    for (const { grip } of named) checkGrip(self, held, held.grip(grip).node);
    request.there = () => named.every(({ hand, grip }) => self.holding[hand]?.thing === held && self.holding[hand]?.grip === grip);
    return held;
  };
  if (options.already) {
    const person = personOf(body, 'grab already');
    return verb(body, 'grab', () => function* () {}, { until: options.until, first: (request) => holdingAtOnce(person, request, starting(request), named) });
  }
  return verb(body, 'grab', (request) => function* () {
    yield* self.handStaging.take(request, starting(request), named, options);
  }, { until: options.until });
}

/** a grip another body's hand holds: two hands cannot be on one spot (a hand-over gives the taker grips of its own) */
function checkShared(holder: Self, thing: Thing, named: readonly { hand: string; grip: string }[]): void {
  for (const { grip } of named) {
    const hand = Object.keys(holder.holding).find((side) => holder.holding[side]?.thing === thing && holder.holding[side]?.grip === grip);
    if (hand === undefined) continue;
    throw new Error(`grab: "${grip}" of "${thing.object.name}" is under ${holder.object.name || 'another body'}'s ${hand} hand: two hands cannot share a spot, so give the taker a grip of its own`);
  }
}

/** what a grip reads: what a grip asks, what its hand's way to it asks, what a carry's end takes, what a model's loader leaves */
const GRIP_KEYS = new Set(['handle', 'facing', 'radius', 'length', 'point', 'digits', 'mass', 'centre', 'approach', 'speed', 'name', 'gltfExtensions']);

/** a key on an empty that no grip reads may be a typo, or an artist's extras or data of the app's: said once. A grip's world scale must be
 * uniform: else it has no one turn a hand can take. (A thing gripped by its own name is the app's own object, its data its own.) */
function checkGrip(self: Self, thing: Thing, node: Object3D): void {
  if (node !== thing.object) for (const key of Object.keys(node.userData)) {
    if (!GRIP_KEYS.has(key)) self.warn(`grip key ${key}`, `grip "${node.name}" has userData.${key}, which nothing reads: a grip takes handle, facing, radius, length, point, digits, approach and speed (\`grip\`). A typo?`);
  }
  node.updateWorldMatrix(true, false);
  const scale = new Vector3().setFromMatrixScale(node.matrixWorld), spread = Math.max(scale.x, scale.y, scale.z) / Math.min(scale.x, scale.y, scale.z) - 1;
  if (spread > 1e-6) throw new Error(`grab: grip "${node.name}" has a non-uniform world scale, so no one turn a hand can take: scale it evenly`);
}
