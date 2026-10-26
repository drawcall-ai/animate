import { Box3, Matrix4, Vector3, type Object3D } from 'three';
import { selfOf, type Body } from '../body/body';
import { attach, bodyOf, grasp, handsOn } from '../body/hold';
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
 * Lets go of `thing`, at once (no `yield*`): attached onto the empty `onto` (set there exactly if it is within 5 mm), else to another
 * hand still holding it (that body moves it now), else to the parent it was lifted from, where it is now. After letting go, the hands
 * back out the way they came in. Development says when it is let go in mid-air, put onto an empty more than 5 mm off or one another
 * thing already sits in.
 */
export function release(body: Body, thing: Object3D, onto?: Object3D): void {
  const self = selfOf(body), held = Thing.of(thing), hands = handsOn(self, held), f = self.frame;
  if (!hands.length) throw new Error(`release: no hand of the body holds "${thing.name}"`);
  const placed = self.track(thing).at(f.time).current, moving = self.track(thing).velocity(new Vector3()).length();
  const lowest = new Box3().copy(held.bounds).applyMatrix4(new Matrix4().compose(placed.position, placed.quaternion, thing.scale)).min.y;
  for (const hand of hands) grasp(self, hand, null);
  self.leave(thing);
  const holder = [...held.holders].find((other): other is Self => other !== self);
  if (onto) put(self, held, onto, placed.position);
  else if (holder) attach(held, nodeOf(holder, held), holder instanceof Person ? holder : undefined);
  else {
    const home = held.home ?? thing.parent;
    if (home) attach(held, home);
    if (!bodyOf(thing)) held.lifted = false;
    const back = held.taken && placed.position.distanceTo(held.taken) < ONTO;
    if (f.dev && !back && (lowest > MID_AIR.height || moving > MID_AIR.speed)) {
      f.dev.append(f.time, { check: 'let go in mid-air: its lowest point above the ground (m)', value: lowest, limit: MID_AIR.height, where: thing.name });
    }
  }
  if (self instanceof Person) {
    const sides = hands.map(sideOf);
    self.own('release', '', (request) => () => backingOut(self, request, sides));
  } else {
    const back = handingBack(self, hands);
    self.own('release', '', (request) => () => during(request, `hand.${hands[0]}`, 'borrowed', back.step, back.done));
  }
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

/** where a body that holds `thing` holds it from: a person's root bone, a creature's hand */
function nodeOf(holder: Self, thing: Thing): Object3D {
  if (holder instanceof Person) return holder.binding.bones[holder.skeleton.bones[0].name];
  const hand = handsOn(holder, thing)[0];
  return holder.binding.bones[holder.skeleton.bones[holder.hands[hand]].name];
}
