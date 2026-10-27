import { Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import type { Frame } from '../../kernel/frame';
import { REACHED, REACHING, type Goal } from '../../kernel/goal';
import type { Carrier } from '../../kernel/carrier';
import { ChainTip, lateReach, reached } from '../../kernel/tip';
import { noticing } from '../../look/gaze';
import { Walk } from '../../legs/walk';
import { during, type Request } from '../../kernel/requests';
import { bodyOf, goalOn, grasp, handsOn, lift } from '../../things/hold';
import { Pose, type ReadonlyPose } from '../../kernel/pose';
import { STOOPING } from '../../legs/creature';
import { forwardOf, minimumJerk } from '../../kernel/math';
import { followRotation } from '../../kernel/follow';
import type { Handed } from '../handed';
import type { Handling } from '../handling';

// A creature's hands, by name (`Species.hands`): the tip of the skeleton's chain named for each (a jaw, a trunk) reaches; what it takes
// it holds rigidly (attached to the tip's bone).

/** Tuned: how long (s) a creature's hand, let go, takes to be its balance's again */
const HANDING = 0.6;
/** Tuned: how a creature's hand goes to a grip (m/s², m/s), each joint of its chain braked to its turn (rad/s², rad/s) on the way there
 * and back to rest: a calm dip of the head, its joints never flung round by the solve as the tip comes in */
const DIP = { accel: 4, speed: 1, turnAccel: 8, turnSpeed: 2 };
/** Tuned: standing to take something, the share of the hand's chain it reaches out to, and the share of that reach along the floor the grip is ahead of the chain's base */
const OUT = 0.9, AHEAD = 0.6;
/** Tuned (m/s): how fast a creature lets itself further down while it falls short of what it reaches for low down */
const PRESSING = 0.1;

/** the chain hand `hand` reaches with */
function chainOf(self: Handed, hand: string): string {
  const chain = self.species.hands?.get(hand);
  if (!chain) throw new Error(`the body has no hand "${hand}"`);
  return chain;
}

/** A creature's hand holding something, a sub-step: its chain as its balance carries it, its tip to rest (a dog's neck carrying a ball nods as it walks) */
export function keeping(self: Handed): (f: Frame, hand: string) => void {
  return (f, hand) => {
    const bones = f.current.skeleton.chain(chainOf(self, hand));
    for (const b of bones) {
      const goal = b === bones[bones.length - 1] ? REST : f.current.local(b);
      f.current.setLocal(b, followRotation(f.prev2.local(b), f.prev.local(b), goal, { accel: DIP.turnAccel, speed: DIP.turnSpeed }, f.dt, _q));
    }
  };
}

/** The hands' chains back to where balance has them over `HANDING` s, with what they hold, at a calm dip's pace (the first hand `use`d) */
function handingBack(self: Handed, request: Request, hands: readonly string[], use: 'asked' | 'borrowed') {
  const bones = hands.flatMap((hand) => self.pose.skeleton.chain(chainOf(self, hand)));
  let began = NaN, dips: Quaternion[][] = [];
  return during(request, `hand.${hands[0]}`, use, (f) => {
    // (the dip followed on its own history — read off the blended pose, balance's share of each step was taken for the dip's speed and
    // fed back, the neck flung up at 1000°/s)
    if (Number.isNaN(began)) [began, dips] = [f.time - f.dt, bones.map((b) => [f.prev2.local(b).clone(), f.prev.local(b).clone()])];
    const share = minimumJerk((f.time - began) / HANDING);
    bones.forEach((b, k) => {
      const [before, was] = dips[k], dip = followRotation(before, was, f.current.local(b), { accel: DIP.turnAccel, speed: DIP.turnSpeed }, f.dt, _q2);
      before.copy(was);
      was.copy(dip);
      f.current.setLocal(b, _q.copy(dip).slerp(f.current.local(b), share));
    });
  }, (f) => !Number.isNaN(began) && f.time - began >= HANDING);
}

/**
 * How a creature stoops for its hand's chain (`bones`) to reach low — a dog takes a ball off the floor with its front lowered and its
 * neck flexed down, its hind legs standing: its front bowed about its hind girdle and its body let down on its legs, each its share of
 * as far as they let it (`most`, m, the chain's base lowered so); `to` asks it, a sub-step, as low as `goal` needs from how it stands,
 * and lower still while the tip stays above it (worked out from standing, it falls a little short). A goal reached standing, none.
 */
function stooping(self: Handed, bones: readonly number[]) {
  const legs = self.species.legs?.chains ?? [], tip = bones[bones.length - 1], length = chainLength(self, bones);
  const lowest = legs.length ? STOOPING.lowest * Math.min(...legs.map((leg) => chainLength(self, leg.joints.map(({ bone }) => bone)))) : 0;
  // (the chain's base ahead of the hind legs' tops: how far down a bow takes it)
  const lever = (f: { prev: ReadonlyPose }) => {
    const forward = forwardOf(self.yaw), root = f.prev.position(0), tops = legs.map((leg) => _t.subVectors(f.prev.position(leg.joints[0].bone), root).dot(forward));
    return Math.max(1e-3, _v.subVectors(f.prev.position(bones[0]), root).dot(forward) - (tops.length ? Math.min(...tops) : 0));
  };
  const bowed = (f: { prev: ReadonlyPose }) => legs.length ? lever(f) * Math.sin(STOOPING.bow) : 0;
  // (the chain's base as high as it stands)
  const standing = new Pose(self.pose.skeleton).position(bones[0]).y;
  let pressing = 0;
  return {
    most: (f: { prev: ReadonlyPose }) => bowed(f) + lowest,
    to(f: Frame, goal: Readonly<Vector3>) {
      const short = standing - goal.y - OUT * length, most = bowed(f) + lowest;
      pressing = Math.max(0, Math.min(most, pressing + Math.sign(f.prev.position(tip).y - goal.y - REACHED.distance) * PRESSING * f.dt));
      // (shared between its bow and its letting down as far as each goes: a little lower, its front bowed more)
      const drop = short > 0 ? Math.min(most, short + pressing) : 0, bow = drop * bowed(f) / most;
      if (drop > 0) self.poise.add({ bow: Math.asin(Math.min(1, bow / lever(f))), lower: Math.min(lowest, drop - bow) });
    },
  };
}

/** the chain of `bones` laid out end to end (m) */
function chainLength(self: Handed, bones: readonly number[]): number {
  return bones.slice(1).reduce((sum, b) => sum + self.pose.skeleton.bones[b].offset.length(), 0);
}

const REST = new Quaternion(), _q = new Quaternion(), _q2 = new Quaternion();
const _v = new Vector3(), _t = new Vector3();

/** how long a creature's hand takes to go `distance` (s) at a calm dip's pace */
const dipping = (distance: number) => distance / DIP.speed + DIP.speed / DIP.accel;

/**
 * A creature walking up (borrowed legs) to stand with `point` in `hand`'s reach, unless it is in reach already, its eyes on it on the way
 * (borrowed) if it has eyes, what it moves arriving as the hand then gets there (at most its chain's reach, at a calm dip's pace): the
 * hand's chain and the stoop it reaches with. From nowhere it could stand (a problem in the dev log), or with a walk that stalls, none:
 * the request failed.
 */
function* walkingUp(self: Handed, request: Request, hand: string, point: (f: Frame) => Readonly<Vector3>, where: string) {
  const chain = chainOf(self, hand), bones = self.pose.skeleton.chain(chain), stoop = stooping(self, bones);
  const at = point(self.frame), lowered = stoop.most(self.frame), base = self.pose.position(bones[0]), out = OUT * chainLength(self, bones);
  // (let down for a point below the base, never for one above it: it stoops only to reach down)
  const below = base.y - at.y, drop = Math.max(-out, below > 0 ? below - lowered : below);
  if (drop > out || below < -out) {
    self.frame.dev?.append(self.frame.time, { check: 'out of reach: from the hand\'s base, up or down (m)', value: Math.abs(below), limit: out + lowered, where: `${where} ${chain}` });
    request.fail();
    return null;
  }
  if (base.distanceTo(at) <= out) return { chain, bones, stoop };
  // (it stands as far ahead of the root as puts the point in reach of the chain's base as it stands now)
  const off = _v.subVectors(base, self.pose.position(0)).dot(forwardOf(self.yaw)) + AHEAD * Math.sqrt(out ** 2 - drop ** 2);
  const after = dipping(out), walk = new Walk(self, { to: point, within: off });
  const legs = during(request, 'go', 'borrowed', (f) => {
    const go = walk.step(f);
    request.eta = walk.eta + after;
    return go;
  }, (f, _, time) => time > 0 && (walk.stalled || walk.arrived(f)));
  yield* self.gazer ? parallel<Frame>('race', legs, noticing(self, request, point)) : legs;
  if (!walk.stalled) return { chain, bones, stoop };
  request.fail();
  return null;
}

/** a creature's hand chain's tip to `goal` (at a calm dip's pace), stooping for it, the hand asked, until it is there */
function tipping(self: Handed, request: Request, hand: string, goal: (f: Frame) => Goal, on?: Carrier) {
  const chain = chainOf(self, hand), bones = self.pose.skeleton.chain(chain), bone = bones[bones.length - 1], stoop = stooping(self, bones), tip = new ChainTip(chain);
  const first = goal(self.frame), at = on ? on.toWorld(first, _world, self.frame.time).position : first.position;
  const ends = self.frame.time + dipping(self.pose.position(bone).distanceTo(at));
  let late = false;
  return during(request, `hand.${hand}`, 'asked', (f) => {
    const target = goal(f);
    stoop.to(f, on ? on.toWorld(target, _world, f.time).position : target.position);
    tip.to(f, target, { ...DIP, on });
  }, (f) => {
    const target = goal(f), at = on ? on.toWorld(target, _world, f.time).position : target.position;
    request.eta = dipping(f.prev.position(bone).distanceTo(at));
    if (reached(f, bone, target, on)) return true;
    if (!late && f.time > ends + REACHING) {
      late = true;
      if (lateReach(f, bone, target, chain, on)) request.fail();
    }
    return false;
  });
}

/** A creature's hand walked up to `point`, then its tip (`bone`) onto the goal `aim` gives, at a calm dip's pace: met once there, it keeps there */
function* holdingOn(self: Handed, request: Request, hand: string, where: string, point: (f: Frame) => Readonly<Vector3>, aim: (bone: number) => (f: Frame) => Goal) {
  const reach = yield* walkingUp(self, request, hand, point, where);
  if (!reach) return;
  const goal = aim(reach.bones[reach.bones.length - 1]);
  yield* tipping(self, request, hand, goal);
  request.met();
  const tip = new ChainTip(reach.chain);
  yield* during(request, `hand.${hand}`, 'asked', (f) => {
    const target = goal(f);
    reach.stoop.to(f, target.position);
    tip.to(f, target, DIP);
  });
}

const _world: Goal & { velocity: Vector3; spin: Vector3 } = { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() }, _iq = new Quaternion();

/** A creature's hands for the verbs: one at a time, each its chain's tip, walked up to stand with the grip or target in reach; what it takes it holds rigidly */
export function creatureHands(self: Handed): Handling {
  const only = <Use>(verb: string, uses: readonly Use[]) => {
    if (uses.length > 1) throw new Error(`${verb}: a creature uses one hand at a time`);
    return uses[0];
  };
  return {
    take: function* (request, thing, grips) {
      // (the hand closes; a loose thing with a mass is taken into it, held rigidly; and it goes back to where balance has it, with it)
      const { hand, grip } = only('grab', grips);
      const goal = goalOn(thing.grip(grip), self.restOf(self.hands[hand])), frame = self.track(thing.object);
      const point = (f: Frame) => frame.toWorld({ position: goal.position }, _world, f.time).position.clone();
      if (!(yield* walkingUp(self, request, hand, point, thing.object.name))) return;
      yield* tipping(self, request, hand, () => goal, frame);
      grasp(self, hand, { thing, grip, goal });
      if (thing.massive && !bodyOf(thing.object)) lift(self, thing);
      yield* handingBack(self, request, [hand], 'asked');
      request.met();
    },
    bring: function* (request, thing, points) {
      const to = points[points.length - 1];
      // (the hand where it puts the thing there, as it holds it — the two read off one pose once it has walked up — turned as `to` asks, if it does)
      yield* holdingOn(self, request, handsOn(self, thing)[0], thing.object.name, (f) => to(f).position, (bone) => {
        const placed = self.track(thing.object).current, pose = self.poseFor(self), inverse = pose.rotation(bone).clone().invert();
        const inHand = { position: placed.position.clone().sub(pose.position(bone)).applyQuaternion(inverse), quaternion: inverse.multiply(placed.quaternion) };
        return (f) => {
          const at = to(f), turn = at.quaternion ?? self.track(thing.object).at(f.time).current.quaternion;
          const quaternion = turn.clone().multiply(_iq.copy(inHand.quaternion).invert());
          const position = inHand.position.clone().negate().applyQuaternion(quaternion).add(at.position);
          return at.quaternion ? { position, quaternion } : { position };
        };
      });
    },
    reach: function* (request, aims) {
      const { hand, target } = only('reach', aims);
      yield* holdingOn(self, request, hand, 'reach', (f) => target(f).position, () => target);
    },
    backOut(hands) {
      self.own('release', '', (request) => () => handingBack(self, request, hands, 'borrowed'));
    },
  };
}
