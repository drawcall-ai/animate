import type { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import type { HandPlacement, HandPoint } from '../fingers/placement';
import type { Frame } from '../kernel/frame';
import type { Goal, Placement } from '../kernel/goal';
import type { LimbMover } from '../kernel/limb';
import type { MovingFrame } from '../kernel/moving-frame';
import type { ReadonlyBonePose } from '../kernel/bone-pose';
import type { Request } from '../kernel/requests';
import type { Thing } from './thing';

/** What a hand holds: the thing, by which of its empties, and where the hand is on it (its goal in the thing's frame) — for a person's
 * hand, the placement it took there, fixed on the thing while it holds it, and the point of the hand that took it. */
export interface Hold {
  thing: Thing;
  grip: string;
  goal: Goal;
  placement?: HandPlacement;
  point?: HandPoint;
  idle?: (f: Frame) => void;
  /** the request that took hold: what misses if the hand closes off its grip */
  by?: Request;
  /** its regrip, a person's, once one has begun */
  regrip?: Regrip;
  /** the arm as a person's carry moves it: one through all the carry's stages and its keeping after, so its brakes and its fit carry on
   * across them rather than starting afresh at each */
  arm?: LimbMover;
}

/** A hold's regrip under way: the hand's node turned in the thing from as it held it onto as planned, its palm's centre going from
 * `palm` to `onto` on the thing (the thing's frame; the same, turned about it), over `seconds` from `start` (s). */
export interface Regrip {
  from: Quaternion;
  to: Quaternion;
  palm: Vector3;
  onto: Vector3;
  start: number;
  seconds: number;
}

/**
 * A body as the things it holds, and the targets resolved against it, see it: its object and moving bones' nodes, its hands' tip bones and
 * holds, what it moves and tracks; the pose its frames are read from by a reader — its own as posed so far this sub-step, another body's
 * as it was before that body's update this frame — and where a thing it moves itself is, read the same way (its own this sub-step: its
 * moves come after its hands). As a reader: how many updates it has finished, the share of the update's time its sub-step has reached, and
 * the transforms it has seen.
 */
export interface Holder {
  readonly updates: number;
  readonly share: number;
  readonly frames: WeakMap<Object3D, Interpolated>;
  poseFor(reader: Holder): ReadonlyBonePose;
  movedFor(reader: Holder, node: Object3D): Placement | null;
  /** a moving bone's rest frame in the scene (`turn⁻¹ · rest`), and its scale */
  restOf(bone: number): Readonly<Quaternion>;
  scaleOf(bone: number): number;
  /** the floor's height under a world point (x, z): a body's object stands on it */
  readonly floor: (x: number, z: number) => number;
  readonly frame: Frame;
  readonly object: Object3D;
  boneNode(bone: number): Object3D;
  readonly hands: Readonly<Record<string, number>>;
  readonly holding: Record<string, Hold | null>;
  /** what it moves itself (things in both its hands), each on its own frame's history */
  readonly carried: ReadonlyMap<Object3D, MovingFrame>;
  track(node: Object3D): MovingFrame;
  carry(node: Object3D, movingFrame: MovingFrame): void;
  leave(node: Object3D): void;
  /** it deals with the body `other` is: each keeps clear of the other from now on */
  meet(other: Holder): void;
  showPrev(): void;
}

/** each body's object (bone −1) and moving bones, by node */
export const anchors = new WeakMap<Object3D, { body: Holder; bone: number }>();

/** the body that moves each thing it carries in both hands itself (one hand's hangs from that hand's bone) */
export const movers = new WeakMap<Object3D, Holder>();

/** the body that keeps each node turned to a world rotation (`Body.orient`), its position following its parent: the rotation, by node */
export const turners = new WeakMap<Object3D, { readonly turned: ReadonlyMap<Object3D, Quaternion> }>();

/** a node's matrix from one update to the next, the update it was last read in, and its parent frame (null for world) */
export interface Interpolated {
  update: number;
  parent: Object3D | null;
  from: Matrix4;
  to: Matrix4;
}
