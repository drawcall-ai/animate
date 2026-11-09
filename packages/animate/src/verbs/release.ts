import { Object3D } from 'three';
import { selfOf, type Body, type ByHand } from '../body';
import { letGo, type Released } from '../body/let-go';
import type { AnySpecies } from '../species/define';
import { handsOn } from '../things/hold';
import { Thing } from '../things/thing';
import { Missed, siteOf } from './story';

/**
 * Lets go, at once (no `yield*`). Given a thing, every hand of the body holding it lets go of it; given hands by name (`{ right: rope }`),
 * those hands let go of what each names and the body's others keep holding (one hand left on a thing it carried carries it alone; one left on what
 * stayed where it is, a rifle on its mount, a fixed rail, keeps hold of it there). A thing no hand of the body holds any more is attached onto the empty
 * `onto` (set there exactly, turned as it is, if a carry there would call it there: within 1.5 cm), else to another body still holding it (that body carries it now), else, if a hand
 * lifted it, left in the world where it is (under the scene's root; take it into your physics from there), else where it is. The hands
 * that let go back out of it, carrying on the way they were going; a fingertip draws back off its button the way it came, and a hand verb
 * for it waits until it has. Returns how the thing (the first named) was moving as it left the hand: to throw it, let go while a carry
 * still moves it and give that motion to your physics. Hands named in `keep` (`{ left: true }`) keep hold of a thing put onto `onto`: it
 * rests there, moved with its place, and they follow it (a magazine let onto its place under the well, then pushed home by its parent).
 * Put onto an empty further off, it throws `Missed` with the thing let go where it is there, under the empty; onto an empty another
 * thing sits in, it throws at once: nothing lets go. It is no verb: its `Missed` is thrown at the call, so `attempt` cannot take it; use `try`.
 */
export function release<S extends AnySpecies>(body: Body<S>, thing: Object3D, onto?: Object3D, keep?: ByHand<S, true>): Released;
export function release<S extends AnySpecies>(body: Body<S>, hands: ByHand<S, Object3D>): Released;
export function release(body: Body, which: Object3D | Partial<Record<string, Object3D>>, onto?: Object3D, keep: Partial<Record<string, true>> = {}): Released {
  const self = selfOf(body);
  if (which instanceof Object3D) {
    const held = Thing.of(which), hands = handsOn(self, held), kept = Object.keys(keep);
    if (!hands.length) throw new Error(`release: no hand of the body holds "${which.name}"`);
    if (kept.length && !onto) throw new Error('release: hands keep hold of a thing only as it is put onto an empty');
    for (const hand of kept) if (!hands.includes(hand)) throw new Error(`release: the ${hand} hand does not hold "${which.name}" to keep`);
    const { motion, miss } = letGo(self, held, hands.filter((hand) => !kept.includes(hand)), onto);
    if (miss) throw new Missed('release', siteOf(new Error().stack), miss);
    return motion;
  }
  const named = Object.entries(which).flatMap(([hand, thing]) => thing ? [{ hand, thing: Thing.of(thing) }] : []);
  if (!named.length) throw new Error('release: name a hand and what it holds');
  for (const { hand, thing } of named) {
    if (!(hand in self.holding)) throw new Error(`release: the body has no hand "${hand}"`);
    if (self.holding[hand]?.thing !== thing) throw new Error(`release: the ${hand} hand does not hold "${thing.object.name}"`);
  }
  const released = [...new Set(named.map(({ thing }) => thing))].map((thing) => letGo(self, thing, named.filter((n) => n.thing === thing).map((n) => n.hand)).motion);
  return released[0];
}
