import { Box3, Matrix4, Object3D, Vector3 } from 'three';
import { selfOf, type Body, type HandOf } from '../body/body';
import type { AnySpecies } from '../core/species';
import { attach, bodyOf, grasp, handsOn, take } from '../body/hold';
import { during } from '../body/requests';
import type { Self } from '../body/self';
import { Thing } from '../body/things';
import { handingBack } from '../core/hands';
import { Person, sideOf } from '../humanoid/person';
import { backingOut } from '../humanoid/hands/release';

/** how near an empty a thing put onto it must be (m): nearer, it is set exactly there */
const ONTO = 0.005;
/** let go in mid-air: its lowest point this far above the ground (m), or moving this fast (m/s) */
const MID_AIR = { height: 0.02, speed: 0.2 };

/**
 * Lets go, at once (no `yield*`). Given a thing, every hand of the body holding it lets go of it; given hands by name (`{ right: rope }`),
 * those hands let go of what each names and the body's others keep holding (one hand left on a thing carries it alone). A thing no hand
 * of the body holds any more is attached onto the empty `onto` (set there exactly if it is within 5 mm), else to another body still
 * holding it (that body carries it now), else to the parent it was lifted from, where it is now. The hands that let go back out of it,
 * carrying on the way they were going. Development says when a thing is let go in mid-air, put onto an empty more than 5 mm off or onto
 * one another thing already sits in.
 */
export function release(body: Body, thing: Object3D, onto?: Object3D): void;
export function release<S extends AnySpecies>(body: Body<S>, hands: Partial<Record<HandOf<S>, Object3D>>): void;
export function release(body: Body, which: Object3D | Partial<Record<string, Object3D>>, onto?: Object3D): void {
  const self = selfOf(body);
  if (which instanceof Object3D) {
    const held = Thing.of(which), hands = handsOn(self, held);
    if (!hands.length) throw new Error(`release: no hand of the body holds "${which.name}"`);
    letGo(self, held, hands, onto);
  } else {
    const named = Object.entries(which).flatMap(([hand, thing]) => thing ? [{ hand, thing: Thing.of(thing) }] : []);
    for (const { hand, thing } of named) {
      if (!(hand in self.holding)) throw new Error(`release: the body has no hand "${hand}"`);
      if (self.holding[hand]?.thing !== thing) throw new Error(`release: the ${hand} hand does not hold "${thing.object.name}"`);
    }
    for (const thing of new Set(named.map(({ thing }) => thing))) letGo(self, thing, named.filter((n) => n.thing === thing).map((n) => n.hand));
  }
}

/** `self`'s `hands` letting go of `thing` (see `release`), and backing out of it */
function letGo(self: Self, thing: Thing, hands: readonly string[], onto?: Object3D): void {
  const f = self.frame, object = thing.object;
  const placed = self.track(object).at(f.time).current, moving = self.track(object).velocity(new Vector3()).length();
  const lowest = new Box3().copy(thing.bounds).applyMatrix4(new Matrix4().compose(placed.position, placed.quaternion, object.scale)).min.y;
  for (const hand of hands) grasp(self, hand, null);
  self.leave(object);
  backOut(self, hands);
  // (a hand of its own still on it: that hand carries it alone)
  if (handsOn(self, thing).length) {
    take(self, thing);
    return;
  }
  const holder = [...thing.holders].find((other): other is Self => other !== self);
  if (onto) put(self, thing, onto, placed.position);
  else if (holder) take(holder, thing);
  else {
    const home = thing.home ?? object.parent;
    if (home) attach(thing, home);
    if (!bodyOf(object)) thing.lifted = false;
    const back = thing.taken && placed.position.distanceTo(thing.taken) < ONTO;
    if (f.dev && !back && (lowest > MID_AIR.height || moving > MID_AIR.speed)) {
      f.dev.append(f.time, { check: 'let go in mid-air: its lowest point above the ground (m)', value: lowest, limit: MID_AIR.height, where: object.name });
    }
  }
}

/** the hands that let go backing out of what they held: a request of the body's own */
function backOut(self: Self, hands: readonly string[]): void {
  if (self instanceof Person) {
    const sides = hands.map(sideOf);
    self.own('release', '', (request) => () => backingOut(self, request, sides));
    return;
  }
  const back = handingBack(self, hands);
  self.own('release', '', (request) => () => during(request, `hand.${hands[0]}`, 'borrowed', back.step, back.done));
}

/**
 * `thing`, which is `at` (world), put onto the empty `onto`: set exactly there within 5 mm, else where it is; development says when it is
 * off or not alone there
 */
function put(self: Self, thing: Thing, onto: Object3D, at: Readonly<Vector3>): void {
  const f = self.frame;
  const empty = self.track(onto).at(f.time).current.position;
  const off = at.distanceTo(empty);
  if (f.dev && onto.children.some((child) => child !== thing.object && child.userData.mass !== undefined)) {
    f.dev.append(f.time, { check: 'put onto an empty another thing sits in', value: 1, limit: 0, where: `${thing.object.name} onto ${onto.name}` });
  }
  if (f.dev && off > ONTO) f.dev.append(f.time, { check: 'put onto an empty this far off it (m)', value: off, limit: ONTO, where: `${thing.object.name} onto ${onto.name}` });
  attach(thing, onto);
  if (off <= ONTO) {
    thing.object.position.set(0, 0, 0);
    thing.object.quaternion.identity();
  }
  if (!bodyOf(thing.object)) thing.lifted = false;
}

