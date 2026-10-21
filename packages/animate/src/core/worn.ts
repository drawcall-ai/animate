import { Quaternion, Vector3 } from 'three';
import type { Body, Frame } from './body';
import type { Item } from './carrier';
import { follow, followRotation } from './follow';
import type { Behaviour, Motion, Placement } from './goal';
import type { Pose } from './pose';

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

/** How `wear` puts it on. */
export interface WearOptions {
  /** where it settles, in the frame of what it is worn on */
  to?: Placement;
  /** the pace it settles at */
  motion?: Motion;
}
/** how a worn item settles where it goes unless asked otherwise (m/s², m/s, rad/s², rad/s): gently, as a helm onto the head */
export const SETTLING = { accel: 2, speed: 0.4, turnAccel: 8, turnSpeed: 2 } satisfies Motion;
/**
 * `item` worn on `on` (a bone, or another item) from this sub-step on: it goes with it as it sat
 * when put on, or, given `to` (in `on`'s frame; for a bone scaled with the body), it settles there
 * at `motion`'s pace (a helm onto the head, a sword home into its scabbard). The body moves it from
 * then on, after its behaviour each sub-step: nothing else may (a second mover throws); it bears
 * its weight (taking it up as it does what it holds). What it wears from the start, it is made with
 * (`BodyOptions.wearing`). At once.
 */
