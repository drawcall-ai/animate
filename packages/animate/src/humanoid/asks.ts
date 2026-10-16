import type { Vector3 } from 'three';
import { action, type UntilCondition } from '@pmndrs/timeline';
import type { Frame } from '../core/body';
import { live, type Behaviour, type Live } from '../core/goal';
import type { Side } from './bones';
import type { Humanoid } from './humanoid';
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
  /** maximum bow while preparing or carrying a load (rad); constraints combine by minimum */
  bowLimit: number;
  /** axial chest turn from the standing facing (rad) */
  twist: number;
  /** the weight over one foot */
  onto: Side | null;
  /** stand otherwise than the body's stance */
  stance: Partial<Stance> | null;
}

/** nothing asked */
export const createAsks = (): Asks => ({ go: null, face: null, lower: 0, bow: 0, bowLimit: Infinity, twist: 0, onto: null, stance: null });

/** what `asks` holds, copied into `into`, and `asks` cleared */
export function takeAsks(asks: Asks, into: Asks): Asks {
  Object.assign(into, asks);
  Object.assign(asks, createAsks());
  return into;
}

/**
 * Asks `balance` for what `asks` gives (the fields it has; the rest as other tasks ask), every
 * sub-step, endless or until `until`: a task of its own for what no other task asks (shift weight, turn to a facing while the hands work).
 */
export function ask<W>(h: Humanoid<W>, asks: Live<Partial<Asks>, W>, until?: UntilCondition<Frame<W>>): Behaviour<W> {
  return function* () {
    yield* action<Frame<W>>({
      update: (f) => {
        Object.assign(h.asks, live(asks, f));
      },
      until,
    });
  };
}
