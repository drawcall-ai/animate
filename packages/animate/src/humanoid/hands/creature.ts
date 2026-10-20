import { Quaternion, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import type { Body, Frame } from '../../core/body';
import type { Item } from '../../core/carrier';
import { lookAt } from '../../core/gaze';
import { REACHED, type Behaviour, type Target, type Until } from '../../core/goal';
import { followRotation } from '../../core/follow';
import { forwardOf } from '../../core/math';
import { ChainTip, reached } from '../../core/tip';
import { walkTo } from '../walk';
import { gripOf, type Holds } from './grips';

// A creature's hand (a jaw, a trunk): the skeleton's chain named for it reaches; what it takes stays where it was on it.

/** Tuned: how a creature's hand goes to a grip (m/s², m/s) and back to rest (rad/s², rad/s): a calm dip of the head */
const DIP = { accel: 4, speed: 1, turnAccel: 8, turnSpeed: 2 };
/** the longest a hand takes to get to its grip before it is a problem in the dev log (s) */
const REACHING = 3;
/** Tuned: standing to take something, the share of the hand's chain it reaches out to, and the share of that reach along the floor the grip is ahead of the chain's base */
const OUT = 0.9;
const AHEAD = 0.6;

/**
 * `grab` for a body other than a person, one hand at a time: it walks up to stand with the grip in its hand's
 * reach (not with `walk: false`), its eyes on the grip on the way (if it has any; not with `look: false`), then the
 * hand's chain reaches it and the hand closes. Not there within REACHING s, it is a problem in the dev log and keeps going.
 */
export function take(body: Body, holds: Holds, options: { look?: boolean; walk?: boolean } = {}): Behaviour {
  const [hand, ...more] = Object.keys(holds), hold = holds[hand];
  if (!hold || more.length) throw new Error('a creature takes hold with one hand at a time');
  const [item, grip] = hold, goal = gripOf(item, grip), chain = chainOf(body, hand);
  const at = () => item.toWorld(goal, _world).position.clone();
  return function* () {
    if (options.walk !== false) {
      const walk = walkTo(body, { to: at, within: standOff(body, chain, at()) });
      yield* options.look === false || !body.gazer ? walk() : parallel<Frame>('race', lookAt(body, at), walk);
    }
    yield* tipTo(body, chain, goal, item)();
    body.holding[hand] = { item, grip };
  };
}

/** `hold` for a body other than a person: the chain of the hand holding `item` goes back to rest (the item on it) and keeps it there, endless or until `until`. */
export function keep(body: Body, item: Item, until?: Exclude<Until, 'reached'>): Behaviour {
  return function* () {
    const hand = Object.keys(body.holding).find((hand) => body.holding[hand]?.item === item);
    if (!hand) throw new Error(`"${item.name}" is not held`);
    item.supported = false;
    const bones = body.pose.skeleton.chain(chainOf(body, hand));
    yield* action<Frame>({
      update: (f) => {
        for (const b of bones) f.current.setLocal(b, followRotation(f.prev2.local(b), f.prev.local(b), REST, { accel: DIP.turnAccel, speed: DIP.turnSpeed }, f.dt, _q));
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

/** how far ahead of the root (m) the body stands to take something at `point` with `chain` (its base as it stands now) */
function standOff(body: Body, chain: string, point: Readonly<Vector3>): number {
  const { skeleton } = body.pose, bones = skeleton.chain(chain);
  const base = body.pose.position(bones[0]), length = bones.slice(1).reduce((sum, b) => sum + skeleton.bones[b].offset.length(), 0);
  const out = OUT * length, drop = base.y - point.y;
  if (Math.abs(drop) > out) throw new Error(`grab: ${point.y.toFixed(2)} m high is out of the reach of chain "${chain}"`);
  return _v.subVectors(base, body.pose.position(0)).dot(forwardOf(body.yaw)) + AHEAD * Math.sqrt(out ** 2 - drop ** 2);
}

/** the chain's tip to `goal` on `item`, until it is there */
function tipTo(body: Body, chain: string, goal: Target, item: Item): Behaviour {
  return function* () {
    const tip = new ChainTip(chain), bones = body.pose.skeleton.chain(chain), bone = bones[bones.length - 1], began = body.frame.time;
    let late = false;
    yield* action<Frame>({
      update: (f) => tip.to(f, goal, { ...DIP, turnAccel: undefined, on: item }),
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
const _q = new Quaternion();
const _v = new Vector3();
const _world: Target & { velocity: Vector3; spin: Vector3 } = { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() };
