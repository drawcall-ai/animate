import type { Vector3 } from 'three';

/** How the body stands when nothing asks for more. */
export interface Stance {
  /** half the distance between the ankles, sideways (m) */
  width: number;
  /** the left foot forward (+) or back (−) of the right (m) */
  stagger: number;
  /** how far the pelvis is let down, the knees bent (m): a ready stance */
  crouch: number;
  /** the pelvis and feet turned off the facing (rad): a bladed stance */
  blade: number;
  /** each foot turned out (rad) */
  toeOut: number;
}

/**
 * Where the legs are asked to take the body, by the one request that has them: the point on the floor, its velocity, how fast the body
 * may go (m/s, m/s²), the facing to turn to (at most `rate` rad/s) and how to stand.
 */
export interface Go {
  to: Vector3;
  velocity?: Vector3;
  speed: number;
  accel: number;
  /** arriving, the feet are squared into the stance (default true; false: they stay as they land) */
  plant?: boolean;
  /** edged onto a goal that has stopped, the body stands as it is (default true: a walk that ends there); false: it keeps edging after
   * it (a walk that follows its goal, which may move off again any moment) */
  settles?: boolean;
  face?: { yaw: number; rate?: number };
  stance?: Partial<Stance>;
}
