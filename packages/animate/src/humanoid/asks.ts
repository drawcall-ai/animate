import type { Vector3 } from 'three';
import type { Side } from './bones';
import type { Stance } from './stance';

/** Walking somewhere: the point on the floor the body goes to, its velocity, and how fast the body may go (m/s, m/s²). */
export interface Go {
  to: Vector3;
  velocity?: Vector3;
  speed: number;
  accel: number;
  /** arriving, the feet are squared into the stance (default true; false: they stay as they land) */
  plant?: boolean;
}

/**
 * What the tasks ask of `balance`, which alone moves the root, the legs and the trunk's posture.
 * Every field is last-writer-wins: a task rewrites what it needs every sub-step it runs; `balance`
 * reads them at the start of its update and clears them (so it acts on them a sub-step later).
 */
export interface Asks {
  /** walk there */
  go: Go | null;
  /** turn to face `yaw` (rad), at most `rate` (rad/s) */
  face: { yaw: number; rate?: number } | null;
  /** let the pelvis down by the knees (m; negative: up onto the toes) */
  lower: number;
  /** bend the trunk forward at the hips and lower back (rad) */
  bow: number;
  /** hold the centre of mass off the feet's middle (m, on the floor): leaning into a force */
  lean: Vector3 | null;
  /** the weight over one foot */
  onto: Side | null;
  /** feet a task places itself [left, right] */
  taken: [boolean, boolean];
  /** stand otherwise than the body's stance */
  stance: Partial<Stance> | null;
}

/** nothing asked */
export const createAsks = (): Asks => ({ go: null, face: null, lower: 0, bow: 0, lean: null, onto: null, taken: [false, false], stance: null });

/** what `asks` holds, copied into `into`, and `asks` cleared */
export function takeAsks(asks: Asks, into: Asks): Asks {
  Object.assign(into, asks, { taken: [asks.taken[0], asks.taken[1]] });
  Object.assign(asks, createAsks());
  return into;
}
