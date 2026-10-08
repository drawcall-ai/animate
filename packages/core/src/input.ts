import { Quaternion, Vector3, type Object3D } from 'three';
import type { OrientedTask, OwnedTask, Task } from './intent/tasks';
import { clamp, type Quat, type Vec3 } from './math';
import type { Stance } from './stance';

/** An axis-aligned box (a THREE.Box3 fits). */
export interface Box {
  min: Vec3;
  max: Vec3;
}

/** A sphere (a THREE.Sphere fits). */
export interface Sphere {
  center: Vec3;
  radius: number;
}

/**
 * Something to bring a body part to, in world space. An Object3D is read through its
 * `matrixWorld` (kept current by the renderer, or call `updateMatrixWorld`) at full weight.
 * `weight` (0..1, default 1) blends between the inferred pose and the target.
 */
export type Target = Object3D | { position?: Vec3; quaternion?: Quat; weight?: number };

/**
 * A ladder standing on the floor against the ground it leads up to: its rungs, `spacing`
 * apart (default 0.3 m), from the floor at `position` (the middle of its foot, on the rungs'
 * line) up to `height`, where that ground's top is; the body climbs it facing `yaw`. Its
 * stiles are `width` apart (default 0.46 m) and reach on above the top to hold on stepping off.
 */
export interface Ladder {
  position: Vec3;
  yaw: number;
  height: number;
  spacing?: number;
  width?: number;
}

/** Every field is optional — whatever is missing is inferred. */
export interface Input {
  /** the eye midpoint (an XR camera); `quaternion` = the head's rotation */
  head?: Target;
  /** the chest bone's origin and rotation */
  chest?: Target;
  /** the hips bone's origin (midway between the hip joints) and rotation */
  hips?: Target;
  /** the wrists; `quaternion` = the VRM hand bone's world rotation */
  leftHand?: Target;
  rightHand?: Target;
  /**
   * the ankles (kicks, strides, stepping on things); the other foot becomes the support, and one
   * let go of on the floor stays there. Position only, except mounted: the feet stand on them
   * (pedals, a deck) and `quaternion` = the foot bone's world rotation
   */
  leftFoot?: Target;
  rightFoot?: Target;
  /**
   * the force the hands exert on what they hold, per kg of body mass (m/s², horizontal; y is
   * ignored): pushing a heavy crate ~3 forward, pulling it back. The body leans into it — its
   * centre of mass held ahead of its feet as far as the force's moment at the hands needs
   */
  handForce?: Vec3;
  /**
   * What carries the body (a bicycle, a board): `position` = where it stands on the ground
   * under the body (what it leans and rocks about), `quaternion` = its heading. While given,
   * the body rides it — no stepping, the mount balances: the root goes with it, the
   * feet stand on their targets (a foot without one stays where it is on it), a seat carries
   * the pelvis at once (a saddle; remove it to stand up on the pedals), the body leans into
   * its acceleration (atan(a/g): into turns, back when braking), the legs give under its jolts,
   * the eyes look where it goes and free arms are held out for balance. Remove it to step off.
   * `lean` (0..1, default 1): how much of that lean is the body's own — 1 balancing freely (a
   * bicycle, a board), low held in place (belted into a car seat): the rest sways it outward.
   * `weight` (0..1, default 1): how far it carries the body. Getting on (or off) it, ramp it up
   * from 0 as the body's weight goes onto it: below 1 the feet may still stand on the floor
   * beside it (a foot without a target stays where it is), the body balancing over them and
   * leaning onto the mount as far as it carries it, and the pelvis goes where its contacts
   * (a hips target, the seat) take it.
   */
  mount?: Target & { lean?: number };
  /** where to look */
  lookAt?: Vec3 | Object3D;
  /** where to stand (x, z; y is ignored); `quaternion` holds this facing, even while moving there; `weight` = how firmly */
  goal?: Target;
  /**
   * Sit here: `position` is the seat surface under the hips, `quaternion` the seated facing
   * (default: facing away from where the body comes from), its up tilted back as far as a
   * backrest leans (the trunk leans back onto it). The body walks up, turns its
   * back to the seat and sits down; remove the seat and it stands up again. `weight` < 1
   * only perches.
   */
  seat?: Target;
  /** boxes standing on the floor (a THREE.Box3 fits): standing spots avoid them and low ones (max.y ≲ 0.2 × height) are stepped over, or jumped with both feet when too wide to step (a ditch); tall ones are not walked around (no path planning) */
  floorObstacles?: readonly Box[];
  /** boxes whose tops are floor to stand on (a THREE.Box3 fits): a goal on one too high to step or jump onto is climbed onto — hands on its edge, feet up its face */
  ground?: readonly Box[];
  /** ladders up to ground: a goal on the ground one leads to is reached by climbing it */
  ladders?: readonly Ladder[];
  /**
   * volumes the trunk and head give way to: spheres (a held box, a table edge; the knees
   * swing around them too) and boxes (a low ceiling: the body ducks under it ahead of time
   * and walks through stooped)
   */
  bodyObstacles?: readonly (Sphere | Box)[];
}

