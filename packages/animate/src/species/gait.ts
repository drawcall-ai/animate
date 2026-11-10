import { GRAVITY } from '../kernel/math';

/**
 * How a gait carries a four-legged body (`Gait.trunk`), as the stride goes: with x the fore-left leg's phase from its mid-stance (rad)
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
export interface TrunkMotion {
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
  /** how the gait carries a four-legged body (`TrunkMotion`), if it does: as it is, or as it changes with the pace (`trunkMotions`) */
  readonly trunk?: TrunkMotion | ((speed: number, froude: number) => TrunkMotion);
}

/** leg `leg`'s stride at `speed` (m/s; its slowest below `gait.slowest`): its cadence (1/s) and duty factor */
export function strideAt(gait: Gait, speed: number, leg: number): { frequency: number; duty: number; referenceBlend?: number } {
  // (only negative speed noise rounded off: a real reverse speed still fails)
  speed = speed < 0 && speed > -1e-9 ? 0 : speed;
  if (!(speed >= 0 && Number.isFinite(speed))) throw new Error('leg speed must be finite and nonnegative');
  const v = Math.max(gait.slowest, speed), froude = v * v / (GRAVITY * gait.height);
  const frequency = gait.frequency(v, froude), duty = gait.contacts[leg].duty(v, froude);
  if (!(frequency > 0 && Number.isFinite(frequency) && duty > 0 && duty < 1)) throw new Error('a gait needs finite positive cadence and duty between 0 and 1');
  return { frequency, duty, referenceBlend: gait.referenceBlend };
}

export function offsetAt(gait: Gait, speed: number, leg: number): number {
  const offset = gait.contacts[leg].offset;
  const value = typeof offset === 'number' ? offset : offset(speed, speed * speed / (GRAVITY * gait.height));
  if (!(value >= 0 && value < 1)) throw new Error('a gait offset must be in [0, 1)');
  return value;
}

/** the gait dynamically similar at `size`: read at the speed of the same Froude number */
export function gaitAt(gait: Gait, size: number): Gait {
  const k = Math.sqrt(size), at = (v: number) => v / k;
  const offsetOf = (offset: Gait['contacts'][number]['offset']) => typeof offset === 'number' ? offset : (v: number, fr: number) => offset(at(v), fr);
  return {
    ...gait,
    height: gait.height * size,
    slowest: gait.slowest * k,
    referenceSpeed: gait.referenceSpeed === undefined ? undefined : gait.referenceSpeed * k,
    clearance: gait.clearance.map((c) => c * size),
    frequency: (v, fr) => gait.frequency(at(v), fr) / k,
    contacts: gait.contacts.map((c) => ({
      ...c,
      offset: offsetOf(c.offset),
      duty: (v: number, fr: number) => c.duty(at(v), fr),
    })),
    trunk: typeof gait.trunk === 'function' ? ((body) => (v: number, fr: number) => trunkAt(body(at(v), fr), size))(gait.trunk) : gait.trunk && trunkAt(gait.trunk, size),
  };
}

/** a trunk motion at `size`: its rises and falls as long, its angles as they are */
const trunkAt = (b: TrunkMotion, size: number): TrunkMotion => ({ ...b, withers: b.withers * size, croup: [b.croup[0] * size, b.croup[1]], headRise: b.headRise * size });
