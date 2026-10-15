/** A contact table, in leg order. All functions read speed (m/s) and Froude v²/(g·height). */
export interface LegGait {
  frequency(speed: number, froude: number): number;
  contacts: readonly { offset: number | ((speed: number, froude: number) => number); duty(speed: number, froude: number): number }[];
  /** Below this speed the cycle keeps its cadence but shortens its motion. */
  slowest: number;
  height: number;
  clearance: readonly number[];
}

export interface Stride {
  frequency: number;
  duty: number;
  stepping: number;
}

/** Read: standard gravity in m/s², for dynamic similarity. */
const GRAVITY = 9.81;

export function strideAt(gait: LegGait, speed: number, leg: number): Stride {
  if (!(speed >= 0 && Number.isFinite(speed) && gait.height > 0 && gait.slowest > 0)) throw new Error('gait height/slowest and speed must be finite positive values (speed may be zero)');
  const v = Math.max(gait.slowest, speed);
  const froude = v * v / (GRAVITY * gait.height);
  const frequency = gait.frequency(v, froude);
  const duty = gait.contacts[leg].duty(v, froude);
  if (!(frequency > 0 && Number.isFinite(frequency) && duty > 0 && duty < 1)) throw new Error('a gait needs finite positive cadence and duty between 0 and 1');
  return { frequency, duty, stepping: Math.min(1, speed / gait.slowest) };
}

export function offsetAt(gait: LegGait, speed: number, leg: number): number {
  const offset = gait.contacts[leg].offset;
  const value = typeof offset === 'number' ? offset : offset(speed, speed * speed / (GRAVITY * gait.height));
  if (!(value >= 0 && value < 1)) throw new Error('a gait offset must be in [0, 1)');
  return value;
}
