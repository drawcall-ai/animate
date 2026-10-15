import { Quaternion, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import type { Frame } from '../../core/body';
import { Carrier, type Item } from '../../core/carrier';
import { live, type Behaviour, type Live, type Motion, type Placement, type Until } from '../../core/goal';
import { ChainTip } from '../../core/tip';
import { TrackedPoint, TrackedRotation } from '../../core/track';
import { CALM, handStep } from '../arms';
import { INDEX, SIDES, type Side } from '../bones';
import { course, type Leg } from '../course';
import type { Humanoid } from '../humanoid';
import { grip, gripOf, type Grips } from './grips';
import { following, LEADING } from './reach';

// Holding and carrying: the hands on an item's grips, carrying it where it goes.

/** how fast a held item is carried where it is to go (m/s², m/s, rad/s², rad/s): calmly */
export const CARRYING = { accel: 6, speed: 3, turnAccel: 8, turnSpeed: 4 } satisfies Motion;

/** the longest a carried item takes to come to rest at its course's end once it is over, unless told (s) */
const RESTING = 2;

/** a hand on a grip it holds follows it briskly, its joints too (they lag the solve no more than a few cm): a held thing goes where it is carried */
const HOLD = { ...CALM, accel: 30, speed: 3, turnAccel: 200, turnSpeed: 15 };

/**
 * Items carried, each by the hands on its grips along its course through `frame` (`course`: its
 * legs' placements in that frame, m × `scale`, default the body's), together: every course from
 * where its item is when it sets off, timed by its legs, `pace` times as fast (an item in the left
 * hand alone while the right carries another a moment later and a little slower: `reachFor`'s
 * lead). It ends once every course is over and every item has come to rest at its end (within
 * 1 cm, moving with it to within 5 cm/s: on a body that walks, the frame carries it on): one shared
 * condition, no hand lets go before the others. An item not at rest there `limit` s after its course
 * is over throws (a course out of the arms' reach).
 */
export function carry<W>(h: Humanoid<W>, frame: Live<Required<Placement>, W>, loads: readonly (readonly [Item, Grips, readonly Leg[]])[], options: { scale?: number; pace?: number; motion?: Motion; limit?: number } = {}): Behaviour<W> {
  const { scale = h.proportions.scale, pace = 1, limit = RESTING } = options;
  return function* () {
    // (an item in the other hand alone, while the leading hand carries one too, goes a little after it)
    const leads = loads.some(([, grips]) => grips[LEADING] !== undefined);
    const courses = loads.map(([item, grips, legs]) => {
      if (!leads || grips[LEADING] !== undefined) return course(item, frame, legs, { scale, pace: pace / Math.sqrt(1 + item.mass / 3) });
      const { delay, slower } = following(item, grips);
      return course(item, frame, legs, { scale, pace: pace * (1 - slower) / Math.sqrt(1 + item.mass / 3), delay });
    });
    let since = NaN;
    const ends = loads.map(() => new TrackedEnd());
    const there = (f: Frame<W>) => {
      if (!courses.every((c) => c.over(f))) return false;
      if (Number.isNaN(since)) since = f.time;
      if (loads.every(([item], i) => ends[i].holds(f, item, courses[i].to(f).position))) return true;
      if (f.time - since > limit) throw new Error(`a carried item did not come to rest at its course's end in ${limit} s`);
      return false;
    };
    yield* parallel<Frame<W>>('all', ...loads.map(([item, grips], i) => hold(h, item, grips, { to: courses[i].to, motion: options.motion, until: there })));
  };
}

/**
 * where a course ends, followed as its frame moves it: an item has come to rest there once within
 * 1 cm of it and moving with it to within 5 cm/s — read as the item was last moved, a sub-step
 * before (against where the end was then, and how fast it went)
 */
class TrackedEnd {
  private time = NaN;
  private readonly at = [new Vector3(), new Vector3()];
  private readonly velocity = [new Vector3(), new Vector3()];

  holds<W>(f: Frame<W>, item: Item, end: Readonly<Vector3>): boolean {
    const [now, then] = this.at;
    const [moving, was] = this.velocity;
    if (this.time !== f.time) {
      const next = Math.abs(f.time - f.dt - this.time) < 1e-9;
      then.copy(next ? now : end);
      was.copy(next ? moving : _v.set(0, 0, 0));
      moving.copy(next ? _v.subVectors(end, now).divideScalar(f.dt) : _v.set(0, 0, 0));
      now.copy(end);
      this.time = f.time;
    }
    const off = _v.subVectors(item.current.position, item.prev.position).divideScalar(f.dt).sub(was);
    return item.current.position.distanceTo(then) < 0.01 && off.length() < 0.05;
  }
}

/**
 * The hands on `item`'s grips, every sub-step: endless, or until `until`. Without `to`, the hands go
 * where the item goes (another moves it). With `to`, the hands carry it there: they go for its grips
 * as it would be, followed toward `to` at `motion`'s pace (its own motion fed forward) and kept
 * within the arms' reach, and the item is put where the hands are (fitted to the wrists: its one
 * mover), so it never leaves them.
 */
export function hold<W>(h: Humanoid<W>, item: Item, grips: Grips, options: { to?: Live<Placement, W>; motion?: Motion; until?: Exclude<Until<W>, 'reached'> } = {}): Behaviour<W> {
  const { to } = options;
  // Recalled design tuning, not a measured law: a 3 kg load halves the carrying acceleration.
  const factor = 1 + item.mass / 3;
  const pace = options.motion ?? CARRYING;
  const motion = { ...pace, accel: pace.accel / factor };
  const sides = SIDES.filter((s) => grips[s] !== undefined);
  return function* () {
    const arms = { left: new ChainTip('leftArm'), right: new ChainTip('rightArm') };
    // (where the hands carry the item: followed toward `to`)
    const aim = new Carrier(item.current.position, item.current.quaternion);
    const position = new TrackedPoint();
    const rotation = new TrackedRotation();
    if (to && item.supported && item.mass > 2) {
      const lower = Math.max(0, h.proportions.hipHeight - h.pose.position(0).y);
      const bow = h.asks.bow;
      // Read brief: APAs precede movement by 50–150 ms; recalled staging here: 0.2 s, 2.5 cm dip.
      yield* action<Frame<W>>({ update: (f) => {
        for (const side of sides) handStep(h, f, side, gripOf(item, grip(grips, side)), { on: item, ...HOLD }, arms[side]);
        h.asks.lower = Math.max(h.asks.lower, lower + 0.025 * h.proportions.scale);
        h.asks.bow = Math.max(h.asks.bow, bow);
      }, until: timePassed(0.2, 'seconds') });
    }
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
 * `at`, where the item is to go turned `turned`, drawn toward the shoulders as far as a grip would be
 * out of its arm's reach (OUTREACH of its length): the hands carry it no further than they reach
 */
function inReach<W>(h: Humanoid<W>, f: Frame<W>, item: Item, grips: Grips, sides: readonly Side[], at: Vector3, turned: Quaternion): Vector3 {
  // Recalled staging: overhead placement extends the arms further than carrying at the waist.
  const most = (at.y > h.proportions.height ? 0.95 : OUTREACH) * h.proportions.armLength;
  for (const side of sides) {
    const shoulder = f.current.position(INDEX[`${side}UpperArm`]);
    const out = _g1.copy(gripOf(item, grip(grips, side)).position).applyQuaternion(turned).add(at).sub(shoulder);
    const length = out.length();
    if (length > most) at.addScaledVector(out, (most - length) / length);
  }
  return at;
}

/** how far out a hand carries what it holds, or is put going off it (× the arm's length) */
export const OUTREACH = 0.9;

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

const _v = new Vector3();
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
