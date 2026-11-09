import { Object3D, Vector3 } from 'three';
import { selfOf, type Body, type ByHand } from '../body/body';
import type { AnySpecies } from '../species/define';
import { attach, bodyOf, carriedBy, grasp, handsOn, take } from '../things/hold';
import { backOff } from '../hands/person/press';
import { END } from '../hands/person/travel';
import { STEP } from '../kernel/frame';
import { personOf } from '../body/person';
import type { Self } from '../body/runtime';
import { Thing } from '../things/thing';
import { spinOf } from '../kernel/rotation';
import type { Miss } from '../kernel/requests';
import { Missed, siteOf } from './story';

/** how near an empty a thing put onto it must be (m): nearer, it is set exactly there — as near as a carry there leaves it at rest (`END`,
 * read a sub-step before), a sub-step on */
const ONTO = END.distance + END.speed * STEP;

/** How a thing was moving as it was let go (world): its velocity (m/s) and its spin (rad/s about the world's axes). */
export interface Released {
  velocity: Vector3;
  spin: Vector3;
}

/**
 * Lets go, at once (no `yield*`). Given a thing, every hand of the body holding it lets go of it; given hands by name (`{ right: rope }`),
 * those hands let go of what each names and the body's others keep holding (one hand left on a thing it carried carries it alone; one left on what
 * stayed where it is, a rifle on its mount, a fixed rail, keeps hold of it there). A thing no hand of the body holds any more is attached onto the empty
 * `onto` (set there exactly if it is within 5 mm), else to another body still holding it (that body carries it now), else, if a hand
 * lifted it, left in the world where it is (under the scene's root; take it into your physics from there), else where it is. The hands
 * that let go back out of it, carrying on the way they were going; a fingertip draws back off its button the way it came, and a hand verb
 * for it waits until it has. Returns how the thing (the first named) was moving as it left the hand: to throw it, let go while a carry
 * still moves it and give that motion to your physics. Hands named in `keep` (`{ left: true }`) keep hold of a thing put onto `onto`: it
 * rests there, moved with its place, and they follow it (a magazine let onto its place under the well, then pushed home by its parent).
 * Put onto an empty more than 5 mm off, it throws `Missed` with the thing let go where it is there, under the empty; onto an empty another
 * thing sits in, it throws at once: nothing lets go.
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
    return letGo(self, held, hands.filter((hand) => !kept.includes(hand)), onto);
  }
  const named = Object.entries(which).flatMap(([hand, thing]) => thing ? [{ hand, thing: Thing.of(thing) }] : []);
  if (!named.length) throw new Error('release: name a hand and what it holds');
  for (const { hand, thing } of named) {
    if (!(hand in self.holding)) throw new Error(`release: the body has no hand "${hand}"`);
    if (self.holding[hand]?.thing !== thing) throw new Error(`release: the ${hand} hand does not hold "${thing.object.name}"`);
  }
  const released = [...new Set(named.map(({ thing }) => thing))].map((thing) => letGo(self, thing, named.filter((n) => n.thing === thing).map((n) => n.hand)));
  return released[0];
}

/** `self`'s `hands` letting go of `thing` (see `release`), and backing out of it unless they go on to something else (`backOut`
 * false): how it was moving as they did */
export function letGo(self: Self, thing: Thing, hands: readonly string[], onto?: Object3D, backOut = true): Released {
  const f = self.frame, object = thing.object, trail = self.track(object).at(f.time);
  const released = { velocity: new Vector3().subVectors(trail.current.position, trail.prev.position).divideScalar(f.dt), spin: spinOf(trail.prev.quaternion, trail.current.quaternion, f.dt, new Vector3()) };
  const placed = trail.current;
  if (onto && onto.children.some((child) => child !== object && child.userData.mass !== undefined)) throw new Error(`release: "${onto.name}" holds another thing already, so "${object.name}" cannot go onto it`);
  // (a fingertip draws back off its button the way it came in)
  const away = Object.fromEntries(hands.flatMap((hand) => {
    const hold = self.holding[hand], way = hold && self.species.person ? backOff(personOf(self), hold.thing.grip(hold.grip), placed) : null;
    return way ? [[hand, way]] : [];
  }));
  const carried = carriedBy(self, thing);
  for (const hand of hands) grasp(self, hand, null);
  self.leave(object);
  if (backOut) self.handling.backOut(hands, away);
  const holder = [...thing.holders].find((other): other is Self => other !== self);
  if (onto) {
    const miss = put(self, thing, onto, placed.position);
    // (a hand kept on it holds it where it rests now, no longer as the carry that brought it keeps it in the hand)
    for (const hand of handsOn(self, thing)) delete self.holding[hand]?.keep;
    if (miss) throw new Missed('release', siteOf(new Error().stack), miss);
  }
  // (a hand of its own still on it: that hand carries it alone, if it was carried — what stayed where it is as the hands held it, a rifle worn on its mount, a fixed rail, stays there)
  else if (handsOn(self, thing).length) {
    if (carried) take(self, thing);
  } else if (holder) take(holder, thing);
  else {
    // (a thing lifted is left in the world where it is, under the scene's root; one never lifted — a button, a part still in its place —
    // stays where it is)
    if (thing.lifted) attach(thing, rootOf(object));
    if (!bodyOf(object)) thing.lifted = false;
  }
  return released;
}

/**
 * `thing`, which is `at` (world), put onto the empty `onto`: set exactly there within 5 mm, else where it is, a miss
 */
function put(self: Self, thing: Thing, onto: Object3D, at: Readonly<Vector3>): Miss | null {
  const off = at.distanceTo(self.track(onto).at(self.frame.time).current.position);
  attach(thing, onto);
  if (!bodyOf(thing.object)) thing.lifted = false;
  if (off > ONTO) return { where: `${thing.object.name} onto ${onto.name}`, off, limit: ONTO, why: `it was ${(100 * off).toFixed(1)} cm off the empty as it was let go, and stays so: \`carry\` it there first` };
  thing.object.position.set(0, 0, 0);
  thing.object.quaternion.identity();
  return null;
}

/** the root of the scene `object` is in */
function rootOf(object: Object3D): Object3D {
  let root = object;
  while (root.parent) root = root.parent;
  return root;
}
