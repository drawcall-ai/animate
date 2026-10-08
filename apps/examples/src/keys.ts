import { Vector3 } from 'three';
import { minimumJerk } from './math';

export type V3 = [number, number, number];
export type Key<T> = [time: number, value: T];

function checkTimes(keys: Key<unknown>[]) {
  if (keys.length === 0) throw new Error('no keys');
  for (let i = 1; i < keys.length; i++) if (!(keys[i][0] > keys[i - 1][0])) throw new Error(`key times must increase: ${keys[i - 1][0]} → ${keys[i][0]}`);
}

/** Piecewise minimum-jerk interpolation between keyframes, stopping at each (holds outside the range). */
export function scalar(keys: Key<number>[]): (t: number) => number {
  checkTimes(keys);
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t1, b] = keys[i];
      if (t > t1) continue;
      const [t0, a] = keys[i - 1];
      return a + (b - a) * minimumJerk((t - t0) / (t1 - t0));
    }
    return keys[keys.length - 1][1];
  };
}

/** `scalar` on points. */
export function track(keys: Key<V3>[]): (t: number, out?: Vector3) => Vector3 {
  const [x, y, z] = ([0, 1, 2] as const).map((k) => scalar(keys.map(([t, p]): Key<number> => [t, p[k]])));
  return (t, out = new Vector3()) => out.set(x(t), y(t), z(t));
}

/** A smooth 0→1→0 pulse: rise over `rise`, hold, fall over `fall`. */
export function pulse(t: number, start: number, rise: number, hold: number, fall: number): number {
  if (t < start) return 0;
  if (t < start + rise) return minimumJerk((t - start) / rise);
  if (t < start + rise + hold) return 1;
  return 1 - minimumJerk((t - start - rise - hold) / fall);
}

/**
 * Smooth path through keyframes (cubic Hermite with Catmull-Rom tangents, at rest only
 * at the ends): one continuous arc, unlike `track`, which stops at every key.
 */
export function spline(keys: Key<V3>[]): (t: number, out?: Vector3) => Vector3 {
  checkTimes(keys);
  const n = keys.length;
  const tangent = (i: number, k: number) => {
    if (i === 0 || i === n - 1) return 0;
    return (keys[i + 1][1][k] - keys[i - 1][1][k]) / (keys[i + 1][0] - keys[i - 1][0]);
  };
  return (t, out = new Vector3()) => {
    if (t <= keys[0][0]) return out.set(...keys[0][1]);
    if (t >= keys[n - 1][0]) return out.set(...keys[n - 1][1]);
    let i = 1;
    while (keys[i][0] < t) i++;
    const [t0, a] = keys[i - 1];
    const [t1, b] = keys[i];
    const h = t1 - t0;
    const u = (t - t0) / h;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
    const h10 = u ** 3 - 2 * u ** 2 + u;
    const h01 = -2 * u ** 3 + 3 * u ** 2;
    const h11 = u ** 3 - u ** 2;
    const at = (k: number) => h00 * a[k] + h10 * h * tangent(i - 1, k) + h01 * b[k] + h11 * h * tangent(i, k);
    return out.set(at(0), at(1), at(2));
  };
}
