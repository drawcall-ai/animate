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
import { withGaze } from './look';
import { forwardOf, headingOf, leftOf, wrapAngle } from './math';
import { walkTo } from './walk';

/** Which of an item's grips each hand takes (by name). */
export type Grips = Partial<Record<Side, string>>;

/** What each hand takes hold of: an item, by which of its grips. */
export type Holds = Partial<Record<Side, readonly [Item, string]>>;

/** Where the body stands to take something: its grips' middle `ahead` of it (× the arm's length) and `aside` to its left (m; negative: its right). */
export interface Stand {
  ahead?: number;
  aside?: number;
}

/** how fast a held item is carried where it is to go (m/s², m/s, rad/s², rad/s): calmly */
export const CARRYING = { accel: 6, speed: 3, turnAccel: 8, turnSpeed: 4 } satisfies Motion;
/** how far (× the arm's length) before what it takes the body stands */
const WITHIN = 0.6;
/** in reach without a step: each grip this near its shoulder on the floor's plane (× the arm's length: lower down, the body bows for it), the body facing within SQUARE (rad) of the way asked */
const IN_REACH = 0.65;
const SQUARE = 0.3;
/** arrived where it stands to take something: this near (m, default body), and come to rest or stood still this long (s) */
const ARRIVED = 0.12;
/** how far round what it takes the body walks when the way passes it (m, default body): past a stand's foot */
const ROUND = 0.5;
const STILL = 0.5;
/** the longest the hands take to get to their grips or off them, and a carried item to come to rest at its goal, unless told (s) */
const REACHING = 4;
const RESTING = 2;
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
 * Taking hold of things: the body walks up to take them (`approach`), then, the eyes on them first
 * (`withGaze`: on the grips' middle, or `look`; `false`: not), the hands take hold (`reachFor`). It
 * ends with the hands on the grips: hold on with `hold` or `carry`.
 */
export function grab<W>(h: Humanoid<W>, holds: Holds, options: { face?: number; stand?: Stand; look?: boolean | Live<Vector3, W>; bow?: number } = {}): Behaviour<W> {
  const { look = true, bow } = options;
  return function* () {
    yield* approach(h, holds, options)();
    if (look === false) return yield* reachFor(h, holds)();
    yield* withGaze(h, look === true ? middleOf(holds) : look, reachFor(h, holds), { bow })();
  };
}

/**
 * Walking up to take hold of things: to stand facing `face` with the grips' middle `stand` before
 * the body (default: in reach, squarely; facing so the left hand's grip is on the left, or toward a
 * single grip) — no step if every grip is in reach of its shoulder already; round what it takes if
 * the way there passes it (by a point ROUND beside it); it ends there, turned and come to rest (or
 * stood still on planted feet a while: a step of a few cm `balance` may not take). The first half
 * of `grab`.
 */
export function approach<W>(h: Humanoid<W>, holds: Holds, options: { face?: number; stand?: Stand } = {}): Behaviour<W> {
  const { ahead = WITHIN, aside = 0 } = options.stand ?? {};
  return function* () {
    const grips = held(holds).map(({ side, item, grip }) => ({ side, at: item.toWorld(gripOf(item, grip), _world).position.clone() }));
    const face = options.face ?? facingFor(h, grips);
    const p = h.proportions;
    const turned = () => Math.abs(wrapAngle(face - h.gait.facing)) < SQUARE;
    if (turned() && grips.every(({ side, at }) => flat(h.pose.position(INDEX[`${side}UpperArm`]), at) < IN_REACH * p.armLength)) return;
    const to = middleOf(holds).addScaledVector(leftOf(face), -aside);
    const there = to.clone().addScaledVector(forwardOf(face), -ahead * p.armLength);
    // (round it: the way from where the body stands to there passing nearer its grips than ROUND, by a point that far beside them, on the body's side)
    const body = h.pose.com(new Vector3()).setY(0);
    const middle = middleOf(holds).setY(0);
    const way = _d.subVectors(there, body).setY(0);
    const length = way.length();
    const along = length > 1e-6 ? _e.subVectors(middle, body).dot(way) / length : 0;
    const nearest = body.clone().addScaledVector(way, along / Math.max(length, 1e-6));
    // (it is in the way: passed on the way there, more than ROUND before its end, nearer the line than ROUND)
    if (along > 0 && along < length - ROUND * p.scale && flat(nearest, middle) < ROUND * p.scale) {
      const across = new Vector3(-way.z, 0, way.x).normalize();
      const side = Math.sign(_e.subVectors(body, middle).dot(across)) || 1;
      const beside = middle.clone().addScaledVector(across, side * ROUND * p.scale);
      yield* walkTo(h, { to: beside, until: (f) => flat(f.prev.com(_com), beside) < ROUND * p.scale * 0.6 })();
    }
    let still = 0;
    const arrived = (f: Frame<W>) => {
      const planted = !h.gait.moving && h.feet.every((foot) => foot.phase === 'planted');
      still = planted ? still + f.dt : 0;
      return turned() && flat(f.prev.com(_com), there) < ARRIVED * p.scale && (h.gait.settled || still > STILL);
    };
    yield* walkTo(h, { to, face, within: ahead * p.armLength, until: arrived })();
  };
}

/** the middle of the grips `holds` take, where they are now */
function middleOf(holds: Holds): Vector3 {
  const hands = held(holds);
  return hands.reduce((sum, { item, grip }) => sum.add(item.toWorld(gripOf(item, grip), _world).position), new Vector3()).divideScalar(hands.length);
}

/**
 * The hands open, go to their grips together (one shared condition: each stays on its way until
 * every one is there; the body bowing and bending as low as they are) and close on them. A hand
 * not there within `limit` s throws.
 */
export function reachFor<W>(h: Humanoid<W>, holds: Holds, { limit = REACHING } = {}): Behaviour<W> {
  const hands = held(holds);
  const there = (f: Frame<W>) => hands.every(({ side, item, grip }) => reached(f.prev2, f.prev, f.dt, INDEX[`${side}Hand`], gripOf(item, grip), item));
  const until = (f: Frame<W>, _: unknown, time: number) => {
    if (there(f)) return true;
    if (time > limit) throw new Error(`the hands did not get to their grips in ${limit} s`);
    return false;
  };
  return function* () {
    for (const { side } of hands) yield* openHand(h, side)();
    yield* parallel<Frame<W>>('all', ...hands.map(({ side, item, grip }) => handTo(h, side, gripOf(item, grip), { on: item, until })));
    for (const { side, item, grip } of hands) yield* closeHand(h, side, item, grip)();
  };
}

/**
 * Items carried, each by the hands on its grips toward its goal (`hold` with `to`), together:
 * until `until` holds (default at once) and every item has come to rest at its goal (within
 * 1 cm, under 5 cm/s): one shared condition, no hand lets go before the others. An item not at
 * rest there `limit` s after `until` throws (a goal out of the arms' reach).
 */
export function carry<W>(h: Humanoid<W>, loads: readonly (readonly [Item, Grips, Live<Placement, W>])[], options: { until?: (f: Frame<W>) => boolean; motion?: Motion; limit?: number } = {}): Behaviour<W> {
  const { limit = RESTING } = options;
  return function* () {
    let since = NaN;
    const there = (f: Frame<W>) => {
      if (options.until && !options.until(f)) return false;
      if (Number.isNaN(since)) since = f.time;
      if (loads.every(([item, , to]) => atRest(item, live(to, f), f.dt))) return true;
      if (f.time - since > limit) throw new Error(`a carried item did not come to rest at its goal in ${limit} s`);
      return false;
    };
    yield* parallel<Frame<W>>('all', ...loads.map(([item, grips, to]) => hold(h, item, grips, { to, motion: options.motion, until: there })));
  };
}

/** `item` at `at`, and still (within 1 cm, under 5 cm/s) */
function atRest(item: Item, at: Placement, dt: number): boolean {
  return item.current.position.distanceTo(at.position) < 0.01 && item.current.position.distanceTo(item.prev.position) / dt < 0.05;
}

/** the holds, side by side */
function held(holds: Holds) {
  return SIDES.flatMap((side) => {
    const hold = holds[side];
    return hold ? [{ side, item: hold[0], grip: hold[1] }] : [];
  });
}

/** the facing to take grips `grips` with: the left hand's to the left of the right's, or toward a single one from where the body stands */
function facingFor<W>(h: Humanoid<W>, grips: { side: Side; at: Vector3 }[]): number {
  const left = grips.find((g) => g.side === 'left');
  const right = grips.find((g) => g.side === 'right');
  if (left && right) return Math.atan2(-(left.at.z - right.at.z), left.at.x - right.at.x);
  const at = grips[0].at;
  const body = h.pose.com(_com);
  return headingOf(at.x - body.x, at.z - body.z);
}

/** the distance between `a` and `b` on the floor's plane */
const flat = (a: Readonly<Vector3>, b: Readonly<Vector3>) => Math.hypot(a.x - b.x, a.z - b.z);

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
    // (carried off whatever it rested on)
    if (to) item.supported = false;
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
 * Letting go with the hands `sides`: they open and go off what they held, together (one shared
 * condition), each by `away` (m; in the body's frame facing as it does: left +x, up +y, ahead +z;
 * default back and down by AWAY), as near as its arm reaches (never folded on itself nor
 * stretched out; the body not bowing nor rising after it); then the free arms take them. A hand
 * not off within `limit` s throws.
 */
export function release<W>(h: Humanoid<W>, sides: readonly Side[], options: { away?: Partial<Record<Side, Vector3>>; limit?: number } = {}): Behaviour<W> {
  const { limit = REACHING } = options;
  return function* () {
    const p = h.proportions;
    const turned = _turned.setFromAxisAngle(UP, h.gait.facing);
    const targets = sides.map((side) => {
      const away = (options.away?.[side] ?? _away.set(0, -AWAY, -AWAY)).clone().multiplyScalar(p.scale).applyQuaternion(turned);
      const at = h.pose.position(INDEX[`${side}Hand`]).clone().add(away);
      // (within what the arm reaches from its shoulder)
      const shoulder = h.pose.position(INDEX[`${side}UpperArm`]);
      const out = at.sub(shoulder);
      out.setLength(Math.min(Math.max(out.length(), FOLDED * p.armLength), OUTREACH * p.armLength));
      return { position: out.add(shoulder) };
    });
    const until = (f: Frame<W>, _: unknown, time: number) => {
      if (sides.every((side, k) => reached(f.prev2, f.prev, f.dt, INDEX[`${side}Hand`], targets[k]))) return true;
      if (time > limit) throw new Error(`the hands did not get off what they held in ${limit} s`);
      return false;
    };
    for (const side of sides) yield* openHand(h, side)();
    yield* parallel<Frame<W>>('all', ...sides.map((side, k) => handTo(h, side, targets[k], { lead: false, until })));
  };
}

/** how far the hands draw back and down letting go, unless asked otherwise (m, default body); how near its shoulder a hand going off is put at least (× the arm's length) */
const AWAY = 0.1;
const FOLDED = 0.45;

/**
 * `at`, where the item is to go turned `turned`, drawn toward the shoulders as far as a grip would be
 * out of its arm's reach (OUTREACH of its length): the hands carry it no further than they reach
 */
function inReach<W>(h: Humanoid<W>, f: Frame<W>, item: Item, grips: Grips, sides: readonly Side[], at: Vector3, turned: Quaternion): Vector3 {
  const most = OUTREACH * h.proportions.armLength;
  for (const side of sides) {
    const shoulder = f.current.position(INDEX[`${side}UpperArm`]);
    const out = _g1.copy(gripOf(item, grip(grips, side)).position).applyQuaternion(turned).add(at).sub(shoulder);
    const length = out.length();
    if (length > most) at.addScaledVector(out, (most - length) / length);
  }
  return at;
}

/** how far out a hand carries what it holds, or is put going off it (× the arm's length) */
const OUTREACH = 0.9;

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

const UP = new Vector3(0, 1, 0);
const _turned = new Quaternion();
const _away = new Vector3();
const _com = new Vector3();
const _d = new Vector3();
const _e = new Vector3();
const _world: Target & { velocity: Vector3; spin: Vector3 } = { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() };
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
