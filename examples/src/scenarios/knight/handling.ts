import { Quaternion, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import {
  closeHand,
  handTo,
  hold,
  INDEX,
  lookAt,
  openHand,
  reached,
  release,
  SIDES,
  walkTo,
  type Behaviour,
  type Frame,
  type Grips,
  type Humanoid,
  type Item,
  type Live,
  type Placement,
  type Side,
  type World,
} from '@drawcall/animate';
import { minimumJerk } from '../../keys';
import { wrapAngle } from '../../math';
import { reported, reporting, type Report } from '../../report';
import type { Worn } from './worn';

// Handling gear: the small pieces the knight's behaviours are made of, over the package's tasks —
// a frame on the body, a route through it, the eyes first, taking hold, carrying, putting on.

type F = Frame<World>;

/** The knight: his body, what he wears, and the report his gaze and busy hands go to. */
export interface Knight {
  h: Humanoid<World>;
  worn: Worn;
  report: Report;
  /** how fast he goes about it (1: as timed here) */
  pace: number;
}

/** A frame moving with the body (or an item): where it is at a sub-step, and how much the distances given in it scale. */
export type Moving = (f: F) => Required<Placement> & { scale: number };

/**
 * the body's frame at bone `bone`'s joint, turned as the body faces (`h.gait.facing`): left +x, up +y,
 * ahead +z; distances in it scale with the body (as posed this sub-step: the trunk's bones are
 * placed before the tasks run)
 */
export const facingAt =
  (h: Humanoid<World>, bone: number): Moving =>
  (f) => ({ position: f.current.position(bone).clone(), quaternion: new Quaternion().setFromAxisAngle(UP, h.gait.facing), scale: h.proportions.scale });

/** the head's own frame, as it was posed last (what places the head now runs after the hands) */
export const headFrame =
  (h: Humanoid<World>): Moving =>
  (f) => ({ position: f.prev.position(INDEX.head).clone(), quaternion: f.prev.rotation(INDEX.head).clone(), scale: h.proportions.scale });

/** an item's own frame, as it is now */
export const itemFrame =
  (item: Item): Moving =>
  () => ({ position: item.current.position.clone(), quaternion: item.current.quaternion.clone(), scale: 1 });

/** `local` in `frame` in the world */
function inWorld(frame: Required<Placement> & { scale: number }, local: Placement): Required<Placement> {
  return {
    position: local.position.clone().multiplyScalar(frame.scale).applyQuaternion(frame.quaternion).add(frame.position),
    quaternion: frame.quaternion.clone().multiply(local.quaternion ?? IDENTITY),
  };
}

/** `local` in `frame`, where it is in the world at every sub-step */
export const placed =
  (frame: Moving, local: Placement): ((f: F) => Required<Placement>) =>
  (f) =>
    inWorld(frame(f), local);

/** a leg of a route: how long it takes at pace 1 (s), and where it goes in the route's frame (or where, given where the route set out from and where the leg before ended, in that frame) */
export type Leg = [seconds: number, to: Placement | ((start: Required<Placement>, last: Required<Placement>) => Placement)];

/**
 * A route through `frame` from where `item` is when it is first read: each leg from the last to its
 * placement at rest at both ends (minimum jerk, the rotation turned along), one after another.
 * `to` is where it is at a sub-step; `over` once it has gone through all its legs.
 */
export function route(k: Knight, item: Item, frame: Moving, legs: readonly Leg[]): Route {
  let start = NaN;
  let stops: Required<Placement>[] = [];
  const total = legs.reduce((sum, [seconds]) => sum + seconds / k.pace, 0);
  const to = (f: F): Required<Placement> => {
    const at = frame(f);
    if (Number.isNaN(start)) {
      start = f.time;
      const inverse = at.quaternion.clone().invert();
      // (where it sets out from, in the frame unscaled: the legs' placements are scaled)
      const from = { position: item.current.position.clone().sub(at.position).applyQuaternion(inverse).divideScalar(at.scale), quaternion: inverse.multiply(item.current.quaternion) };
      stops = [from];
      for (const [, leg] of legs) {
        const next = typeof leg === 'function' ? leg(from, stops[stops.length - 1]) : leg;
        stops.push({ position: next.position, quaternion: next.quaternion ?? stops[stops.length - 1].quaternion });
      }
    }
    let t = f.time - start;
    let i = 0;
    while (i < legs.length - 1 && t > legs[i][0] / k.pace) t -= legs[i++][0] / k.pace;
    const s = minimumJerk(t / (legs[i][0] / k.pace));
    const local = { position: stops[i].position.clone().lerp(stops[i + 1].position, s), quaternion: stops[i].quaternion.clone().slerp(stops[i + 1].quaternion, s) };
    return inWorld(at, local);
  };
  const over = (f: F) => !Number.isNaN(start) && f.time - start >= total;
  return { to, over };
}

/** where a route is at a sub-step, and whether it is over */
export interface Route {
  to: (f: F) => Required<Placement>;
  over: (f: F) => boolean;
}

/**
 * Items carried along their routes, each by the hands on its grips, together: until every route is
 * over and every item has come to rest at its end (within 1 cm, under 5 cm/s; one shared condition,
 * so no hand lets go before the others)
 */
export function carry(k: Knight, loads: readonly [Item, Grips, Route][]): Behaviour<World> {
  const there = (f: F) => loads.every(([item, , r]) => r.over(f) && settled(item, r.to(f)));
  return function* () {
    yield* parallel<F>('all', ...loads.map(([item, grips, r]) => hold(k.h, item, grips, { to: r.to, until: there })));
  };
}

/** `item` at `at`, and still (within 1 cm, under 5 cm/s) */
function settled(item: Item, at: Placement): boolean {
  return item.current.position.distanceTo(at.position) < 0.01 && item.current.position.distanceTo(item.prev.position) / STEP < 0.05;
}

const STEP = 1 / 60;

/**
 * `task` with the eyes on `at` first: they go there `lead` s (at pace 1) before it sets off and stay
 * until it ends (people fixate what they reach for ~0.5–1 s before the hand gets there: Land &
 * Hayhoe 2001), reported as the gaze
 */
export function eyesFirst(k: Knight, at: Live<Vector3, World>, task: Behaviour<World>, lead = 0.5): Behaviour<World> {
  return function* () {
    yield* parallel<F>(
      'race',
      function* () {
        yield* pause(k, lead)();
        yield* task();
      },
      lookAt(k.h.gazer, reported(k.report, 'gaze', at)),
    );
  };
}

/** a while doing nothing new (s at pace 1): a natural pause between moves */
export const pause = (k: Knight, seconds: number): Behaviour<World> =>
  function* () {
    yield* action({ until: timePassed(seconds / k.pace, 'seconds') });
  };

/** the hands `hands` ([item, grip] each) open, go to their grips together (one shared condition: none goes before all are there) and close on them */
export function reach(k: Knight, hands: Partial<Record<Side, [Item, string]>>): Behaviour<World> {
  const { h } = k;
  const sides = SIDES.filter((s) => hands[s]);
  const on = (side: Side) => {
    const hand = hands[side];
    if (!hand) throw new Error(`no grip for the ${side} hand`);
    return { item: hand[0], grip: hand[0].grips[hand[1]], name: hand[1] };
  };
  const there = (f: F) => sides.every((side) => reached(f.prev2, f.prev, f.dt, INDEX[`${side}Hand`], on(side).grip, on(side).item));
  return busy(k, function* () {
    for (const side of sides) yield* openHand(h, side)();
    yield* parallel<F>('all', ...sides.map((side) => handTo(h, side, on(side).grip, { on: on(side).item, until: there })));
    for (const side of sides) yield* closeHand(h, side, on(side).item, on(side).name)();
  });
}

/** Where the body stands to take something: the grips' middle `ahead` of it (× the arm's length) and `aside` to its left (m; negative: to its right). */
export interface Stand {
  ahead?: number;
  aside?: number;
}

/**
 * Taking hold of what lies on a table, a stand or a rack: walking up to stand facing `face` with the
 * grips' middle in reach where `stand` says — unless each is in reach of its shoulder already, the
 * body facing so: a step of a few cm is not taken — then the eyes on it and the hands to them
 * together (`reach`)
 */
export function take(k: Knight, hands: Partial<Record<Side, [Item, string]>>, face: number, { ahead = AHEAD, aside = 0 }: Stand = {}): Behaviour<World> {
  const grips = SIDES.flatMap((side) => {
    const hand = hands[side];
    return hand ? [{ side, at: hand[0].grips[hand[1]].position.clone().applyQuaternion(hand[0].current.quaternion).add(hand[0].current.position) }] : [];
  });
  const middle = grips.reduce((sum, { at }) => sum.add(at), new Vector3()).divideScalar(grips.length);
  const h = k.h;
  const turned = () => Math.abs(wrapAngle(face - h.gait.facing)) < SQUARE;
  const inReach = () => turned() && grips.every(({ side, at }) => horizontal(h.pose.position(INDEX[`${side}UpperArm`]), at) < REACH * h.proportions.armLength);
  return function* () {
    const to = middle.clone().addScaledVector(new Vector3(Math.cos(face), 0, -Math.sin(face)), -aside);
    // (a moment's pause first, the arms settling from what they did; walked up to until there,
    // turned and stopped, the eyes on the way — not waiting for the feet to square up: `balance`
    // does that as the hands go)
    yield* pause(k, SETTLE)();
    const there = to.clone().addScaledVector(new Vector3(Math.sin(face), 0, Math.cos(face)), -ahead * h.proportions.armLength);
    const arrived = (f: F) => turned() && h.gait.walk < 0.05 && horizontal(f.prev.com(_com), there) < ARRIVED * h.proportions.scale;
    if (!inReach()) yield* walkTo(h, { to, face, within: ahead * h.proportions.armLength, until: arrived })();
    // (the reach under way as the eyes go to it: the arms are its, not free)
    yield* busy(k, eyesFirst(k, middle, reach(k, hands)))();
  };
}

/** how far in front of what it takes the body stands (× the arm's length, unless said); how far a grip may be from its shoulder on the floor's plane to be in reach without a step (× the arm's length: lower, the body bows for it), the body facing within SQUARE (rad) of the way asked */
const AHEAD = 0.6;
/** the pause before going for the next thing (s at pace 1) */
const SETTLE = 0.5;
const REACH = 0.75;
/** arrived where it stands to take something: this near (m, default body) */
const ARRIVED = 0.12;
const _com = new Vector3();
const SQUARE = 0.3;

/**
 * Hand `side` into `item` (a gauntlet, a shield's straps): to its grip `entry`, in line, then slowly
 * on to its grip `inside` (fine work: a third of a reach's pace), turning as they say; until the
 * wrist is there (within 1 cm: the hand's turn is as near as the arm takes it)
 */
export function slideIn(k: Knight, side: Side, item: Item, entry: string, inside: string): Behaviour<World> {
  const at = (grip: string) => (f: F) => f.prev.position(INDEX[`${side}Hand`]).distanceTo(item.current.position.clone().add(item.grips[grip].position.clone().applyQuaternion(item.current.quaternion)));
  return function* () {
    yield* handTo(k.h, side, item.grips[entry], { on: item, until: (f) => at(entry)(f) < 0.02 })();
    yield* handTo(k.h, side, item.grips[inside], { on: item, accel: 3, speed: 0.4, until: (f) => at(inside)(f) < 0.01 })();
  };
}

/**
 * Letting go with the hands `sides`: the package's `release` (they draw back and down), or, given
 * `away`, each off its own way (in the body's frame facing as it does: left +x, up +y, ahead +z) —
 * from the sides of the head back and down is behind the shoulders, out of the arms' reach. Then
 * the free arms take them.
 */
export function letGo(k: Knight, sides: readonly Side[], away?: Partial<Record<Side, Vector3>>): Behaviour<World> {
  if (!away) return busy(k, release(k.h, sides));
  const by = (side: Side) => {
    const v = away[side];
    if (!v) throw new Error(`no way off for the ${side} hand`);
    return v;
  };
  return busy(k, function* () {
    const turned = new Quaternion().setFromAxisAngle(UP, k.h.gait.facing);
    const targets = sides.map((side) => ({ position: by(side).clone().multiplyScalar(k.h.proportions.scale).applyQuaternion(turned).add(k.h.pose.position(INDEX[`${side}Hand`])) }));
    const there = (f: F) => sides.every((side, i) => reached(f.prev2, f.prev, f.dt, INDEX[`${side}Hand`], targets[i]));
    for (const side of sides) yield* openHand(k.h, side)();
    yield* parallel<F>('all', ...sides.map((side, i) => handTo(k.h, side, targets[i], { until: there })));
  });
}

/** the hands busy while `task` runs (the metrics judge the arms nobody asks anything of as free) */
const busy = (k: Knight, task: Behaviour<World>): Behaviour<World> => reporting(k.report, ['leftHand', 'rightHand'], task);
/** marks `item` worn on `on` (a bone or an item), at once; given `settle` (in `on`'s frame, scaled with the body for a bone), it settles there */
export const put = (k: Knight, item: Item, on: number | Item, settle?: Placement): Behaviour<World> =>
  function* () {
    const scale = typeof on === 'number' ? k.h.proportions.scale : 1;
    k.worn.put(item, on, settle ? { position: settle.position.clone().multiplyScalar(scale), quaternion: settle.quaternion } : null);
  };

const UP = new Vector3(0, 1, 0);
const IDENTITY = new Quaternion();

/** the distance between `a` and `b` on the floor's plane */
const horizontal = (a: Readonly<Vector3>, b: Readonly<Vector3>) => Math.hypot(a.x - b.x, a.z - b.z);
