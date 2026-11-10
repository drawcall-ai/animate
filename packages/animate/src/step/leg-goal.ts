import type { Vector3 } from 'three';

/** a walk unless asked otherwise: its top speed (m/s) and how quickly it speeds up (m/s²) */
export const STROLL = { speed: 1.3, accel: 1.2 };

/**
 * Where the legs are asked to take the body, by the one request that has them: the point on the floor, its velocity, how fast the body
 * may go (m/s, m/s²) and the facing to turn to (rad).
 */
export interface LegGoal {
  to: Vector3;
  velocity?: Vector3;
  speed: number;
  accel: number;
  /** the walk ends on arriving there (default true); false: it follows its goal, which may move off again any moment — not arrived at, a
   * closing step keeping the margin of a foot further on */
  settles?: boolean;
  /** a few steps back or aside, asked to face about as the body faces, it keeps its facing, backing or side-stepping (a person's walk's;
   * default false: it faces the way it goes) */
  backs?: boolean;
  face?: number;
}
