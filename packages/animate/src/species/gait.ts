import { GRAVITY } from '../kernel/math';

/**
 * How a gait carries a four-legged body (`Gait.body`), as the stride goes: with x the fore-left leg's phase from its mid-stance (rad)
 * and the wave w(c) = (1 − once) · cos(2x − c) + once · cos(x − c) — twice a stride (a walk's, a trot's: a bounce on each diagonal) or
 * once (a gallop's: `once` 1) — the withers rise `withers · w(0)` (m) and the croup `croup[0] · w(croup[1])`, the trunk pitching between
 * them; the spine pitches `spine · w(spinePhase)` (°, + its hind end up: extending); the head pitches `headPitch` (°) and rises
 * `headRise` (m) with the wave from the fore-left's landing, and rises with the withers by `headWithers` (share: 0 holds it level, as a
 * running cat's). The tail's root pitches against the croup's pitch by `tail` (share). Once a stride, with the hind legs' stance, the
 * pelvis rolls `roll` (°) and yaws `yaw` (°), and the tail swings after it. Turning, the spine bends into the turn as `bend` of the arc
 * its back (withers to croup) walks would bend it — on the spot as walking its slowest — the neck taking the front half, the spine and
 * pelvis the back (none: it does not). Running, the trunk rides its legs' push by `bounce` (share, on top of the wave): its centre of
 * mass and pitch go as each stance's push and the flights' fall carry them (`Riding`).
 */
export interface Carriage {
  bend?: number;
  withers: number;
  croup: readonly [number, number];
  spine: number;
  spinePhase: number;
  roll: number;
  yaw: number;
  headPitch: number;
  headRise: number;
  headWithers: number;
  once?: number;
  tail?: number;
  bounce?: number;
}

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
  /** how far the body is let down on its legs on the move, as a share of their length (default none): legs that stand straight reach
   * fore and aft so, as a trotting dog's stance shortens its legs and its elbows and stifles stay bent */
  readonly drop?: number;
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
const speedOf = (speed: number) => speed < 0 && speed > -1e-9 ? 0 : speed;

