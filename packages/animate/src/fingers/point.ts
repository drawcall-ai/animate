import type { Vector3 } from 'three';

/**
 * Where a hand holds a grip, in its frame: the point of it that goes on the grip's empty — the palm's middle, a digit's pad, or a point
 * on a handle's axis where the handle lies in its power grasp — the way that part faces (a pad's, the palm's), the hand's grasp line
 * toward the thumb (where a handle lies, its axis; else across the knuckles toward the index), and the way the palm faces.
 */
export interface HandPoint {
  at: Vector3;
  facing: Vector3;
  axis: Vector3;
  palmFacing: Vector3;
}
