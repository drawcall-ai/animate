import type { Quaternion, Vector3 } from 'three';

/** A bone of a rig: rest local rotation is identity (+Y up, facing +Z, left +X). */
export interface BoneDef {
  name: string;
  /** index of the parent bone, -1 for the root (only bone 0); parents come before children */
  parent: number;
  /**
   * rest offset of the bone's origin in its parent's frame (m); the root's is its default
   * position in the world
   */
  offset: Vector3;
  /** segment mass (kg) */
  mass: number;
  /** the segment's centre of mass in the bone's frame (m) */
  com: Vector3;
  /** natural frequency (Hz) of a pull on this bone when a target gives none; default `STIFFNESS` */
  stiffness?: number;
}

/** A point fixed in a bone's frame (a heel, the eye midpoint, a palm). */
export interface BonePoint {
  bone: number;
  at: Vector3;
}

/** A point of the body: fixed in a bone, or its centre of mass (loads included). */
export type Point = BonePoint | 'com';

export type Tier = 'main' | 'fallback';

interface Goal {
  /**
   * 0..1: how hard it pulls, alike for every kind: a position's error counts in the skeleton's
   * `length` (so 1 m on a 1.7 m rig weighs as 1 / 1.7 rad of a rotation's)
   */
  weight: number;
  /** natural frequency of the pull (Hz); default the bone's (the root's for the centre of mass) */
  stiffness?: number;
  /**
   * default 'main'; a fallback's weight is what the main targets of its sort (a position, or a
   * rotation: orientation, aim, local) on its bone leave of 1 (a position's along each world
   * axis: one held only across the floor leaves a height whole)
   */
  tier?: Tier;
  /**
   * more bones whose fallback targets (of either sort) yield to this main target's weight,
   * besides those of its own sort on its own bone: a hand target claiming its arm releases the
   * arm's relaxed pose
   */
  claims?: readonly number[];
  owner?: string;
}

/**
 * A soft goal: pulls the body without forcing it.
 * - position: `point` to `value`
 * - orientation: the bone's world rotation to `value`
 * - aim: the bone-local `axis` (from `point`) points at `value`
 * - local: the bone's rotation in its parent's frame to `value` (the root's parent frame is the world)
 */
export type Target =
  | (Goal & {
      kind: 'position';
      point: Point;
      value: Vector3;
      /** world-axis weights 0..1 of its error (default (1, 1, 1); (1, 0, 1): horizontally only) */
      mask?: Vector3;
    })
  | (Goal & { kind: 'orientation'; point: BonePoint; value: Quaternion })
  | (Goal & { kind: 'aim'; point: BonePoint; value: Vector3; axis: Vector3 })
  | (Goal & { kind: 'local'; point: BonePoint; value: Quaternion });

/**
 * A hard constraint: the point is held at `position` (and its bone at `rotation`, when given;
 * not for the centre of mass).
 */
export interface Contact {
  point: Point;
  position: Vector3;
  /** the world axes it holds, each 0 or 1 (default (1, 1, 1); (0, 1, 0): on a plane, sliding) */
  mask?: Vector3;
  rotation?: Quaternion;
  priority: number;
  /** how much of the body's weight it carries, 0..1 (default 0); the core only passes it on */
  support?: number;
  owner?: string;
}

/** A sudden change of the body's velocity at a point (m/s, world): a hit, a shove. */
export interface Impulse {
  point: Point;
  velocity: Vector3;
}

/**
 * A joint's range of motion as swing and twist (rad) in its parent's frame, measured off
 * `neutral` (the bone's rotation `q · neutral⁻¹`): the twist about `axis`, the swing's two
 * components about the next two axes in turn (x: y, z; y: z, x; z: x, y).
 */
export interface Limit {
  bone: number;
  axis: 0 | 1 | 2;
  /** the rotation the range is measured from (default identity), e.g. an arm hanging */
  neutral?: Quaternion;
  twist: [number, number];
  swing: [[number, number], [number, number]];
}

/**
 * The most a joint speeds up or slows down (rad/s²), or with `kind: 'translation'` (on the root
 * only) the most the root's position does (m/s²).
 */
export interface Cap {
  bone: number;
  acceleration: number;
  /** default 'rotation' */
  kind?: 'rotation' | 'translation';
}

/** Extra mass carried by a bone (a held box), `at` in the bone's frame. */
export interface Load {
  bone: number;
  mass: number;
  at: Vector3;
}

/** A winning contact that bears weight, and where its point is (world). */
export interface Support {
  contact: Contact;
  position: Vector3;
}

/**
 * How far a goal is off what was proposed: its point's position (m, the masked components) and
 * its bone's rotation (rad; for an aim, its axis's angle off the aim).
 */
export interface Residual {
  position: number;
  rotation: number;
}

/**
 * A winning contact, how far the soft solve left it (`strain`, before the hard projection: what
 * the body could not do on its own) and how far the whole solve did (`residual`). Both are
 * measured from the proposed contact, so they include what is left of its ramp-in.
 */
export interface Held extends Contact {
  strain: Residual;
  residual: Residual;
}

/** A merged target (with its effective weight) and how far the soft solve left it. */
export type Pulled = Target & { strain: Residual };

/** What an owner's proposals got in the last sub-step. */
export interface Granted {
  won: readonly Held[];
  lost: readonly Contact[];
  targets: readonly Pulled[];
}
