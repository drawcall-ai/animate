import { GRAVITY } from '../math';

/** A contact table, in leg order. All functions read speed (m/s) and Froude v²/(g·height). */
export interface LegGait {
  frequency(speed: number, froude: number): number;
  readonly contacts: readonly { offset: number | ((speed: number, froude: number) => number); duty(speed: number, froude: number): number }[];
  /** Below this speed the cycle keeps its cadence but shortens its motion. */
  readonly slowest: number;
  /** Speed at which the reference joint excursions were sampled; slow travel scales them down. */
  readonly referenceSpeed?: number;
  readonly height: number;
  readonly clearance: readonly number[];
}

export interface Stride {
  frequency: number;
  duty: number;
  stepping: number;
}

export function checkGait(gait: LegGait, count: number): void {
  if (!(gait.height > 0 && Number.isFinite(gait.height) && gait.slowest > 0 && Number.isFinite(gait.slowest)) || (gait.referenceSpeed !== undefined && !(gait.referenceSpeed > 0 && Number.isFinite(gait.referenceSpeed))) || gait.contacts.length !== count || gait.clearance.length !== count) throw new Error('gait and chains do not match');
}

export function strideAt(gait: LegGait, speed: number, leg: number): Stride {
  speed = speedOf(speed);
  if (!(speed >= 0 && Number.isFinite(speed))) throw new Error('leg speed must be finite and nonnegative');
  const v = Math.max(gait.slowest, speed);
  const froude = v * v / (GRAVITY * gait.height);
  const frequency = gait.frequency(v, froude);
  const duty = gait.contacts[leg].duty(v, froude);
  if (!(frequency > 0 && Number.isFinite(frequency) && duty > 0 && duty < 1)) throw new Error('a gait needs finite positive cadence and duty between 0 and 1');
  return { frequency, duty, stepping: Math.min(1, speed / (gait.referenceSpeed ?? gait.slowest)) };
}

export function offsetAt(gait: LegGait, speed: number, leg: number): number {
  const offset = gait.contacts[leg].offset;
  const value = typeof offset === 'number' ? offset : offset(speed, speed * speed / (GRAVITY * gait.height));
  if (!(value >= 0 && value < 1)) throw new Error('a gait offset must be in [0, 1)');
  return value;
}

/** Round only negative speed noise; real reverse speeds still fail validation. */
export const speedOf = (speed: number) => speed < 0 && speed > -1e-9 ? 0 : speed;
