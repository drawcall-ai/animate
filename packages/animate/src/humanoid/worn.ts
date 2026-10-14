import { Quaternion, Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import type { Frame } from '../core/body';
import type { Item } from '../core/carrier';
import { follow, followRotation } from '../core/follow';
import type { Behaviour, Motion, Placement } from '../core/goal';
import { INDEX, SIDES } from './bones';
import type { Humanoid } from './humanoid';

/** An item a body wears: what it is worn on (a bone, or another item: a sword in its scabbard), and the seat it settles into there, if any. */
export interface Wearing {
  readonly on: number | Item;
  /** where it settles in `on`'s frame (m; for a bone, scaled with the body) */
  readonly seat: Placement | null;
  readonly motion: Motion;
}

/** what a worn item keeps: where it sits in its carrier's frame, now and the two sub-steps before (null until it is first carried) */
interface Fit extends Wearing {
  at: { position: Vector3; quaternion: Quaternion; prev: Vector3; prev2: Vector3; prevQ: Quaternion; prev2Q: Quaternion } | null;
}

/** how a worn item settles into its seat unless asked otherwise (m/s², m/s, rad/s², rad/s): gently, as a helm onto the head */
const SETTLING = { accel: 2, speed: 0.4, turnAccel: 8, turnSpeed: 2 } satisfies Motion;

const fits = new WeakMap<object, Map<Item, Fit>>();

/** what `h` wears (`Humanoid.worn`) */
export function wornBy<W>(h: Humanoid<W>): Map<Item, Fit> {
  let worn = fits.get(h);
  if (!worn) fits.set(h, (worn = new Map()));
  return worn;
}

/**
 * `item` worn on `on` (a bone, or another item) from this sub-step on: it goes with it as it sat
 * when put on, or, given `seat` (in `on`'s frame; for a bone scaled with the body), it settles
 * there at `motion`'s pace. The body moves it from then on, after its behaviour each sub-step:
 * nothing else may (a second mover throws). At once.
 */
export function wear<W>(h: Humanoid<W>, item: Item, on: number | Item, options: { seat?: Placement; motion?: Motion } = {}): Behaviour<W> {
  return function* () {
    const worn = wornBy(h);
    if (worn.has(item)) throw new Error('the item is worn already');
    if (on === item) throw new Error('an item cannot be worn on itself');
    const seat = options.seat && typeof on === 'number' ? { position: options.seat.position.clone().multiplyScalar(h.proportions.scale), quaternion: options.seat.quaternion } : (options.seat ?? null);
    worn.set(item, { on, seat, motion: options.motion ?? SETTLING, at: null });
    depthOf(worn, item);
  };
}

/** `item` taken off: from this sub-step on, whatever moves it next (the hands that hold it). At once. */
export function takeOff<W>(h: Humanoid<W>, item: Item): Behaviour<W> {
  return function* () {
    if (!wornBy(h).delete(item)) throw new Error('the item is not worn');
  };
}

/**
 * The worn items carried (each where its carrier is now, those worn on bones first, then those on
 * them, …) and what the body carries loaded onto its bones (held items in the hands that hold
 * them, worn ones on the bone their carriers are worn on), every sub-step, endless: the
 * `Humanoid` runs it after its behaviour.
 */
export function carryWorn<W>(h: Humanoid<W>): Behaviour<W> {
  return function* () {
    yield* action<Frame<W>>({
      update: (f) => {
        const worn = wornBy(h);
        const order = [...worn.keys()].sort((a, b) => depthOf(worn, a) - depthOf(worn, b));
        for (const item of order) {
          const fit = worn.get(item);
          if (fit) place(f, item, fit, worn);
        }
        load(h, f, worn);
      },
    });
  };
}

/** how deep `item` is worn: 1 on a bone (or on something not worn), 2 on that, …; throws on a loop */
function depthOf(worn: Map<Item, Fit>, item: Item): number {
  let depth = 0;
  let at: number | Item = item;
  while (typeof at !== 'number') {
    const fit = worn.get(at);
    if (!fit) break;
    if (++depth > worn.size) throw new Error('items worn on each other in a loop');
    at = fit.on;
  }
  return depth;
}

/** `item` moved to where it sits on its carrier now (put on: as it sits there now; settling: on toward its seat) */
function place<W>(f: Frame<W>, item: Item, fit: Fit, worn: Map<Item, Fit>) {
  const [position, quaternion] = carrierAt(f, fit.on);
  if (!fit.at) {
    // (as it sits, its carrier as it was when the item was last moved: a bone as last posed, an item worn as before it was moved this sub-step)
    const on = fit.on;
    const [was, wasQ] = typeof on === 'number' ? [f.prev.position(on), f.prev.rotation(on)] : worn.has(on) ? [on.prev.position, on.prev.quaternion] : [position, quaternion];
    const inverse = wasQ.clone().invert();
    const local = item.current.position.clone().sub(was).applyQuaternion(inverse);
    const turned = inverse.multiply(item.current.quaternion);
    fit.at = { position: local, quaternion: turned, prev: local.clone(), prev2: local.clone(), prevQ: turned.clone(), prev2Q: turned.clone() };
  }
  const at = fit.at;
  if (fit.seat) {
    at.prev2.copy(at.prev);
    at.prev.copy(at.position);
    follow(at.prev2, at.prev, fit.seat.position, fit.motion, f.dt, at.position);
    if (fit.seat.quaternion) {
      at.prev2Q.copy(at.prevQ);
      at.prevQ.copy(at.quaternion);
      followRotation(at.prev2Q, at.prevQ, fit.seat.quaternion, { accel: fit.motion.turnAccel ?? SETTLING.turnAccel, speed: fit.motion.turnSpeed }, f.dt, at.quaternion);
    }
  }
  item.move(f.time, _p.copy(at.position).applyQuaternion(quaternion).add(position), _q.copy(quaternion).multiply(at.quaternion));
}

/** where a carrier is now: a bone as posed this sub-step, an item as it was last moved */
function carrierAt<W>(f: Frame<W>, on: number | Item): [Readonly<Vector3>, Quaternion] {
  if (typeof on === 'number') return [f.current.position(on), _r.copy(f.current.rotation(on))];
  return [on.current.position, _r.copy(on.current.quaternion)];
}

/** the masses the body carries, loaded onto its bones in this sub-step's pose */
function load<W>(h: Humanoid<W>, f: Frame<W>, worn: Map<Item, Fit>) {
  const pose = f.current;
  const mass = new Map<number, number>();
  const moment = new Map<number, Vector3>();
  const add = (bone: number, m: number, at: Vector3) => {
    mass.set(bone, (mass.get(bone) ?? 0) + m);
    let sum = moment.get(bone);
    if (!sum) moment.set(bone, (sum = new Vector3()));
    sum.addScaledVector(at, m);
  };
  /** the bones `item` bears on: the one it is worn on (through what it hangs from), or the hands holding it (or what it hangs from) */
  const bearers = (item: Item): number[] => {
    let at: number | Item = item;
    for (;;) {
      if (typeof at === 'number') return [at];
      const fit = worn.get(at);
      if (!fit) break;
      at = fit.on;
    }
    const top = at;
    return SIDES.filter((s) => h.holding[s]?.item === top).map((s) => INDEX[`${s}Hand`]);
  };
  const items = new Set<Item>([...worn.keys(), ...SIDES.flatMap((s) => h.holding[s]?.item ?? [])]);
  for (const item of items) {
    if (item.mass === 0) continue;
    const bones = bearers(item);
    const centre = _c.copy(item.centre).applyQuaternion(item.current.quaternion).add(item.current.position);
    for (const bone of bones) add(bone, item.mass / bones.length, centre);
  }
  for (let bone = 0; bone < pose.skeleton.bones.length; bone++) {
    const m = mass.get(bone) ?? 0;
    const sum = moment.get(bone);
    if (m === 0 || !sum) {
      pose.setLoad(bone, 0, ZERO);
      continue;
    }
    pose.setLoad(bone, m, sum.divideScalar(m).sub(pose.position(bone)).applyQuaternion(_q.copy(pose.rotation(bone)).invert()));
  }
}

const ZERO = new Vector3();
const _p = new Vector3();
const _c = new Vector3();
const _q = new Quaternion();
const _r = new Quaternion();
