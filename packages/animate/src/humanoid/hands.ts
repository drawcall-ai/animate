import { Quaternion, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import type { Frame } from '../core/body';
import type { Item } from '../core/carrier';
import { follow, followRotation } from '../core/follow';
import type { UntilCondition } from '@pmndrs/timeline';
import { live, type Behaviour, type Live, type Motion, type Placement, type Target } from '../core/goal';
import { spinOf } from '../core/rotation';
import { CALM, handStep, handTo } from './arms';
import { reached } from '../core/tip';
import { INDEX, SIDES, type Side } from './bones';
import type { Humanoid } from './humanoid';
import { yawOf } from './rig';
import { walkTo } from './walk';

/** Which of an item's grips each hand takes (by name). */
export type Grips = Partial<Record<Side, string>>;

/** how fast a held item is moved (m/s², m/s, rad/s², rad/s): carried calmly */
export const CARRY = { accel: 6, speed: 1.5, turnAccel: 8, turnSpeed: 2 };
/** how close (× the arm's length) in front of an item the body stands to take it */
const WITHIN = 0.6;

/** Hand `side` open (a stub: the hand has no fingers yet), holding nothing; endless. */
export function openHand<W>(h: Humanoid<W>, side: Side): Behaviour<W> {
  return function* () {
    h.holding[side] = null;
    yield* action<Frame<W>>({});
  };
}

/** Hand `side` closed on `item`'s grip `grip` (a stub: marked held at once, no fingers yet). */
export function closeHand<W>(h: Humanoid<W>, side: Side, item: Item, grip: string): Behaviour<W> {
  return function* () {
    h.holding[side] = { item, grip };
  };
}

/**
 * Taking hold of `item` by `grips`: the body walks to stand squarely before it (within reach), the
 * hands go open to the grips (the body bowing and bending as low as they are), and close on them.
 * It ends with the hands on the grips: hold on with `hold`.
 */
export function grab<W>(h: Humanoid<W>, item: Item, grips: Grips): Behaviour<W> {
  const sides = SIDES.filter((s) => grips[s] !== undefined);
  const facing = () => yawOf(item.current.quaternion);
  return function* () {
    yield* walkTo(h, { to: () => item.current.position, face: facing, within: WITHIN * h.proportions.armLength })();
    // (each hand stays on its way until all are there; the condition first: when it is met, the
    // frame goes on to the hands closing and holding)
    const there = (f: Frame<W>) => sides.every((side) => reached(f.prev, f.prev2, f.dt, INDEX[`${side}Hand`], live(gripOf<W>(item, grip(grips, side)), f), item));
    yield* parallel<Frame<W>>(
      'race',
      action<Frame<W>>({ until: there }),
      ...sides.map((side) => handTo(h, side, gripOf(item, grip(grips, side)), { on: item })),
      ...sides.map((side) => openHand(h, side)),
    );
    for (const side of sides) yield* closeHand(h, side, item, grip(grips, side))();
  };
}

/**
 * The hands on `item`'s grips, every sub-step: endless, or until `until`. With `to`, the hold moves
 * the item there (its one mover; at `motion`'s pace, its goal's motion fed forward) and the hands
 * carry it; without, the hands go where the item goes.
 */
export function hold<W>(h: Humanoid<W>, item: Item, grips: Grips, options: { to?: Live<Placement, W>; motion?: Motion; until?: UntilCondition<Frame<W>> } = {}): Behaviour<W> {
  const { to, motion = CARRY } = options;
  const sides = SIDES.filter((s) => grips[s] !== undefined);
  return function* () {
    // (the goal as it was a sub-step ago: its own motion is followed)
    let last: { position: Vector3; quaternion: Quaternion } | null = null;
    const goals = new Map<number, Quaternion>();
    yield* action<Frame<W>>({
      update: (f) => {
        if (to) {
          const goal = live(to, f);
          const quaternion = goal.quaternion ?? item.current.quaternion;
          last ??= { position: goal.position.clone(), quaternion: quaternion.clone() };
          const velocity = _v.subVectors(goal.position, last.position).divideScalar(f.dt);
          const spin = spinOf(last.quaternion, quaternion, f.dt, _s);
          last.position.copy(goal.position);
          last.quaternion.copy(quaternion);
          const position = follow(item.prev.position, item.current.position, goal.position, { accel: motion.accel, speed: motion.speed, velocity }, f.dt, _p);
          const turned = followRotation(item.prev.quaternion, item.current.quaternion, quaternion, { accel: motion.turnAccel ?? CARRY.turnAccel, speed: motion.turnSpeed, velocity: spin }, f.dt, _q);
          item.move(f.time, position, turned);
        }
        for (const side of sides) handStep(h, f, side, live(gripOf(item, grip(grips, side)), f), { on: item, ...HOLD }, goals);
      },
      until: options.until,
    });
  };
}

/** a hand on a grip it holds follows it briskly: a held thing goes where it is carried */
const HOLD = { ...CALM, accel: 30, speed: 3 };

/** grip `name` of `item`: a target in its frame */
const gripOf = <W>(item: Item, name: string): Live<Target, W> => {
  const g = item.grips[name];
  if (!g) throw new Error(`the item has no grip "${name}"`);
  return g;
};

function grip(grips: Grips, side: Side): string {
  const name = grips[side];
  if (name === undefined) throw new Error(`no grip for the ${side} hand`);
  return name;
}

const _v = new Vector3();
const _s = new Vector3();
const _p = new Vector3();
const _q = new Quaternion();