/** Movement style multipliers (1 = natural). */
export interface Style {
  /** pelvic rotation, list and sway */
  hips: number;
  armSwing: number;
}

export interface Options {
  position?: Vec3;
  yaw?: number;
  /** m/s (default 1.3) */
  maxSpeed?: number;
  /** how quickly the body speeds up (m/s², default 1.2; ~2.5 for a runner) */
  accel?: number;
  stance?: Partial<Stance>;
  style?: Partial<Style>;
}

const _p = new Vector3();
const _s = new Vector3();

export const isSphere = (o: Sphere | Box): o is Sphere => 'radius' in o;

const isObject3D = (t: Target | Vec3 | Object3D): t is Object3D => 'matrixWorld' in t;

/** A target's weight clamped to 0..1 (0 when absent). */
export function weightOf(t: Target | undefined): number {
  if (!t) return 0;
  return isObject3D(t) ? 1 : clamp(t.weight ?? 1, 0, 1);
}

/** A target's world position into `out`; null when it gives none. */
export function positionOf(t: Target | undefined, out: Vector3): Vector3 | null {
  if (!t) return null;
  if (isObject3D(t)) return out.setFromMatrixPosition(t.matrixWorld);
  return t.position ? out.set(t.position.x, t.position.y, t.position.z) : null;
}

/** A target's world rotation into `out`; null when it gives none. */
export function quaternionOf(t: Target | undefined, out: Quaternion): Quaternion | null {
  if (!t) return null;
  if (isObject3D(t)) {
    t.matrixWorld.decompose(_p, out, _s);
    return out;
  }
  return t.quaternion ? out.set(t.quaternion.x, t.quaternion.y, t.quaternion.z, t.quaternion.w) : null;
}

/** A point or an Object3D's world position into `out`. */
export function pointOf(p: Vec3 | Object3D, out: Vector3): Vector3 {
  return isObject3D(p) ? out.setFromMatrixPosition(p.matrixWorld) : out.set(p.x, p.y, p.z);
}

/** A positional task written into `out`; null when absent or weightless. */
export function positionTask<T extends Task>(t: Target | undefined, out: T): T | null {
  const w = weightOf(t);
  if (w <= 0 || !positionOf(t, out.pos)) return null;
  out.weight = w;
  return out;
}

/** A position and/or orientation task written into `own`'s; null when absent or weightless. */
export function orientedTask(t: Target | undefined, own: OwnedTask): OrientedTask | null {
  const w = weightOf(t);
  if (w <= 0) return null;
  const out = own.task;
  out.pos = positionOf(t, own.pos);
  out.rot = quaternionOf(t, own.rot);
  out.weight = w;
  return out.pos || out.rot ? out : null;
}
