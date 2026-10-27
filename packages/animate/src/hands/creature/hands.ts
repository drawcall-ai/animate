import { Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import type { Frame } from '../../kernel/frame';
import { REACHED, REACHING, type Goal } from '../../kernel/goal';
import type { Carrier } from '../../kernel/carrier';
import { ChainTip, reached } from '../../kernel/tip';
import { noticing } from '../../look/gaze';
import { Walk } from '../../legs/walk';
import { during, type Request } from '../../kernel/requests';
import { bodyOf, goalOn, grasp, handsOn, take } from '../../things/hold';
import type { Thing } from '../../things/thing';
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
const OUT = 0.9;
const AHEAD = 0.6;
/** Tuned (m/s): how fast a creature lets itself further down while it falls short of what it reaches for low down */
const PRESSING = 0.1;

/** the chain hand `hand` reaches with */
function chainOf(self: Handed, hand: string): string {
  const chain = self.species.hands?.get(hand);
  if (!chain) throw new Error(`the body has no hand "${hand}"`);
  return chain;
}

/**
 * The keep of a creature's hand that holds something, a sub-step: its chain back to how its balance carries it — its tip to rest —
 * with what it holds (a dog's neck carrying a ball nods, turns and leads as it walks).
 */
export function keeping(self: Handed): (f: Frame, hand: string) => void {
  return (f, hand) => {
    if (!self.species.hands) return;
    const bones = f.current.skeleton.chain(chainOf(self, hand));
    for (const b of bones) {
      const goal = b === bones[bones.length - 1] ? REST : f.current.local(b);
      f.current.setLocal(b, followRotation(f.prev2.local(b), f.prev.local(b), goal, { accel: DIP.turnAccel, speed: DIP.turnSpeed }, f.dt, _q));
    }
  };
}

/**
 * The hands' chains back to where balance has them, over `HANDING` s from where they are (with what they hold): each joint from where it
 * was toward balance's at a calm dip's pace, balance taking over as it gets there; `done` once it has.
 */
function handingBack(self: Handed, hands: readonly string[]) {
  const bones = hands.flatMap((hand) => self.pose.skeleton.chain(chainOf(self, hand)));
  let began = NaN, dips: Quaternion[][] = [];
  return {
    done: (f: Frame) => !Number.isNaN(began) && f.time - began >= HANDING,
    step: (f: Frame) => {
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
    },
  };
}

/**
 * How a creature stoops for its hand's chain (`bones`) to reach low: its front bowed about its hind girdle and its body let down on its
 * legs, each its share of as far as they let it (`most`, m, the chain's base lowered so); `to` asks it, a sub-step, as low as `goal`
 * needs from how it stands — and lower still while the tip stays above it: worked out from standing, it falls a little short. A goal it
 * reaches standing it does not stoop for. (A dog takes a ball off the floor with its front lowered and its neck flexed down, its hind
 * legs standing.)
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

/**
 * how far ahead of the root (m) the body stands to take something at `point` with `chain` (its base as it stands now); out of its
 * reach up or down, how far it is from the base that way and how far the hand reaches (m)
 */
function standOff(self: Handed, chain: string, point: Readonly<Vector3>, lowered = 0): number | { value: number; limit: number } {
  const { skeleton } = self.pose, bones = skeleton.chain(chain);
  const base = self.pose.position(bones[0]), length = chainLength(self, bones);
  // (let down for a point below the base, never for one above it: it stoops only to reach down)
  const out = OUT * length, below = base.y - point.y, drop = Math.max(-out, below > 0 ? below - lowered : below);
  if (drop > out || below < -out) return { value: Math.abs(below), limit: out + lowered };
  return _v.subVectors(base, self.pose.position(0)).dot(forwardOf(self.yaw)) + AHEAD * Math.sqrt(out ** 2 - drop ** 2);
}


const REST = new Quaternion();
const _q = new Quaternion(), _q2 = new Quaternion();
const _v = new Vector3(), _t = new Vector3();

/** where a creature stands to reach `point` with `hand`'s chain, and the stoop it reaches with; nowhere, a problem in the dev log */
function reachOf(self: Handed, hand: string, point: Readonly<Vector3>, where: string) {
  const chain = chainOf(self, hand), bones = self.pose.skeleton.chain(chain), stoop = stooping(self, bones);
  const off = standOff(self, chain, point, stoop.most(self.frame));
  // (how long the hand then takes to get there: at most its chain's reach, at a calm dip's pace)
  if (typeof off === 'number') return { chain, bones, stoop, off, after: dipping(OUT * chainLength(self, bones)) };
  self.frame.dev?.append(self.frame.time, { check: 'out of reach: from the hand\'s base, up or down (m)', ...off, where: `${where} ${chain}` });
  return null;
}

/** how long a creature's hand takes to go `distance` (s) at a calm dip's pace */
const dipping = (distance: number) => distance / DIP.speed + DIP.speed / DIP.accel;

/**
 * a creature walking up (borrowed legs) to stand `off` before `at`, its eyes on it on the way (borrowed), if it has eyes: what it moves
 * arrives `after` s after the walk
 */
function* coming(self: Handed, request: Request, at: (f: Frame) => Readonly<Vector3>, { off, after }: { off: number; after: number }) {
  const walk = new Walk(self, { to: at, within: off });
  const legs = during(request, 'go', 'borrowed', (f) => {
    const go = walk.step(f);
    request.eta = walk.eta + after;
    return go;
  }, (f, _, time) => time > 0 && (walk.stalled || walk.arrived(f)));
  yield* self.gazer ? parallel<Frame>('race', legs, noticing(self, request, at)) : legs;
  return !walk.stalled;
}

/** a creature's hand chain's tip to `goal` (at a calm dip's pace), stooping for it, the hand asked, until it is there */
function tipping(self: Handed, request: Request, hand: string, goal: (f: Frame) => Goal, on?: Carrier) {
  const chain = chainOf(self, hand), bones = self.pose.skeleton.chain(chain), bone = bones[bones.length - 1], stoop = stooping(self, bones), tip = new ChainTip(chain);
  const began = self.frame.time;
  let late = false;
  return during(request, `hand.${hand}`, 'asked', (f) => {
    const target = goal(f);
    stoop.to(f, on ? on.toWorld(target, _world, f.time).position : target.position);
    tip.to(f, target, { ...DIP, on });
  }, (f) => {
    const target = goal(f), at = on ? on.toWorld(target, _world, f.time).position : target.position;
    request.eta = dipping(f.prev.position(bone).distanceTo(at));
    if (reached(f, bone, target, on)) return true;
    if (!late && f.time - began > REACHING) {
      late = true;
      f.dev?.append(f.time, { check: `late reach: distance after ${REACHING} s (m)`, value: f.prev.position(bone).distanceTo(at), limit: REACHED.distance, where: chain });
    }
    return false;
  });
}

/**
 * A creature taking hold with one hand (a jaw): it walks up to stand with the grip in its hand's reach — bowed and lowered if it must,
 * as far as its legs let it — its eyes on the grip on the way, then the hand's chain reaches it, the hand closes (a loose thing with a
 * mass is taken into it: held rigidly) and goes back to where balance has it, with what it took. `false` for a grip out of its reach
 * from anywhere it could stand.
 */
export function* taking(self: Handed, request: Request, hand: string, thing: Thing, grip: string) {
  const goal = goalOn(thing.grip(grip), self.restOf(self.hands[hand])), frame = self.track(thing.object);
  const point = (f: Frame) => frame.toWorld({ position: goal.position }, _world, f.time).position;
  const reach = reachOf(self, hand, point(self.frame), thing.object.name);
  if (!reach || !(yield* coming(self, request, (f) => point(f).clone(), reach))) {
    request.fail();
    return;
  }
  yield* tipping(self, request, hand, () => goal, self.track(thing.object));
  grasp(self, hand, { thing, grip, goal });
  if (thing.massive && !bodyOf(thing.object)) {
    [thing.home, thing.taken] = [thing.object.parent, self.track(thing.object).current.position.clone()];
    thing.lifted = true;
    take(self, thing);
  }
  const back = handingBack(self, [hand]);
  yield* during(request, `hand.${hand}`, 'asked', back.step, back.done);
}

/**
 * A creature's hand bringing what it holds to `to` (its placement, a sub-step at a time) at a calm dip's pace, the hand asked: it walks
 * up first (borrowed) if `to` is beyond its reach; met once there, it keeps it there. `false` if `to` is out of its reach from anywhere.
 */
export function* bringing(self: Handed, request: Request, hand: string, thing: Thing, to: (f: Frame) => Goal) {
  const reach = reachOf(self, hand, to(self.frame).position, thing.object.name);
  if (!reach) {
    request.fail();
    return;
  }
  const bone = reach.bones[reach.bones.length - 1];
  if (!(yield* coming(self, request, (f) => to(f).position, reach))) {
    request.fail();
    return;
  }
  // (the hand where it puts the thing there, as it holds it: its tip goes there, the chain bending as it may)
  const placed = self.track(thing.object).current, inverse = self.pose.rotation(bone).clone().invert();
  const inHand = { position: placed.position.clone().sub(self.pose.position(bone)).applyQuaternion(inverse), quaternion: inverse.multiply(placed.quaternion) };
  // (turned as `to` asks, if it does: else as it is held)
  const handAt = (f: Frame): Goal => {
    const at = to(f), turn = at.quaternion ?? self.track(thing.object).at(f.time).current.quaternion;
    const quaternion = turn.clone().multiply(_iq.copy(inHand.quaternion).invert());
    const position = inHand.position.clone().negate().applyQuaternion(quaternion).add(at.position);
    return at.quaternion ? { position, quaternion } : { position };
  };
  yield* tipping(self, request, hand, handAt);
  request.met();
  const tip = new ChainTip(reach.chain);
  yield* during(request, `hand.${hand}`, 'asked', (f) => {
    const target = handAt(f);
    reach.stoop.to(f, target.position);
    tip.to(f, target, DIP);
  });
}

/** A creature's hand reaching `target` (a sub-step at a time), walking up first if it must: met once there, it stays there. */
function* nuzzling(self: Handed, request: Request, hand: string, target: (f: Frame) => Readonly<Vector3>) {
  const reach = reachOf(self, hand, target(self.frame), 'reach');
  if (!reach || !(yield* coming(self, request, target, reach))) {
    request.fail();
    return;
  }
  yield* tipping(self, request, hand, (f) => ({ position: target(f).clone() }));
  request.met();
  const tip = new ChainTip(reach.chain);
  yield* during(request, `hand.${hand}`, 'asked', (f) => {
    const position = target(f);
    reach.stoop.to(f, position);
    tip.to(f, { position }, DIP);
  });
}

const _world: Goal & { velocity: Vector3; spin: Vector3 } = { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() };
const _iq = new Quaternion();

/**
 * A creature's hands for the verbs: one at a time, each the tip of its chain — it walks up to stand with the grip or target in its reach,
 * bowed and lowered if it must, its eyes on it on the way, then the chain reaches it; a thing it takes it holds rigidly.
 */
export function creatureHands(self: Handed): Handling {
  const one = (verb: string, hands: readonly string[]) => {
    if (hands.length > 1) throw new Error(`${verb}: a creature uses one hand at a time`);
    return hands[0];
  };
  return {
    take: function* (request, thing, grips) {
      const { hand, grip } = grips[0];
      one('grab', grips.map((grip) => grip.hand));
      yield* taking(self, request, hand, thing, grip);
      request.met();
    },
    bring: function* (request, thing, points) {
      yield* bringing(self, request, handsOn(self, thing)[0], thing, points[points.length - 1]);
    },
    reach: function* (request, aims) {
      const { hand, target } = aims[0];
      one('reach', aims.map((aim) => aim.hand));
      yield* nuzzling(self, request, hand, (f) => target(f).position);
    },
    backOut(hands) {
      const back = handingBack(self, hands);
      self.own('release', '', (request) => () => during(request, `hand.${hands[0]}`, 'borrowed', back.step, back.done));
    },
  };
}
