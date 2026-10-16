import { clearBody } from './clearance';
import { carryAims } from './hold';
import { bringShoulder } from '../reach-posture';
import { Quaternion, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import type { Frame } from '../../core/body';
import { Carrier, type Item } from '../../core/carrier';
import { live, type Behaviour, type Live, type Motion, type Placement, type Until } from '../../core/goal';
import { loadFactor } from '../../core/load';
import { TrackedPoint, TrackedRotation } from '../../core/track';
import { ARM_REACH } from '../arms';
import { INDEX, SIDES, type Side } from '../bones';
import { course, type Leg } from '../course';
import type { Humanoid } from '../humanoid';
import { grip, gripOf, gripsOf, offGrips, type Grips } from './grips';
import { following, LEADING } from './reach';

// Holding and carrying: the hands on an item's grips, carrying it where it goes.

/** how fast a held item is carried where it is to go (m/s², m/s, rad/s², rad/s): calmly */
export const CARRYING = { accel: 6, speed: 3, turnAccel: 8, turnSpeed: 4 } satisfies Motion;

/** the longest a carried item takes to come to rest at its course's end once it is over, unless told (s) */
const RESTING = 2;

interface CarryOptions<W> {
  on?: Live<Placement, W>;
  pace?: number;
  motion?: Motion;
  limit?: number;
}

/**
 * Carry a held item along `legs`, in metres in the world by default. `on` selects an item frame
 * or a bone frame through `onItem` or `onBone`. Leg seconds describe an unloaded
 * item: its mass divides the course pace by `loadFactor(mass)`. Ends within 1 cm and 5 cm/s of
 * the course end; throws after `limit` seconds of settling outside reach.
 */
export function carry<W>(h: Humanoid<W>, item: Item, legs: readonly Leg<W>[], options: CarryOptions<W> = {}): Behaviour<W> {
  return carrying(h, item, legs, options);
}

function carrying<W>(h: Humanoid<W>, item: Item, legs: readonly Leg<W>[], options: CarryOptions<W>, together?: (ready: boolean) => boolean): Behaviour<W> {
  return function* () {
    const { on, pace = 1, limit = RESTING } = options;
    const frame = on ?? WORLD;
    const grips = gripsOf(h, item);
    const lag = grips[LEADING] === undefined && h.holding[LEADING] ? following(item, grips) : { delay: 0, slower: 0 };
    const factor = loadFactor(item.mass);
    const motion = options.motion ?? CARRYING;
    const from = item.current.position.y;
    // Take-up and compliance belong to lifting off a support, not every carried waypoint.
    const load = item.supported ? factor - 1 : 0;
    // Tuned load take-up: 0.15 s at 8 kg; the same law slows the path and initial acceleration.
    const path = course(item, frame, legs, { pace: pace * (1 - lag.slower) / factor, delay: lag.delay + 0.45 * load });
    const end = new TrackedEnd();
    let since = NaN;
    let dip = 0;
    const seconds = 2.4 * load;
    const there = (f: Frame<W>) => {
      if (!path.over(f)) return false;
      if (Number.isNaN(since)) since = f.time;
      const placement = path.to(f);
      const goal = placement.position;
      // Load compliance: https://pmc.ncbi.nlm.nih.gov/articles/PMC4443842/ (F = k × displacement).
      // Tuned, not measured: an upward carry dips 2.7 cm over 0.8 s at 8 kg, then recovers.
      dip = 0.08 * load * Math.min(1, Math.max(0, goal.y - from) / 0.1);
      if (end.holds(f, item, goal) && (dip === 0 || f.time - since >= seconds)) return true;
      if (f.time - since > limit) {
        const off = offGrips(f, SIDES.flatMap((side) => {
          const name = grips[side];
          return name === undefined ? [] : [{ side, item, grip: name, at: gripOf(item, name).position.clone().applyQuaternion(placement.quaternion).add(goal) }];
        }));
        throw new Error(`${off.join('; ')}; ${item.current.position.distanceTo(goal).toFixed(3)} m off course end after ${limit} s`);
      }
      return false;
    };
    const to = (f: Frame<W>) => {
      const goal = path.to(f);
      const u = Number.isNaN(since) || seconds === 0 ? 0 : Math.min(1, (f.time - since) / seconds);
      if (dip > 0) goal.position.y -= dip * Math.sin(Math.PI * u) ** 2;
      return goal;
    };
    yield* hold(h, item, { to, motion: { ...motion, accel: motion.accel / factor }, until: (f) => { const ready = there(f); return together ? together(ready) : ready; } })();
  };
}

/** Carry several held items together: each keeps its grips at its endpoint until every carry settles. */
export function carryTogether<W>(h: Humanoid<W>, carries: readonly (readonly [Item, readonly Leg<W>[]])[], options: CarryOptions<W> = {}): Behaviour<W> {
  return function* () {
    const ready = carries.map(() => false);
    yield* parallel<Frame<W>>('all', ...carries.map(([item, legs], i) => carrying(h, item, legs, options, (there) => {
      ready[i] = there;
      return ready.every(Boolean);
    })));
  };
}

/**
 * where a course ends, followed as its frame moves it: an item has come to rest there once within
 * 1 cm of it and moving with it to within 5 cm/s — read as the item was last moved, a sub-step
 * before (against where the end was then, and how fast it went)
 */
class TrackedEnd {
  private end: Carrier | null = null;

  holds<W>(f: Frame<W>, item: Item, at: Readonly<Vector3>): boolean {
    const end = this.end ??= new Carrier(new Vector3().copy(at));
    if (!end.moved(f.time)) end.move(f.time, at);
    const velocity = _v.subVectors(end.prev.position, end.prev2.position).divideScalar(f.dt);
    const off = item.velocity(new Vector3()).sub(velocity);
    return item.current.position.distanceTo(end.prev.position) < 0.01 && off.length() < 0.05;
  }
}

/**
 * The hands on `item`'s grips, every sub-step: endless, or until `until`. Without `to`, the hands go
 * where the item goes (another moves it, or an unsupported hold inherits body travel). With `to`,
 * the hands carry it there: they go for its grips
 * as it would be, followed toward `to` at `motion`'s pace (its own motion fed forward) and kept
 * within the arms' reach. The after-hook follows the grips and fits the item to the wrists.
 */
export function hold<W>(h: Humanoid<W>, item: Item, options: { to?: Live<Placement, W>; motion?: Motion; until?: Exclude<Until<W>, 'reached'> } = {}): Behaviour<W> {
  const { to } = options;
  const motion = options.motion ?? CARRYING;
  return function* () {
    const grips = gripsOf(h, item);
    const sides = SIDES.filter((s) => grips[s] !== undefined);
    if (!sides.length) throw new Error(`"${item.name}" is not held by either hand`);
    if (!to) {
      yield* action<Frame<W>>({ until: options.until });
      return;
    }
    // (where the hands carry the item: followed toward `to`)
    const aim = new Carrier(item.current.position, item.current.quaternion);
    aim.prev.position.copy(item.prev.position);
    aim.prev.quaternion.copy(item.prev.quaternion);
    const position = new TrackedPoint();
    const rotation = new TrackedRotation();
    if (item.supported && item.mass > PREP.mass) {
      // Anticipatory preparation: 100 ms, with a small (5 mm) knee release.
      yield* action<Frame<W>>({ update: () => {
        h.asks.lower = Math.max(h.asks.lower, PREP.lower * h.proportions.scale);
      }, until: timePassed(PREP.seconds, 'seconds') });
    }
    // (carried off whatever it rested on)
    item.supported = false;
    yield* action<Frame<W>>({
      update: (f) => {
        if (carryAims(h).has(item)) throw new Error(`"${item.name}" has two carry aims in one sub-step`);
        const goal = live(to, f);
        // Advance the intended carry from its own history. Feeding the wrists' fitted
        // item back into this aim makes their lag steer the next target and can amplify a swivel.
        const turned = rotation.follow(aim.prev.quaternion, aim.current.quaternion, goal.quaternion ?? item.current.quaternion, { accel: motion.turnAccel ?? CARRYING.turnAccel, speed: motion.turnSpeed }, f.dt, _q);
        const at = clearBody(h, f.current, item, _at.copy(goal.position), turned);
        if (!item.wornBy) for (const side of sides) bringShoulder(h, f, side, _g1.copy(gripOf(item, grip(grips, side)).position).applyQuaternion(turned).add(at));
        const within = clearBody(h, f.current, item, inReach(h, f, item, grips, sides, at, turned), turned);
        aim.move(f.time, position.follow(aim.prev.position, aim.current.position, within, motion, f.dt, _p), turned);
        carryAims(h).set(item, aim);
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

const _v = new Vector3();
const _p = new Vector3();
const _at = new Vector3();
const _g1 = new Vector3();
const _q = new Quaternion();

const WORLD = { position: new Vector3(), quaternion: new Quaternion() };

// Tuned anticipatory knee release before a supported heavy load leaves its support.
const PREP = { mass: 2, seconds: 0.1, lower: 0.005 };
