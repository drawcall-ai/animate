import { Quaternion, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import type { Body, Frame } from './body';
import { gripOf, type Carrier, type Item } from './carrier';
import { lookAt } from './gaze';
import { problemOnce } from './dev';
import { live, REACHED, REACHING, type Behaviour, type Live, type Motion, type Placement, type Target, type Until } from './goal';
import { course, type Waypoint } from './course';
import { Pose, type ReadonlyPose } from './pose';
import { STOOPING } from './legs/creature';
import { forwardOf, minimumJerk } from './math';
import { followRotation } from './follow';
import { ChainTip, reached } from './tip';
import { walkTo } from './walk';
import { request } from './asks';

// Hands of any body, by name (`Species.hands`): a person's arms reach as a person's do (`grab`); another body's hand (a jaw,
// a trunk) is the tip of the skeleton's chain named for it, which reaches; what it takes stays where it was on it (`weld`).

/** What each hand takes hold of, by the hand's name (a person's: `left`, `right`): an item, by which of its grips. A body without hands
 * (`Species<never>`, a horse's) takes hold of nothing. */
export type Grips<H extends string = string> = [H] extends [never] ? { readonly [hand: string]: never } : Readonly<Partial<Record<H, readonly [Item, string]>>>;

/** Tuned: how long (s) a creature's hand, let go, takes to be its base's again */
const HANDING = 0.6;
/** Tuned: how a creature's hand goes to a grip (m/s², m/s) and back to rest (rad/s², rad/s): a calm dip of the head */
const DIP = { accel: 4, speed: 1, turnAccel: 8, turnSpeed: 2 };
/** Tuned: standing to take something, the share of the hand's chain it reaches out to, and the share of that reach along the floor the grip is ahead of the chain's base */
const OUT = 0.9;
const AHEAD = 0.6;
/** Tuned (m/s): how fast a creature lets itself further down while it falls short of what it reaches for low down */
const PRESSING = 0.1;

/** How any body takes hold (`grab`'s options, all a body other than a person takes). */
export interface Taking {
  /** where the eyes go: the grips' middle (`true`, the default), a point, or nowhere (`false`) */
  look?: boolean | Live<Vector3>;
  /** `false`: take it from where the body stands */
  walk?: boolean;
}

/**
 * `grab` for a body other than a person, one hand at a time: it walks up to stand with the grip in its hand's
 * reach — bowed and lowered if it must, as far as its legs let it (`stooping`) — (not with `walk: false`), its eyes on the grip on the way (if it has any; not with `look: false`), then the
 * hand's chain reaches it, the hand closes and goes back to where the body's base has it, with what it took. Not there within REACHING s, it is a problem in the dev log and keeps going; a grip
 * out of its reach from anywhere it could stand is one too, and it stands where it is.
 */
export function take<H extends string>(body: Body<H>, holds: Grips<H>, options: Taking = {}): Behaviour {
  const [hand, ...more] = Object.keys(holds) as H[], hold = holds[hand];
  if (!hold || more.length) throw new Error('a creature takes hold with one hand at a time');
  const [item, grip] = hold, goal = gripOf(item, grip), chain = chainOf(body, hand);
  const at = () => item.toWorld(goal, _world).position.clone();
  return function* () {
    // (a grip the hand reaches from nowhere it could stand, too high or too low, is a problem in the dev log, once: the body stays
    // standing where it is, doing nothing more for it)
    const stoop = stooping(body, body.pose.skeleton.chain(chain)), off = standOff(body, chain, at(), stoop.most(body.frame));
    if (typeof off !== 'number') {
      yield* problemOnce({ check: 'grab out of reach: grip from the hand\'s base, up or down (m)', ...off, where: `${item.name} ${chain}` })();
      return;
    }
    if (options.walk !== false) {
      const walk = walkTo(body, { to: at, within: off });
      const look = options.look ?? true;
      yield* look === false || !body.gazer ? walk() : parallel<Frame>('race', lookAt(body, look === true ? at : look), walk);
    }
    yield* tipTo(body, chain, goal, item, stoop)();
    body.holding[hand] = { item, grip };
    yield* handBack(body, [hand])();
  };
}

/** where a hand takes an item: along timed waypoints (a course) or to a placement, live */
export type Way = readonly Waypoint[] | Live<Placement>;
const isCourse = (way: Way): way is readonly Waypoint[] => Array.isArray(way);

/** the hand holding `item`, if any */
function handHolding<H extends string>(body: Body<H>, item: Item): H | undefined {
  return (Object.keys(body.holding) as H[]).find((hand) => body.holding[hand]?.item === item);
}

/** How a creature's hand brings what it holds (`carry`'s and `hold`'s options, as a creature takes them). */
export interface Bringing {
  /** the frame a course's waypoints are in (default the world) */
  frame?: Live<Placement>;
  /** the speed along the course (1: as its seconds say) */
  pace?: number;
  /** the hand's pace (default a calm dip's) */
  motion?: Motion;
  /** seconds after the course is over before a hand still short of it is a problem in the dev log (default `REACHING`) */
  limit?: number;
  /** held there, not ending once there: endlessly, or until this (`hold`) */
  hold?: { until?: Exclude<Until, 'reached'> };
}

/**
 * `carry` for a body other than a person: the hand holding `item` takes it along `way` (a course of waypoints, or to a live
 * placement) at a calm dip's pace and ends once it is there (`hold`: keeps it there); still short of it `limit` s after the course is
 * over, that is a problem in the dev log and it keeps going. Carried off, it rests on nothing: the body bears its weight.
 */
export function bring(body: Body, item: Item, way: Way, options: Bringing = {}): Behaviour {
  const { frame = ORIGIN, pace = 1, motion = DIP, limit = REACHING, hold } = options;
  return function* () {
    const hand = handHolding(body, item);
    if (!hand) throw new Error(`"${item.name}" is not held`);
    item.supported = false;
    const chain = chainOf(body, hand), tip = new ChainTip(chain), bones = body.pose.skeleton.chain(chain), bone = bones[bones.length - 1], stoop = stooping(body, bones);
    // (the hand where it puts the item there, as it holds it: its tip goes there, the chain bending as it may)
    const inHand = itemIn(body.pose, bone, item), path = isCourse(way) ? course(item, frame, way, { pace }) : null;
    const handAt = (f: Frame): Target => {
      const at = path ? path.to(f) : live(way as Live<Placement>, f), turn = at.quaternion ?? item.current.quaternion;
      const quaternion = _hq.copy(turn).multiply(_iq.copy(inHand.quaternion).invert());
      return { position: inHand.position.clone().negate().applyQuaternion(quaternion).add(at.position), quaternion: quaternion.clone() };
    };
    let over = NaN, late = false;
    yield* action<Frame>({
      update: (f) => {
        const position = handAt(f).position;
        stoop.to(f, position);
        tip.to(f, { position }, { ...DIP, accel: motion.accel ?? DIP.accel, speed: motion.speed ?? DIP.speed, turnAccel: undefined });
      },
      until: (f, clock, time) => {
        if (hold) return hold.until?.(f, clock, time) ?? false;
        if (path && !path.over(f)) return false;
        if (Number.isNaN(over)) over = f.time;
        if (reached(f, bone, { position: handAt(f).position })) return true;
        if (!late && f.time - over > limit) {
          late = true;
          f.dev?.append(f.time, { check: `late carry: hand distance after ${limit} s (m)`, value: f.prev.position(bone).distanceTo(handAt(f).position), limit: REACHED.distance, where: `${item.name} ${chain}` });
        }
        return false;
      },
    });
  };
}

/** `release` for a body other than a person: the hands let go, and their chains go back to where the body's base has them over `HANDING` s. */
export function letGo<H extends string>(body: Body<H>, hands: readonly H[]): Behaviour {
  return function* () {
    for (const hand of hands) {
      const held = body.holding[hand];
      if (held) held.item.supported = true;
      body.holding[hand] = null;
    }
    yield* handBack(body, hands)();
  };
}

/** the hands' chains back to where the body's base has them, over `HANDING` s from where they are (with what they hold) */
function handBack<H extends string>(body: Body<H>, hands: readonly H[]): Behaviour {
  return function* () {
    const bones = hands.flatMap((hand) => body.pose.skeleton.chain(chainOf(body, hand)));
    const began = body.frame.time;
    // (each joint from where it was toward the base's, at a calm dip's pace, the base taking over as it gets there: the dip followed on
    // its own history — read off the blended pose, the base's share of each step was taken for the dip's speed and fed back, the neck
    // flung up at 1000°/s)
    const dips = bones.map((b) => [body.frame.prev2.local(b).clone(), body.frame.prev.local(b).clone()]);
    yield* action<Frame>({
      update: (f) => {
        const share = minimumJerk((f.time - began) / HANDING);
        bones.forEach((b, k) => {
          const [before, was] = dips[k], dip = followRotation(before, was, f.current.local(b), { accel: DIP.turnAccel, speed: DIP.turnSpeed }, f.dt, _q2);
          before.copy(was);
          was.copy(dip);
          f.current.setLocal(b, _q.copy(dip).slerp(f.current.local(b), share));
        });
      },
      until: (f) => f.time - began >= HANDING,
    });
  };
}

/** How any body moves its hand to a target (`handTo`'s options, all a body other than a person takes). */
export interface Reaching extends Partial<Pick<Motion, 'accel' | 'speed'>> {
  /** the target is on this carrier, in its frame */
  on?: Carrier;
  until?: Until;
}

/** `handTo` for a body other than a person: hand `hand`'s chain tip to `target`, endless or until `until` (`'reached'`: there). */
export function tipToward(body: Body, hand: string, target: Live<Target>, options: Reaching = {}): Behaviour {
  const { accel = DIP.accel, speed = DIP.speed, on, until } = options, chain = chainOf(body, hand), bones = body.pose.skeleton.chain(chain);
  return function* () {
    const tip = new ChainTip(chain), stoop = stooping(body, bones);
    yield* action<Frame>({
      update: (f) => {
        const goal = live(target, f);
        stoop.to(f, on ? on.toWorld(goal, _world, f.time).position : goal.position);
        tip.to(f, goal, { ...DIP, accel, speed, turnAccel: undefined, on });
      },
      until: until === 'reached' ? (f) => reached(f, bones[bones.length - 1], live(target, f), on) : until,
    });
  };
}

/**
 * `touch` for a body other than a person: it walks up to stand with `target` in its hand's reach — lowered and bowed if it must,
 * as far as its legs let it — its eyes on it (if it has any), the hand's chain reaches it and goes back; out of its reach even so,
 * that is a problem in the dev log, once, and it stands.
 */
export function nuzzle(body: Body, hand: string, target: Live<Vector3>): Behaviour {
  return function* () {
    const chain = chainOf(body, hand), bones = body.pose.skeleton.chain(chain), bone = bones[bones.length - 1], at = () => live(target, body.frame).clone();
    const stoop = stooping(body, bones), off = standOff(body, chain, at(), stoop.most(body.frame));
    if (typeof off !== 'number') {
      yield* problemOnce({ check: 'touch out of reach: target from the hand\'s base, up or down, lowered (m)', ...off, where: chain })();
      return;
    }
    const walk = walkTo(body, { to: at, within: off });
    yield* !body.gazer ? walk() : parallel<Frame>('race', lookAt(body, at), walk);
    const tip = new ChainTip(chain), began = body.frame.time;
    let late = false;
    yield* action<Frame>({
      update: (f) => {
        const goal = live(target, f);
        stoop.to(f, goal);
        tip.to(f, { position: goal }, { ...DIP, turnAccel: undefined });
      },
      until: (f) => {
        if (reached(f, bone, { position: live(target, f) })) return true;
        if (!late && f.time - began > REACHING) {
          late = true;
          f.dev?.append(f.time, { check: `late touch: distance after ${REACHING} s (m)`, value: f.prev.position(bone).distanceTo(live(target, f)), limit: REACHED.distance, where: chain });
        }
        return false;
      },
    });
    yield* handBack(body, [hand])();
  };
}

/**
 * How a body other than a person stoops for its hand's chain (`bones`) to reach low (`touch`, `grab`, `handTo`, `carry`, `place`): its
 * front bowed about its hind girdle and its body let down on its legs, each its share of as far as they let it (`most`, m, the chain's
 * base lowered so); `to` asks it, a sub-step,
 * as low as `goal` needs from how it stands — and lower still while the tip stays above it: worked out from standing, it
 * falls a little short. A goal it reaches standing it does not stoop for. (A dog takes a ball off the floor with its front lowered and its neck flexed down, its hind legs standing.)
 */
function stooping(body: Body, bones: readonly number[]) {
  const legs = body.species.legs?.chains ?? [], tip = bones[bones.length - 1], length = chainLength(body, bones);
  const lowest = legs.length ? STOOPING.lowest * Math.min(...legs.map((leg) => chainLength(body, leg.joints.map(({ bone }) => bone)))) : 0;
  // (the chain's base ahead of the hind legs' tops: how far down a bow takes it)
  const lever = (f: { prev: ReadonlyPose }) => {
    const forward = forwardOf(body.yaw), root = f.prev.position(0), tops = legs.map((leg) => _t.subVectors(f.prev.position(leg.joints[0].bone), root).dot(forward));
    return Math.max(1e-3, _v.subVectors(f.prev.position(bones[0]), root).dot(forward) - (tops.length ? Math.min(...tops) : 0));
  };
  const bowed = (f: { prev: ReadonlyPose }) => legs.length ? lever(f) * Math.sin(STOOPING.bow) : 0;
  // (the chain's base as high as it stands)
  const standing = new Pose(body.pose.skeleton).position(bones[0]).y;
  let pressing = 0;
  return {
    most: (f: { prev: ReadonlyPose }) => bowed(f) + lowest,
    to(f: Frame, goal: Readonly<Vector3>) {
      const short = standing - goal.y - OUT * length, most = bowed(f) + lowest;
      pressing = Math.max(0, Math.min(most, pressing + Math.sign(f.prev.position(tip).y - goal.y - REACHED.distance) * PRESSING * f.dt));
      // (shared between its bow and its letting down as far as each goes: a little lower, its front bowed more)
      const drop = short > 0 ? Math.min(most, short + pressing) : 0, bow = drop * bowed(f) / most;
      if (drop > 0) request(body.asks, { bow: Math.asin(Math.min(1, bow / lever(f))), lower: Math.min(lowest, drop - bow) });
    },
  };
}

/** the chain of `bones` laid out end to end (m) */
function chainLength(body: Body, bones: readonly number[]): number {
  return bones.slice(1).reduce((sum, b) => sum + body.pose.skeleton.bones[b].offset.length(), 0);
}

/** `place` for a body other than a person: it walks up to stand with `to` in its hand's reach, takes the item there and lets go. */
export function put(body: Body, item: Item, to: Live<Placement>): Behaviour {
  return function* () {
    const hand = handHolding(body, item);
    if (!hand) throw new Error(`"${item.name}" is not held`);
    const bones = body.pose.skeleton.chain(chainOf(body, hand)), at = () => live(to, body.frame).position.clone();
    const off = standOff(body, chainOf(body, hand), at(), stooping(body, bones).most(body.frame));
    if (typeof off !== 'number') {
      yield* problemOnce({ check: 'place out of reach: placement from the hand\'s base, up or down (m)', ...off, where: `${item.name} ${chainOf(body, hand)}` })();
      return;
    }
    yield* walkTo(body, { to: at, within: off })();
    yield* bring(body, item, to)();
    yield* letGo(body, [hand])();
  };
}

/** `carried` for a body other than a person: where its hand rests, on the body (the item, held, kept there as it is on the hand) */
export function rests(body: Body, hand: string): (f: Frame) => Required<Placement> {
  const bones = body.pose.skeleton.chain(chainOf(body, hand)), rest = new Pose(body.pose.skeleton), tip = bones[bones.length - 1];
  const inRoot = { position: rest.position(tip).sub(rest.position(0)).applyQuaternion(rest.rotation(0).clone().invert()), quaternion: rest.rotation(0).clone().invert().multiply(rest.rotation(tip)) };
  return (f) => {
    const turn = f.prev.rotation(0);
    return { position: inRoot.position.clone().applyQuaternion(turn).add(f.prev.position(0)), quaternion: turn.clone().multiply(inRoot.quaternion) };
  };
}

/** `item` in bone `bone`'s frame, as `pose` has them */
function itemIn(pose: ReadonlyPose, bone: number, item: Item): Required<Placement> {
  const inverse = pose.rotation(bone).clone().invert();
  return { position: item.current.position.clone().sub(pose.position(bone)).applyQuaternion(inverse), quaternion: inverse.multiply(item.current.quaternion) };
}

/** How a body other than a person holds (`hold`'s options, as it takes them): the item kept at rest in its hand, or brought `to` a placement at `motion`'s pace. */
export type Keeping = { until?: Exclude<Until, 'reached'> } & ({ to: Live<Placement>; motion?: Motion } | { to?: undefined; motion?: undefined });

/**
 * `hold` for a body other than a person: the chain of the hand holding `item` goes back to how the base carries it — its tip to rest —
 * the item on it, and keeps to it there, endless or until `until` (a dog's neck carrying a ball nods, turns and leads as it walks).
 */
export function keep(body: Body, item: Item, until?: Exclude<Until, 'reached'>): Behaviour {
  return function* () {
    const hand = handHolding(body, item);
    if (!hand) throw new Error(`"${item.name}" is not held`);
    item.supported = false;
    const bones = body.pose.skeleton.chain(chainOf(body, hand));
    yield* action<Frame>({
      update: (f) => {
        for (const b of bones) {
          const goal = b === bones[bones.length - 1] ? REST : f.current.local(b);
          f.current.setLocal(b, followRotation(f.prev2.local(b), f.prev.local(b), goal, { accel: DIP.turnAccel, speed: DIP.turnSpeed }, f.dt, _q));
        }
      },
      until,
    });
  };
}

/** the chain hand `hand` reaches with */
function chainOf(body: Body, hand: string): string {
  const chain = body.species.hands?.[hand];
  if (!chain) throw new Error(`the body has no hand "${hand}"`);
  return chain;
}

/**
 * how far ahead of the root (m) the body stands to take something at `point` with `chain` (its base as it stands now); out of its
 * reach up or down, how far it is from the base that way and how far the hand reaches (m)
 */
function standOff(body: Body, chain: string, point: Readonly<Vector3>, lowered = 0): number | { value: number; limit: number } {
  const { skeleton } = body.pose, bones = skeleton.chain(chain);
  const base = body.pose.position(bones[0]), length = chainLength(body, bones);
  const out = OUT * length, drop = Math.max(-out, base.y - lowered - point.y);
  if (drop > out || base.y - point.y < -out) return { value: Math.abs(base.y - point.y), limit: out + lowered };
  return _v.subVectors(base, body.pose.position(0)).dot(forwardOf(body.yaw)) + AHEAD * Math.sqrt(out ** 2 - drop ** 2);
}

/** the chain's tip to `goal` on `item`, until it is there */
function tipTo(body: Body, chain: string, goal: Target, item: Item, stoop: ReturnType<typeof stooping>): Behaviour {
  return function* () {
    const tip = new ChainTip(chain), bones = body.pose.skeleton.chain(chain), bone = bones[bones.length - 1], began = body.frame.time;
    let late = false;
    yield* action<Frame>({
      update: (f) => {
        stoop.to(f, item.toWorld(goal, _world).position);
        tip.to(f, goal, { ...DIP, turnAccel: undefined, on: item });
      },
      until: (f) => {
        if (reached(f, bone, goal, item)) return true;
        if (!late && f.time - began > REACHING) {
          late = true;
          f.dev?.append(f.time, { check: `late reach: grip distance after ${REACHING} s (m)`, value: f.prev.position(bone).distanceTo(item.toWorld(goal, _world).position), limit: REACHED.distance, where: `${item.name} ${chain}` });
        }
        return false;
      },
    });
  };
}

const REST = new Quaternion();
const _q = new Quaternion(), _q2 = new Quaternion(), _hq = new Quaternion(), _iq = new Quaternion();
const ORIGIN: Placement = { position: new Vector3(), quaternion: new Quaternion() };
const _v = new Vector3(), _t = new Vector3();
const _world: Target & { velocity: Vector3; spin: Vector3 } = { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() };
