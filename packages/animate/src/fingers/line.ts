import type { Vector3 } from 'three';

/** Where a handle lies in a hand's power grasp (the hand's frame): a point on its axis, the axis toward the thumb, the way the palm faces onto it. */
export interface HandleLine {
  at: Vector3;
  axis: Vector3;
  facing: Vector3;
}
