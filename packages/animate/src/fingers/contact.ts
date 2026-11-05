import type { Vector3 } from 'three';

/**
 * Where a hand holds a grip, in its frame: the point of it that goes on the grip's empty — the palm's middle, a digit's pad, or a point
 * on a handle's axis where the handle lies in its power grasp — the way that part faces (a pad's, the palm's), and a handle's axis there
 * (toward the thumb).
 */
export interface Contact {
  at: Vector3;
  facing: Vector3;
  axis: Vector3 | null;
}
