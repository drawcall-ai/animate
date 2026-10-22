import { Vector3 } from 'three';
import { GRAVITY } from '../math';
import type { Carriage } from './carriage';

/** A contact table, in leg order. All functions read speed (m/s) and Froude v²/(g·height). */
export interface Gait {
  frequency(speed: number, froude: number): number;
  readonly contacts: readonly { offset: number | ((speed: number, froude: number) => number); duty(speed: number, froude: number): number }[];
  /** Below this speed the cycle keeps its cadence but shortens its motion. */
  readonly slowest: number;
  /** Speed at which the reference joint excursions were sampled; slow travel scales them down. */
  readonly referenceSpeed?: number;
  /** Share of the alternate joint reference (0…1), independent of speed and duty. */
  readonly referenceBlend?: number;
  readonly height: number;
  readonly clearance: readonly number[];
  /** running (a gallop), the body let down on its legs by `drop` of their length — eased in from Froude number `froude[0]` to `froude[1]` —
   * its stances reaching as far fore and aft as the legs reach so */
  readonly run?: { froude: readonly [number, number]; drop: number };
  /** how the gait carries a four-legged body (`Carriage`), if it does: as it is, or as it changes with the pace (`carriages`) */
  readonly body?: Carriage | ((speed: number, froude: number) => Carriage);
}

export interface Stride {
  frequency: number;
  duty: number;
  referenceBlend?: number;
}

export function strideAt(gait: Gait, speed: number, leg: number): Stride {
  speed = speedOf(speed);
  if (!(speed >= 0 && Number.isFinite(speed))) throw new Error('leg speed must be finite and nonnegative');
  const v = Math.max(gait.slowest, speed);
  const froude = v * v / (GRAVITY * gait.height);
  const frequency = gait.frequency(v, froude);
  const duty = gait.contacts[leg].duty(v, froude);
  if (!(frequency > 0 && Number.isFinite(frequency) && duty > 0 && duty < 1)) throw new Error('a gait needs finite positive cadence and duty between 0 and 1');
  return { frequency, duty, referenceBlend: gait.referenceBlend };
}

export function offsetAt(gait: Gait, speed: number, leg: number): number {
  const offset = gait.contacts[leg].offset;
  const value = typeof offset === 'number' ? offset : offset(speed, speed * speed / (GRAVITY * gait.height));
  if (!(value >= 0 && value < 1)) throw new Error('a gait offset must be in [0, 1)');
  return value;
}

/** Round only negative speed noise; real reverse speeds still fail validation. */
export const speedOf = (speed: number) => speed < 0 && speed > -1e-9 ? 0 : speed;

/** Walk state, of any legs: the legs report the motion; walkTo publishes and clears its arrival estimate. */
export interface Locomotion {
  /** the stride's phase (rad): 0 as the left foot lifts, π as the right does */
  phase: number;
  /** 0 standing … 1 walking, 0 walking … 1 running */
  walk: number;
  run: number;
  /** the facing it walks with (rad, about +Y) and its ground velocity (m/s) */
  facing: number;
  /** the heading it will walk with half a second ahead (rad), for the eyes to lead */
  facingAhead?: number;
  velocity: Vector3;
  /** seconds until the walk now running arrives; Infinity when no walk is running; published and cleared by walkTo */
  eta: number;
  /** a walk is under way */
  moving: boolean;
  /** come to rest: no walk under way, both feet planted a while and none wanting to step */
  settled: boolean;
  /** the legs hold the walk's still goal reached, as near as they take the body to it (a creature stops just short of or past it rather than
   * edging about); a walk ends there as it does within its own reach of the goal */
  there: boolean;
  /** seconds standing on planted feet since the current walk started; the base resets it on a new walk */
  planted: number;
  /** the pelvis's and the thorax's turn with the stride (rad, + to the left) */
  pelvisYaw: number;
  thoraxYaw: number;
  /** the requested quiet stance displacement from the centred stance (m, world) */
  quiet: Vector3;
}

export const createLocomotion = (facing: number): Locomotion => ({ eta: Infinity, phase: 0, walk: 0, run: 0, facing, velocity: new Vector3(), moving: false, settled: true, there: false, planted: 0, pelvisYaw: 0, thoraxYaw: 0, quiet: new Vector3() });
