import { Quaternion, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import type { Frame } from '../../core/body';
import { Carrier, Item } from '../../core/carrier';
import { live, type Behaviour, type Live, type Motion, type Placement, type Until } from '../../core/goal';
import { loadFactor } from '../../core/load';
import { TrackedPoint, TrackedRotation } from '../../core/track';
import { SIDES } from '../bones';
import { course, type Course, type Waypoint } from '../course';
import type { Humanoid } from '../humanoid';
import { grip, gripOf, gripsOf } from './grips';
import { following, LEADING } from './reach';
import { clearBody } from './clearance';
import { carryAims } from './hold';
import { bringShoulder } from '../reach-posture';

// Holding and carrying: the hands on an item's grips, carrying it where it goes.

/** how fast a held item is carried where it is to go (m/s², m/s, rad/s², rad/s): calmly */
export const CARRYING = { accel: 6, speed: 3, turnAccel: 8, turnSpeed: 4 } satisfies Motion;

/** the longest a carried item takes to come to rest at its course's end once it is over, unless told (s) */
const RESTING = 2;

interface CarryOptions {
  frame?: Live<Placement>;
  pace?: number;
  motion?: Motion;
  limit?: number;
}

/** where a carry takes an item: along timed waypoints (a course), or to a placement, live */
export type Way = readonly Waypoint[] | Live<Placement>;

/**
 * Carry a held item along `way` and end once it has come to rest there; or several held items at once,
 * `[item, way]` each, every one kept at its end until all have come to rest. Waypoints are in metres in
 * the world by default; `frame` selects an item frame or a bone frame through `onItem` or `onBone`.
 * Waypoint seconds describe an unloaded item: its mass divides the course pace by `loadFactor(mass)`.
 * A placement `way` is followed at `motion`'s pace. Ends within 5 mm and 5 cm/s of the cleared end;
 * still settling `limit` s after the course is over, it is a problem in the dev log (`Body.log`) and
 * keeps going: lateness never throws.
 */
export function carry(h: Humanoid, item: Item, way: Way, options?: CarryOptions): Behaviour;
export function carry(h: Humanoid, items: readonly (readonly [Item, Way])[], options?: CarryOptions): Behaviour;
export function carry(h: Humanoid, what: Item | readonly (readonly [Item, Way])[], way?: Way | CarryOptions, options: CarryOptions = {}): Behaviour {
  if (what instanceof Item) {
    if (!isWay(way)) throw new Error(`carry: no way for "${what.name}"`);
    return carrying(h, what, way, options);
  }
  if (isWay(way)) throw new Error('carry: several items take their ways with them');
  const shared = way ?? {};
  return function* () {
    const ready = what.map(() => false);
    yield* parallel<Frame>('all', ...what.map(([item, to], i) => carrying(h, item, to, shared, (there) => {
      ready[i] = there;
      return ready.every(Boolean);
    })));
  };
}

function carrying(h: Humanoid, item: Item, way: Way, options: CarryOptions, together?: (ready: boolean) => boolean): Behaviour {
  return function* () {
    const { pace = 1, limit = RESTING } = options;
    const frame = options.frame ?? WORLD;
    const grips = gripsOf(h, item);
    const lag = grips[LEADING] === undefined && h.holding[LEADING] ? following(item, grips) : { delay: 0, slower: 0 };
    const factor = loadFactor(item.mass);
    const motion = options.motion ?? CARRYING;
    const aim = new CarryAim(h, item, { ...motion, accel: motion.accel / factor });
    const from = item.current.position.y;
    // Take-up and compliance belong to lifting off a support, not every carried waypoint.
    const load = item.supported ? factor - 1 : 0;
    // Mass slows the lift’s acceleration and path.
    const path = isCourse(way) ? course(item, frame, way, { pace: pace * (1 - lag.slower) / factor, delay: lag.delay }) : toward(item, way);
    const end = new TrackedEnd();
    let since = NaN, late = false;
    let dip = 0;
    const seconds = 2.4 * load;
    const there = (f: Frame) => {
      if (!path.over(f)) return false;
      if (Number.isNaN(since)) since = f.time;
      aim.read(f, to);
      const placement = aim.goal;
      const goal = placement.position;
      // Load compliance: https://pmc.ncbi.nlm.nih.gov/articles/PMC4443842/ (F = k × displacement).
      // Tuned, not measured: an upward carry dips 2.7 cm over 0.8 s at 8 kg, then recovers.
      dip = 0.08 * load * Math.min(1, Math.max(0, goal.y - from) / 0.1);
      if (end.holds(f, item, goal) && (dip === 0 || f.time - since >= seconds)) return true;
      if (!late && f.time - since > limit) {
        late = true;
        f.dev?.append(f.time, { check: `late carry: course end distance after ${limit} s (m)`, value: item.current.position.distanceTo(goal), limit: END.distance, where: item.name });
      }
      return false;
    };
    const to = (f: Frame) => {
      const goal = path.to(f);
      const u = Number.isNaN(since) || seconds === 0 ? 0 : Math.min(1, (f.time - since) / seconds);
      if (dip > 0) goal.position.y -= dip * Math.sin(Math.PI * u) ** 2;
      return goal;
    };
    yield* holding(h, item, aim, { to, until: (f) => { const ready = there(f); return together ? together(ready) : ready; } })();
  };
}

const isCourse = (way: Way): way is readonly Waypoint[] => Array.isArray(way);
const isWay = (x: Way | CarryOptions | undefined): x is Way => x !== undefined && (Array.isArray(x) || typeof x === 'function' || 'position' in x);

/** a placement as a course already gone all its way: the item is carried there at the carry's pace */
function toward(item: Item, to: Live<Placement>): Course {
  return {
    to: (f) => {
      const at = live(to, f);
      return { position: at.position.clone(), quaternion: (at.quaternion ?? item.current.quaternion).clone() };
    },
    over: () => true,
  };
}

/**
 * where a cleared course ends, followed as its frame moves it: an item has come to rest there once within
 * 5 mm of it and moving with it to within 5 cm/s — read as the item was last moved, a sub-step
 * before (against where the end was then, and how fast it went)
 */
const END = { distance: 0.005, speed: 0.05 };

class TrackedEnd {
  private end: Carrier | null = null;

  holds(f: Frame, item: Item, at: Readonly<Vector3>): boolean {
    const end = this.end ??= new Carrier(new Vector3().copy(at));
    if (!end.moved(f.time)) end.move(f.time, at);
    const velocity = _v.subVectors(end.prev.position, end.prev2.position).divideScalar(f.dt);
    const off = item.velocity(new Vector3()).sub(velocity);
    return item.current.position.distanceTo(end.prev.position) < END.distance && off.length() < END.speed;
  }
}

/**
 * The hands on `item`'s grips, every sub-step: endless, or until `until`. Without `to`, the hands go
 * where the item goes (another moves it, or an unsupported hold inherits body travel). With `to`,
 * the hands carry it there: they go for its grips
 * as it would be, followed toward `to` at `motion`'s pace (its own motion fed forward).
 * The arm solver bounds the wrists; carry rejects an unreachable endpoint rather than moving it
 * silently within reach. The after-hook follows the grips and fits the item to the wrists.
 */
export function hold(h: Humanoid, item: Item, options: { to?: Live<Placement>; motion?: Motion; until?: Exclude<Until, 'reached'> } = {}): Behaviour {
  return () => holding(h, item, new CarryAim(h, item, options.motion ?? CARRYING), options)();
}

/** One load path: clear its course before following it, and judge the same endpoint. */
class CarryAim {
  readonly goal = { position: new Vector3(), quaternion: new Quaternion() };
  private readonly carrier: Carrier;
  private readonly nominal: Carrier;
  private readonly position = new TrackedPoint();
  private readonly rotation = new TrackedRotation();
  private readonly at = new Vector3();
  private readonly turned = new Quaternion();
  private time = NaN;

  constructor(private readonly h: Humanoid, private readonly item: Item, private readonly motion: Motion) {
    this.nominal = new Carrier(item.current.position, item.current.quaternion);
    this.carrier = new Carrier(item.current.position, item.current.quaternion);
    this.nominal.prev.position.copy(item.prev.position);
    this.nominal.prev.quaternion.copy(item.prev.quaternion);
  }

  read(f: Frame, to: Live<Placement>): Carrier {
    if (this.time === f.time) return this.carrier;
    this.time = f.time;
    const { nominal: aim, goal, h, item, motion } = this;
    const target = live(to, f);
    goal.position.copy(target.position);
    goal.quaternion.copy(target.quaternion ?? item.current.quaternion);
    // Continue the intended motion, rather than feeding wrist-fitting lag back into it.
    const turned = this.rotation.follow(aim.prev.quaternion, aim.current.quaternion, goal.quaternion,
      { accel: motion.turnAccel ?? CARRYING.turnAccel, speed: motion.turnSpeed }, f.dt, this.turned);
    clearBody(h, f, item, goal.position, turned);
    this.position.follow(aim.prev.position, aim.current.position, goal.position, motion, f.dt, this.at);
    // Constraint correction is not velocity to feed back into the intended path.
    aim.move(f.time, this.at, turned);
    clearBody(h, f, item, this.at, turned);
    this.carrier.move(f.time, this.at, turned);
    return this.carrier;
  }
}

function holding(h: Humanoid, item: Item, path: CarryAim, options: { to?: Live<Placement>; motion?: Motion; until?: Exclude<Until, 'reached'> } = {}): Behaviour {
  const { to } = options;
  return function* () {
    const grips = gripsOf(h, item);
    const sides = SIDES.filter((s) => grips[s] !== undefined);
    if (!sides.length) throw new Error(`"${item.name}" is not held by either hand`);
    if (!to) {
      yield* action<Frame>({ until: options.until });
      return;
    }
    if (item.supported && item.mass > 2 && (item.current.position.y >= h.proportions.hipHeight || h.proportions.hipHeight - h.pose.position(0).y < 0.005 * h.scale)) {
      // Tuned APA: 100 ms / 5 mm before support leaves; a low reach already prepares the knees.
      yield* action<Frame>({ update: () => {
        h.asks.lower = Math.max(h.asks.lower, 0.005 * h.scale);
      }, until: timePassed(0.1, 'seconds') });
    }
    // (carried off whatever it rested on)
    item.supported = false;
    yield* action<Frame>({
      update: (f) => {
        if (carryAims(h).has(item)) throw new Error(`"${item.name}" has two carry aims in one sub-step`);
        const aim = path.read(f, to);
        if (!item.wornBy) for (const side of sides) bringShoulder(h, f, side,
          _g1.copy(gripOf(item, grip(grips, side)).position).applyQuaternion(aim.current.quaternion).add(path.goal.position));
        carryAims(h).set(item, aim);
      },
      until: options.until,
    });
  };
}

const _v = new Vector3();
const _g1 = new Vector3();

const WORLD = { position: new Vector3(), quaternion: new Quaternion() };
