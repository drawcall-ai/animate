import { Quaternion, Vector3 } from 'three';
import type { Frame } from './frame';
import { REACHED, type Placement } from './goal';
import { Pose, type ReadonlyPose } from './pose';
import { STOOPING } from './legs/creature';
import { forwardOf, minimumJerk } from './math';
import { followRotation } from './follow';
import { request } from './asks';
import type { Self } from '../body/self';

// A creature's hands, by name (`Species.hands`): the tip of the skeleton's chain named for each (a jaw, a trunk) reaches; what it takes
// it holds rigidly (attached to the tip's bone).

/** Tuned: how long (s) a creature's hand, let go, takes to be its balance's again */
export const HANDING = 0.6;
/** Tuned: how a creature's hand goes to a grip (m/s², m/s), each joint of its chain braked to its turn (rad/s², rad/s) on the way there
 * and back to rest: a calm dip of the head, its joints never flung round by the solve as the tip comes in */
export const DIP = { accel: 4, speed: 1, turnAccel: 8, turnSpeed: 2 };
/** Tuned: standing to take something, the share of the hand's chain it reaches out to, and the share of that reach along the floor the grip is ahead of the chain's base */
const OUT = 0.9;
const AHEAD = 0.6;
/** Tuned (m/s): how fast a creature lets itself further down while it falls short of what it reaches for low down */
const PRESSING = 0.1;

/** the chain hand `hand` reaches with */
export function chainOf(self: Self, hand: string): string {
  const chain = self.species.hands?.get(hand);
  if (!chain) throw new Error(`the body has no hand "${hand}"`);
  return chain;
}

/**
 * The keep of a creature's hand that holds something, a sub-step: its chain back to how its balance carries it — its tip to rest —
 * with what it holds (a dog's neck carrying a ball nods, turns and leads as it walks).
 */
export function keeping(self: Self): (f: Frame, hand: string) => void {
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
export function handingBack(self: Self, hands: readonly string[]) {
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
export function stooping(self: Self, bones: readonly number[]) {
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
      if (drop > 0) request(self.asks, { bow: Math.asin(Math.min(1, bow / lever(f))), lower: Math.min(lowest, drop - bow) });
    },
  };
}

/** the chain of `bones` laid out end to end (m) */
export function chainLength(self: Self, bones: readonly number[]): number {
  return bones.slice(1).reduce((sum, b) => sum + self.pose.skeleton.bones[b].offset.length(), 0);
}

/**
 * how far ahead of the root (m) the body stands to take something at `point` with `chain` (its base as it stands now); out of its
 * reach up or down, how far it is from the base that way and how far the hand reaches (m)
 */
export function standOff(self: Self, chain: string, point: Readonly<Vector3>, lowered = 0): number | { value: number; limit: number } {
  const { skeleton } = self.pose, bones = skeleton.chain(chain);
  const base = self.pose.position(bones[0]), length = chainLength(self, bones);
  // (let down for a point below the base, never for one above it: it stoops only to reach down)
  const out = OUT * length, below = base.y - point.y, drop = Math.max(-out, below > 0 ? below - lowered : below);
  if (drop > out || below < -out) return { value: Math.abs(below), limit: out + lowered };
  return _v.subVectors(base, self.pose.position(0)).dot(forwardOf(self.yaw)) + AHEAD * Math.sqrt(out ** 2 - drop ** 2);
}

/** where a creature's hand rests on the body (what it holds kept there as it is on the hand), a sub-step */
export function rests(self: Self, hand: string): (f: Frame) => Required<Placement> {
  const bones = self.pose.skeleton.chain(chainOf(self, hand)), rest = new Pose(self.pose.skeleton), tip = bones[bones.length - 1];
  const inRoot = { position: rest.position(tip).sub(rest.position(0)).applyQuaternion(rest.rotation(0).clone().invert()), quaternion: rest.rotation(0).clone().invert().multiply(rest.rotation(tip)) };
  return (f) => {
    const turn = f.prev.rotation(0);
    return { position: inRoot.position.clone().applyQuaternion(turn).add(f.prev.position(0)), quaternion: turn.clone().multiply(inRoot.quaternion) };
  };
}

const REST = new Quaternion();
const _q = new Quaternion(), _q2 = new Quaternion();
const _v = new Vector3(), _t = new Vector3();
