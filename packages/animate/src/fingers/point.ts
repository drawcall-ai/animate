import type { Vector3 } from 'three';
import type { Digit } from './shape';

/** A point of a hand that goes on what it holds: the palm's middle, the pinch between the thumb's and the index's pads, or a digit's pad. */
export type HandPart = 'palm' | 'pinch' | Digit;

/**
 * Where a hand's point is, in its frame: where it goes on a thing (`at`), the way it faces into it (the palm's, a pad's), its grasp line
 * toward the thumb (across the palm, along its slanted crease where a handle lies) and the way the palm faces. A placement's turn is that
 * of the point's frame: +X its grasp line, +Y its facing.
 */
export interface HandPoint {
  at: Vector3;
  facing: Vector3;
  axis: Vector3;
  palmFacing: Vector3;
}
