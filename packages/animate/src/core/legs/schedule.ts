import { GRAVITY } from '../math';
import type { Carriage } from './carriage';
import type { Gait } from './gait';

/**
 * A gait from a few numbers, dynamically similar across sizes (recalled: Alexander & Jayes 1983, stride
 * λ/h = c·Fr^0.3; Hodson et al., stance time ∝ v^−0.7). Only `height`, `slowest` and `clearance` carry units: a body
 * scaled by hand keeps `stride` and `stance` as they are (or use `scaled`).
 */
export function powerGait({ height, slowest, offsets, stride, stance, clearance }: {
  /** hip height (m) */
  height: number;
  /** the slowest pace that still strides (m/s) */
  slowest: number;
  /** each leg's footfall in the cycle (0…1), in the legs' order: a number, or as it shifts with the pace (`footfalls`) */
  offsets: readonly Gait['contacts'][number]['offset'][];
  /** stride length over hip height at Froude number 1 (c) */
  stride: number;
  /** stance time at Froude number 1, in units of √(height / g): the same for a body of any size (a dog's 0.93) */
  stance: number;
  /** each foot's lift over the ground swinging (m) */
  clearance: readonly number[];
}): Gait {
  const frequency = (v: number, fr: number) => v / (height * stride * Math.pow(fr, 0.3));
  const unit = Math.sqrt(height / GRAVITY);
  // Tuned numerical cap: leave a nonzero swing interval at the slowest cadence.
  return {
    height, slowest, frequency, clearance,
    contacts: offsets.map((offset) => ({ offset, duty: (v, fr) => Math.min(0.99, stance * unit * Math.pow(fr, -0.35) * frequency(v, fr)) })),
  };
}

/** a stance of `seconds` measured at `speed` (m/s) on a body of hip `height` (m), as `powerGait` takes it */
export const stanceOf = (seconds: number, speed: number, height: number) => seconds * Math.pow(speed, 0.7) / (Math.pow(height, 0.85) * Math.pow(GRAVITY, -0.15));

/**
 * Each leg's footfall as it shifts with the Froude number v²/(g·height) (a walk's into a trot's into a gallop's): `stops` of
 * [Froude number, each leg's footfall (0…1)], rising, each leg moving between neighbouring stops linearly the shorter way round
 * the cycle, held past the ends — for `powerGait`'s `offsets`
 */
export function footfalls(stops: Stops<readonly number[]>): ((speed: number, froude: number) => number)[] {
  return checked(stops)[0][1].map((_, leg) => (_speed: number, froude: number) => {
    const [a, b, t] = between(stops, froude), at = a[leg] + t * (b[leg] - a[leg] - Math.round(b[leg] - a[leg]));
    return at - Math.floor(at);
  });
}

/**
 * A gait's carriage as it changes with the Froude number (a trot's into a gallop's): `stops` of [Froude number, carriage], rising,
 * each of its numbers linearly between neighbouring stops, held past the ends — for a gait's `body`
 */
export function carriages(stops: Stops<Carriage>): (speed: number, froude: number) => Carriage {
  checked(stops);
  return (_speed, froude) => {
    const [a, b, t] = between(stops, froude), mix = (p: number, q: number) => p + (q - p) * t;
    return { bend: mix(a.bend ?? 0, b.bend ?? 0), withers: mix(a.withers, b.withers), croup: [mix(a.croup[0], b.croup[0]), mix(a.croup[1], b.croup[1])], spine: mix(a.spine, b.spine),
      spinePhase: mix(a.spinePhase, b.spinePhase), roll: mix(a.roll, b.roll), yaw: mix(a.yaw, b.yaw), headPitch: mix(a.headPitch, b.headPitch),
      headRise: mix(a.headRise, b.headRise), headWithers: mix(a.headWithers, b.headWithers), once: mix(a.once ?? 0, b.once ?? 0), tail: mix(a.tail ?? 0, b.tail ?? 0) };
  };
}

/** values at Froude numbers, rising */
type Stops<T> = readonly (readonly [froude: number, value: T])[];
const checked = <T>(stops: Stops<T>) => {
  if (stops.length === 0 || stops.some(([fr], k) => k > 0 && !(fr > stops[k - 1][0]))) throw new Error('stops by rising Froude number');
  return stops;
};
/** the stops either side of `froude` and how far it is from the one to the other (the end one twice past the ends) */
function between<T>(stops: Stops<T>, froude: number): [T, T, number] {
  const next = stops.findIndex(([fr]) => fr > froude);
  if (next <= 0) { const end = stops[next < 0 ? stops.length - 1 : 0][1]; return [end, end, 0]; }
  const [[fr0, a], [fr1, b]] = [stops[next - 1], stops[next]];
  return [a, b, (froude - fr0) / (fr1 - fr0)];
}
