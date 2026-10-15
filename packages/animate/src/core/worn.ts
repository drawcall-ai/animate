import { Quaternion, Vector3 } from 'three';
import type { Frame } from './body';
import type { Item } from './carrier';
import { follow, followRotation } from './follow';
import type { Behaviour, Motion, Placement } from './goal';
export interface Wearer {
  readonly scale: number;
  readonly worn: Map<Item, Wearing>;
}

/**
 * An item a body wears (`Body.worn`): what it is worn on (a bone, or another item: a sword in
 * its scabbard), where it settles to there if anywhere (`to`, in that frame; for a bone, scaled with
 * the body) and how; and where it sits there now (null until the body first carries it), with the
 * two sub-steps before.
 */
export interface Wearing {
  readonly on: number | Item;
  readonly to: Placement | null;
  readonly motion: Motion;
  sits: { position: Vector3; quaternion: Quaternion; prev: Vector3; prev2: Vector3; prevQ: Quaternion; prev2Q: Quaternion } | null;
}

/** how a worn item settles where it goes unless asked otherwise (m/s², m/s, rad/s², rad/s): gently, as a helm onto the head */
export const SETTLING = { accel: 2, speed: 0.4, turnAccel: 8, turnSpeed: 2 } satisfies Motion;
/**
 * `item` worn on `on` (a bone, or another item) from this sub-step on: it goes with it as it sat
 * when put on, or, given `to` (in `on`'s frame; for a bone scaled with the body), it settles there
 * at `motion`'s pace (a helm onto the head, a sword home into its scabbard). The body moves it from
 * then on, after its behaviour each sub-step: nothing else may (a second mover throws); it bears
 * its weight (taking it up as it does what it holds). What it wears from the start, it is made with
 * (`HumanoidOptions.wearing`). At once.
 */
export function wear<W>(h: Wearer, item: Item, on: number | Item, options: { to?: Placement; motion?: Motion } = {}): Behaviour<W> {
  return function* () {
    if (item.wornBy) throw new Error('the item is worn already');
    if (on === item) throw new Error('an item cannot be worn on itself');
    const to = options.to && typeof on === 'number' ? { position: options.to.position.clone().multiplyScalar(h.scale), quaternion: options.to.quaternion } : (options.to ?? null);
    h.worn.set(item, { on, to, motion: options.motion ?? SETTLING, sits: null });
    depthOf(h.worn, item);
    item.wornBy = h;
    item.supported = false;
  };
}

/** `item` taken off: from this sub-step on, whatever moves it next (the hands that hold it). At once. */
export function takeOff<W>(h: Wearer, item: Item): Behaviour<W> {
  return function* () {
    if (!h.worn.delete(item)) throw new Error('the item is not worn');
    item.wornBy = null;
  };
}

/** Move attachments after the body's behaviour, before its pose becomes history. */
export function moveWorn<W>(body: Wearer, f: Frame<W>): void {
  const order = [...body.worn.keys()].sort((a, b) => depthOf(body.worn, a) - depthOf(body.worn, b));
  for (const item of order) {
    const wearing = body.worn.get(item);
    if (wearing) place(f, item, wearing, body.worn);
  }
}

/** how deep `item` is worn: 1 on a bone (or on something not worn), 2 on that, …; throws on a loop */
function depthOf(worn: ReadonlyMap<Item, Wearing>, item: Item): number {
  let depth = 0;
  let at: number | Item = item;
  while (typeof at !== 'number') {
    const wearing = worn.get(at);
    if (!wearing) break;
    if (++depth > worn.size) throw new Error('items worn on each other in a loop');
    at = wearing.on;
  }
  return depth;
}

/** `item` moved to where it sits on its carrier now (put on: as it sits there now; settling: on toward where it goes) */
function place<W>(f: Frame<W>, item: Item, wearing: Wearing, worn: ReadonlyMap<Item, Wearing>) {
  const on = wearing.on;
  const [position, quaternion] = typeof on === 'number' ? [f.current.position(on), _r.copy(f.current.rotation(on))] : [on.current.position, _r.copy(on.current.quaternion)];
  if (!wearing.sits) {
    // (as it sits, its carrier as it was when the item was last moved: a bone as last posed, an item worn as before it was moved this sub-step)
    const [was, wasQ] = typeof on === 'number' ? [f.prev.position(on), f.prev.rotation(on)] : worn.has(on) ? [on.prev.position, on.prev.quaternion] : [position, quaternion];
    const inverse = wasQ.clone().invert();
    const local = item.current.position.clone().sub(was).applyQuaternion(inverse);
    const turned = inverse.multiply(item.current.quaternion);
    wearing.sits = { position: local, quaternion: turned, prev: local.clone(), prev2: local.clone(), prevQ: turned.clone(), prev2Q: turned.clone() };
  }
  const at = wearing.sits;
  if (wearing.to) {
    at.prev2.copy(at.prev);
    at.prev.copy(at.position);
    follow(at.prev2, at.prev, wearing.to.position, wearing.motion, f.dt, at.position);
    if (wearing.to.quaternion) {
      at.prev2Q.copy(at.prevQ);
      at.prevQ.copy(at.quaternion);
      followRotation(at.prev2Q, at.prevQ, wearing.to.quaternion, { accel: wearing.motion.turnAccel ?? SETTLING.turnAccel, speed: wearing.motion.turnSpeed }, f.dt, at.quaternion);
    }
  }
  item.move(f.time, _p.copy(at.position).applyQuaternion(quaternion).add(position), _q.copy(quaternion).multiply(at.quaternion));
}

/** What a body wears from the start (`HumanoidOptions.wearing`): an item, the bone it is on, and where it sits in that bone's frame. */
export interface Dressed {
  item: Item;
  on: number;
  at: Placement;
}

const _p = new Vector3();
const _q = new Quaternion();
const _r = new Quaternion();
