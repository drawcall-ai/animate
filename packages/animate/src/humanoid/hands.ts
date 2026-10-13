import { Quaternion, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import type { Frame } from '../core/body';
import { Carrier, type Item } from '../core/carrier';
import { live, type Behaviour, type Live, type Motion, type Placement, type Target, type Until } from '../core/goal';
import { ChainTip, reached } from '../core/tip';
import { TrackedPoint, TrackedRotation } from '../core/track';
import { CALM, handStep, handTo } from './arms';
import { INDEX, SIDES, type Side } from './bones';
import type { Humanoid } from './humanoid';
import { yawOf } from './rig';
import { walkTo } from './walk';

/** Which of an item's grips each hand takes (by name). */
export type Grips = Partial<Record<Side, string>>;

/** how fast a held item is carried where it is to go (m/s², m/s, rad/s², rad/s): calmly */
export const CARRYING = { accel: 6, speed: 3, turnAccel: 8, turnSpeed: 4 } satisfies Motion;
/** how close (× the arm's length) in front of an item the body stands to take it */
const WITHIN = 0.6;
/** a hand on a grip it holds follows it briskly, its joints too (they lag the solve no more than a few cm): a held thing goes where it is carried */
const HOLD = { ...CALM, accel: 30, speed: 3, turnAccel: 200, turnSpeed: 15 };

/** Hand `side` open (a stub: the hand has no fingers yet): holding nothing, at once. */
export function openHand<W>(h: Humanoid<W>, side: Side): Behaviour<W> {
  return function* () {
    h.holding[side] = null;
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
 * hands open and go to the grips together (the body bowing and bending as low as they are), and
 * close on them once all are there. It ends with the hands on the grips: hold on with `hold`.
 */
export function grab<W>(h: Humanoid<W>, item: Item, grips: Grips): Behaviour<W> {
  const sides = SIDES.filter((s) => grips[s] !== undefined);
  const facing = () => yawOf(item.current.quaternion);
  // (one condition for all hands: each stays on its way until every one is there)
  const there = (f: Frame<W>) => sides.every((side) => reached(f.prev2, f.prev, f.dt, INDEX[`${side}Hand`], gripOf(item, grip(grips, side)), item));
  return function* () {
    yield* walkTo(h, { to: () => item.current.position, face: facing, within: WITHIN * h.proportions.armLength })();
    for (const side of sides) yield* openHand(h, side)();
    yield* parallel<Frame<W>>('all', ...sides.map((side) => handTo(h, side, gripOf(item, grip(grips, side)), { on: item, until: there })));
    for (const side of sides) yield* closeHand(h, side, item, grip(grips, side))();
  };
}

/**
 * The hands on `item`'s grips, every sub-step: endless, or until `until`. Without `to`, the hands go
 * where the item goes (another moves it). With `to`, the hands carry it there: they go for its grips
 * as it would be, followed toward `to` at `motion`'s pace (its own motion fed forward) and kept
 * within the arms' reach, and the item is put where the hands are (fitted to the wrists: its one
 * mover), so it never leaves them.
 */
export function hold<W>(h: Humanoid<W>, item: Item, grips: Grips, options: { to?: Live<Placement, W>; motion?: Motion; until?: Exclude<Until<W>, 'reached'> } = {}): Behaviour<W> {
  const { to, motion = CARRYING } = options;
  const sides = SIDES.filter((s) => grips[s] !== undefined);
  return function* () {
    const arms = { left: new ChainTip('leftArm'), right: new ChainTip('rightArm') };
    // (where the hands carry the item: followed toward `to`)
    const aim = new Carrier(item.current.position, item.current.quaternion);
    const position = new TrackedPoint();
    const rotation = new TrackedRotation();
    yield* action<Frame<W>>({
      update: (f) => {
        const on = to ? aim : item;
        if (to) {
          const goal = live(to, f);
          // (on from where the item is, fitted to the wrists: arms lagging the aim do not pull it apart from them)
          const turned = rotation.follow(item.prev.quaternion, item.current.quaternion, goal.quaternion ?? item.current.quaternion, { accel: motion.turnAccel ?? CARRYING.turnAccel, speed: motion.turnSpeed }, f.dt, _q);
          const within = inReach(h, f, item, grips, sides, _at.copy(goal.position), turned);
          aim.move(f.time, position.follow(item.prev.position, item.current.position, within, motion, f.dt, _p), turned);
        }
        for (const side of sides) handStep(h, f, side, gripOf(item, grip(grips, side)), { on, ...HOLD }, arms[side]);
        if (to) fit(f, item, aim, grips, sides);
      },
      until: options.until,
    });
  };
}

/**
 * `at`, where the item is to go turned `turned`, drawn toward the shoulders as far as a grip would be
 * out of its arm's reach (REACH of its length): the hands carry it no further than they reach
 */
function inReach<W>(h: Humanoid<W>, f: Frame<W>, item: Item, grips: Grips, sides: readonly Side[], at: Vector3, turned: Quaternion): Vector3 {
  const most = REACH * h.proportions.armLength;
  for (const side of sides) {
    const shoulder = f.current.position(INDEX[`${side}UpperArm`]);
    const out = _g1.copy(gripOf(item, grip(grips, side)).position).applyQuaternion(turned).add(at).sub(shoulder);
    const length = out.length();
    if (length > most) at.addScaledVector(out, (most - length) / length);
  }
  return at;
}

/** how far out a hand carries what it holds (× the arm's length) */
const REACH = 0.9;

/**
 * `item` moved (at `f`'s time) where the wrists hold it: as `aim` has it, carried along with the
 * wrists — turned so the line between two grips lies along the line between the wrists, moved so
 * their middle is the wrists' middle
 */
function fit<W>(f: Frame<W>, item: Item, aim: Carrier, grips: Grips, sides: readonly Side[]) {
  const at = (side: Side, out: Vector3) => out.copy(gripOf(item, grip(grips, side)).position).applyQuaternion(aim.current.quaternion).add(aim.current.position);
  const wrist = (side: Side, out: Vector3) => out.copy(f.current.position(INDEX[`${side}Hand`]));
  const turn = _turn.identity();
  if (sides.length === 2) {
    const held = _a.subVectors(at('right', _g1), at('left', _g2)).normalize();
    const hands = _b.subVectors(wrist('right', _w1), wrist('left', _w2)).normalize();
    turn.setFromUnitVectors(held, hands);
  }
  const middle = _m.set(0, 0, 0);
  const hands = _h.set(0, 0, 0);
  for (const side of sides) {
    middle.add(at(side, _g1));
    hands.add(wrist(side, _w1));
  }
  middle.divideScalar(sides.length);
  hands.divideScalar(sides.length);
  const position = _p.subVectors(aim.current.position, middle).applyQuaternion(turn).add(hands);
  item.move(f.time, position, _q.copy(turn).multiply(aim.current.quaternion));
}

/** grip `name` of `item`: a target in its frame */
function gripOf(item: Item, name: string): Target {
  const g = item.grips[name];
  if (!g) throw new Error(`the item has no grip "${name}"`);
  return g;
}

function grip(grips: Grips, side: Side): string {
  const name = grips[side];
  if (name === undefined) throw new Error(`no grip for the ${side} hand`);
  return name;
}

const _p = new Vector3();
const _at = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _m = new Vector3();
const _h = new Vector3();
const _g1 = new Vector3();
const _g2 = new Vector3();
const _w1 = new Vector3();
const _w2 = new Vector3();
const _q = new Quaternion();
const _turn = new Quaternion();