export function wear(h: Body, item: Item, on: number | Item, options: WearOptions = {}): Behaviour {
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
export function takeOff(h: Body, item: Item): Behaviour {
  return function* () {
    if (!h.worn.delete(item)) throw new Error('the item is not worn');
    item.wornBy = null;
  };
}

/** Move attachments after the body's behaviour, before its pose becomes history. */
export function moveWorn(body: Body, f: Frame): void {
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
function place(f: Frame, item: Item, wearing: Wearing, worn: ReadonlyMap<Item, Wearing>) {
  const on = wearing.on;
  const [position, quaternion] = typeof on === 'number' ? [f.current.position(on), _r.copy(f.current.rotation(on))] : [on.current.position, _r.copy(on.current.quaternion)];
  if (!wearing.sits) {
    // (as it sits, its carrier as it was when the item was last moved: a bone as last posed, an item worn as before it was moved this sub-step)
    const [was, wasQ] = typeof on === 'number' ? [f.prev.position(on), f.prev.rotation(on)] : worn.has(on) ? [on.prev.position, on.prev.quaternion] : [position, quaternion];
    const inverse = wasQ.clone().invert();
    const local = item.current.position.clone().sub(was).applyQuaternion(inverse);
    const turned = inverse.multiply(item.current.quaternion);
    wearing.sits = sitsAt(local, turned);
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

/** Attachment history starts stationary at this local placement. */
function sitsAt(position: Vector3, quaternion: Quaternion): NonNullable<Wearing['sits']> {
  return { position, quaternion, prev: position.clone(), prev2: position.clone(), prevQ: quaternion.clone(), prev2Q: quaternion.clone() };
}

const _p = new Vector3();
const _q = new Quaternion();
const _r = new Quaternion();

/**
 * How much of an item's weight a body bears (`Body.borne`): its share (0 … 1) now and the two
 * sub-steps before, its mass borne (kg), and the bones it bears on (or last bore on).
 */
export interface Bearing {
  share: number;
  prev: number;
  prev2: number;
  kg: number;
  bones: number[];
}

const BEARING = { accel: 16, speed: 4 };

/** `wearing` worn and borne from the start, each item placed where it sits on its bone in `pose` (the body's first) and its weight loaded there */
export function dress(h: Body, pose: Pose, wearing: readonly Dressed[]): void {
  for (const { item, on, at } of wearing) {
    const position = at.position.clone();
    const quaternion = at.quaternion?.clone() ?? new Quaternion();
    h.worn.set(item, { on, to: null, motion: SETTLING, sits: sitsAt(position, quaternion) });
    item.wornBy = h;
    item.supported = false;
    item.place(0, position.clone().applyQuaternion(pose.rotation(on)).add(pose.position(on)), pose.rotation(on).clone().multiply(quaternion));
    h.borne.set(item, { share: 1, prev: 1, prev2: 1, kg: item.mass, bones: [on] });
  }
  loadBones(h, pose);
}

/** the weight the body bears, its share of each item's followed on, loaded onto its bones in this sub-step's pose */
export function load(h: Body, f: Frame) {
  /** the bones `item` bears on: the one it is worn on (through what it hangs from), or the hands holding it (or what it hangs from) off its support */
  const bearers = (item: Item): number[] => {
    let at: number | Item = item;
    for (;;) {
      if (typeof at === 'number') return [at];
      const wearing = h.worn.get(at);
      if (!wearing) break;
      at = wearing.on;
    }
    const top = at;
    if (top.supported || top.wornBy) return [];
    return Object.entries(h.hands).filter(([hand]) => h.holding[hand]?.item === top).map(([, bone]) => bone);
  };
  const items = new Set<Item>([...h.worn.keys(), ...heldItems(h), ...h.borne.keys()]);
  for (const item of items) {
    if (item.mass === 0) continue;
    const bones = bearers(item);
    let bearing = h.borne.get(item);
    if (!bearing) h.borne.set(item, (bearing = { share: 0, prev: 0, prev2: 0, kg: 0, bones }));
    // (followed from its history: taken up, or given up, within an acceleration)
    [bearing.prev2, bearing.prev] = [bearing.prev, bearing.share];
    bearing.share = Math.min(1, Math.max(0, follow(bearing.prev2, bearing.prev, bones.length > 0 ? 1 : 0, BEARING, f.dt)));
    if (bones.length > 0) bearing.bones = bones;
    if (bearing.share === 0 && bones.length === 0) {
      h.borne.delete(item);
      continue;
    }
    bearing.kg = bearing.share * item.mass;
  }
  loadBones(h, f.current);
}

/** what the body bears (`borne`) loaded onto the bones bearing it in `pose`, each item's at its centre of mass */
function loadBones(h: Body, pose: Pose) {
  const mass = new Map<number, number>();
  const moment = new Map<number, Vector3>();
  for (const [item, bearing] of h.borne) {
    const centre = _c.copy(item.centre).applyQuaternion(item.current.quaternion).add(item.current.position);
    for (const bone of bearing.bones) {
      mass.set(bone, (mass.get(bone) ?? 0) + bearing.kg / bearing.bones.length);
      let sum = moment.get(bone);
      if (!sum) moment.set(bone, (sum = new Vector3()));
      sum.addScaledVector(centre, bearing.kg / bearing.bones.length);
    }
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
const _c = new Vector3();

/** What a body wears from the start (`BodyOptions.wearing`): an item, the bone it is on, and where it sits in that bone's frame. */
export interface Dressed {
  item: Item;
  on: number;
  at: Placement;
}

/** Unsupported weight borne through the hands, counting each item once. */
export function heldMass(h: Body): number {
  return heldItems(h).reduce((sum, item) => sum + (item.supported ? 0 : item.mass), 0);
}

/** Held items, counting a two-handed load once. */
export function heldItems(h: Body): Item[] {
  return [...new Set(Object.values(h.holding).flatMap((held) => held?.item ?? []))];
}

/** How a body without a hold of its own (`BodyOptions.hold`) keeps what its hands hold: each item stays where it was on its hand's bone when taken. */
export function weld(body: Body): (f: Frame) => void {
  const on = new Map<string, { item: Item; position: Vector3; quaternion: Quaternion }>();
  return (f) => {
    for (const [hand, bone] of Object.entries(body.hands)) {
      const held = body.holding[hand], item = held?.item;
      if (!item || item.moved(f.time)) { on.delete(hand); continue; }
      const turn = f.current.rotation(bone), at = f.current.position(bone);
      let welded = on.get(hand);
      if (welded?.item !== item) {
        const back = _q.copy(turn).invert();
        on.set(hand, welded = { item, position: item.current.position.clone().sub(at).applyQuaternion(back), quaternion: back.multiply(item.current.quaternion).clone() });
      }
      item.move(f.time, _p.copy(welded.position).applyQuaternion(turn).add(at), _q.copy(turn).multiply(welded.quaternion));
    }
  };
}
