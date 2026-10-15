import { Quaternion, Vector3 } from 'three';
import { action, timePassed } from '@pmndrs/timeline';
import type { Body, Frame } from '../../core/body';
import { Carrier, loadFactor, type Item } from '../../core/carrier';
import { live, type Behaviour, type Live, type Motion, type Placement, type Until } from '../../core/goal';
import { ChainTip } from '../../core/tip';
import { TrackedPoint, TrackedRotation } from '../../core/track';
import { ARM_REACH, bringShoulder, HOLD, handStep } from '../arms';
import { INDEX, SIDES, type Side } from '../bones';
import { course, type Leg } from '../course';
import type { Humanoid } from '../humanoid';
import { grip, gripOf, type Grips } from './grips';
import { onBone } from '../goal';
import { following, LEADING } from './reach';

// Holding and carrying: the hands on an item's grips, carrying it where it goes.

/** how fast a held item is carried where it is to go (m/s², m/s, rad/s², rad/s): calmly */
export const CARRYING = { accel: 6, speed: 3, turnAccel: 8, turnSpeed: 4 } satisfies Motion;

/** the longest a carried item takes to come to rest at its course's end once it is over, unless told (s) */
const RESTING = 2;

/**
 * Carry a held item along `legs`, in metres in the world by default. `on` selects an item frame
 * or a bone frame (only bone distances scale with that body). A bone number uses this body’s
 * facing at that joint; `[body, bone]` follows the bone’s rotation. Leg seconds describe an unloaded
 * item: its mass divides the course pace by `loadFactor(mass)`. Ends within 1 cm and 5 cm/s of
 * the course end; throws after `limit` seconds of settling outside reach. With `support`, contact
 * within 1 cm of the endpoint arrests the item and ends the carry without waiting for free settling.
 */
export function carry<W>(h: Humanoid<W>, item: Item, legs: readonly Leg[], options: { on?: number | Carrier | readonly [Pick<Body, 'pose' | 'scale'>, number]; pace?: number; support?: boolean; motion?: Motion; limit?: number } = {}): Behaviour<W> {
  return function* () {
    const { on, pace = 1, limit = RESTING } = options;
    let frame: Live<Required<Placement>, W> = WORLD;
    let scale = 1;
    if (typeof on === 'number') {
      frame = onBone<W>(h, on, WORLD, { facing: true });
      scale = h.scale;
    } else if (on instanceof Carrier) frame = () => on.current;
    else if (on) {
      frame = onBone<W>(on[0], on[1], WORLD);
      scale = on[0].scale;
    }
    const grips: Grips = {};
    for (const side of SIDES) if (h.holding[side]?.item === item) grips[side] = h.holding[side]?.grip;
    const lag = grips[LEADING] === undefined && h.holding[LEADING] ? following(item, grips) : { delay: 0, slower: 0 };
    const path = course(item, frame, legs, { scale, pace: pace * (1 - lag.slower) / loadFactor(item.mass), delay: lag.delay });
    const end = new TrackedEnd();
    let since = NaN;
    const there = (f: Frame<W>) => {
      if (!path.over(f)) return false;
      if (Number.isNaN(since)) since = f.time;
      const placement = path.to(f);
      const goal = placement.position;
      // Support arrests the item on contact; an unsupported carry must settle under its own motion.
      if (options.support && item.current.position.distanceTo(goal) < 0.01) {
        item.supported = true;
        return true;
      }
      if (end.holds(f, item, goal)) return true;
      if (f.time - since > limit) {
        const off = SIDES.flatMap((side) => {
          const held = h.holding[side];
          if (held?.item !== item) return [];
          const at = gripOf(item, held.grip).position.clone().applyQuaternion(placement.quaternion).add(goal);
          return [`${side} grip "${held.grip}": ${f.prev.position(INDEX[`${side}Hand`]).distanceTo(at).toFixed(3)} m off`];
        });
        throw new Error(`"${item.name}" ${off.join('; ')}; ${item.current.position.distanceTo(goal).toFixed(3)} m off course end after ${limit} s`);
      }
      return false;
    };
    yield* hold(h, item, { to: path.to, motion: options.motion, until: there })();
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
export function hold<W>(h: Humanoid<W>, item: Item, options: { to?: Live<Placement, W>; motion?: Motion; until?: Exclude<Until<W>, 'reached'> } = {}): Behaviour<W> {
  const { to } = options;
  // Recalled design tuning, not a measured law: load slows carrying with the same factor as its course and walking.
  const factor = loadFactor(item.mass);
  const pace = options.motion ?? CARRYING;
  const motion = { ...pace, accel: pace.accel / factor };
  return function* () {
    const grips: Grips = {};
    for (const side of SIDES) {
      const held = h.holding[side];
      if (held?.item === item) grips[side] = held.grip;
    }
    const sides = SIDES.filter((s) => grips[s] !== undefined);
    if (!sides.length) throw new Error(`"${item.name}" is not held by either hand`);
    const arms = { left: new ChainTip('leftArm'), right: new ChainTip('rightArm') };
    // (where the hands carry the item: followed toward `to`)
    const aim = new Carrier(item.current.position, item.current.quaternion);
    const position = new TrackedPoint();
    const rotation = new TrackedRotation();
    if (to && item.supported && item.mass > 2) {
      // Anticipatory preparation: 100 ms, with a small (5 mm) knee release.
      yield* action<Frame<W>>({ update: (f) => {
        for (const side of sides) handStep(h, f, side, gripOf(item, grip(grips, side)), { on: item, ...HOLD, lead: !h.worn.has(item) }, arms[side]);
        h.asks.lower += 0.005 * h.proportions.scale;
      }, until: timePassed(0.1, 'seconds') });
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
          if (!h.worn.has(item)) for (const side of sides) bringShoulder(h, f, side, _g1.copy(gripOf(item, grip(grips, side)).position).applyQuaternion(turned).add(goal.position));
          const within = inReach(h, f, item, grips, sides, _at.copy(goal.position), turned);
          aim.move(f.time, position.follow(item.prev.position, item.current.position, within, motion, f.dt, _p), turned);
        }
        for (const side of sides) handStep(h, f, side, gripOf(item, grip(grips, side)), { on, ...HOLD, lead: !h.worn.has(item) }, arms[side]);
        if (to) fit(f, item, aim, grips, sides);
      },
      until: options.until,
    });
  };
}

/**
 * `at`, where the item is to go turned `turned`, drawn toward the shoulders as far as a grip would be
 * out of its arm's reach (ARM_REACH of its length): the hands carry it no further than they reach
 */
function inReach<W>(h: Humanoid<W>, f: Frame<W>, item: Item, grips: Grips, sides: readonly Side[], at: Vector3, turned: Quaternion): Vector3 {
  const most = ARM_REACH * h.proportions.armLength;
  for (const side of sides) {
    const shoulder = f.current.position(INDEX[`${side}UpperArm`]);
    const out = _g1.copy(gripOf(item, grip(grips, side)).position).applyQuaternion(turned).add(at).sub(shoulder);
    const length = out.length();
    if (length > most) at.addScaledVector(out, (most - length) / length);
  }
  return at;
}

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

const WORLD = { position: new Vector3(), quaternion: new Quaternion() };
