import { Vector3 } from 'three';
import { minimumJerk } from '@prohuman/core';

export type V3 = [number, number, number];
export type Key<T> = [time: number, value: T];

/** Piecewise minimum-jerk interpolation between keyframes (holds outside the range). */
export function track(keys: Key<V3>[]): (t: number, out?: Vector3) => Vector3 {
  return (t, out = new Vector3()) => {
    if (t <= keys[0][0]) return out.set(...keys[0][1]);
    for (let i = 1; i < keys.length; i++) {
      const [t1, b] = keys[i];
      if (t <= t1) {
        const [t0, a] = keys[i - 1];
        const s = minimumJerk((t - t0) / Math.max(1e-6, t1 - t0));
        return out.set(a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s);
      }
    }
    return out.set(...keys[keys.length - 1][1]);
  };
}

export function scalar(keys: Key<number>[]): (t: number) => number {
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t1, b] = keys[i];
      if (t <= t1) {
        const [t0, a] = keys[i - 1];
        return a + (b - a) * minimumJerk((t - t0) / Math.max(1e-6, t1 - t0));
      }
    }
    return keys[keys.length - 1][1];
  };
}

/** A smooth 0→1→0 pulse: rise over `rise`, hold, fall over `fall`. */
export function pulse(t: number, start: number, rise: number, hold: number, fall: number): number {
  if (t < start) return 0;
  if (t < start + rise) return minimumJerk((t - start) / rise);
  if (t < start + rise + hold) return 1;
  return 1 - minimumJerk((t - start - rise - hold) / fall);
}

export const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

/**
 * Smooth path through keyframes (cubic Hermite with Catmull-Rom tangents, at rest only
 * at the ends): one continuous arc, unlike `track`, which stops at every key.
 */
export function spline(keys: Key<V3>[]): (t: number, out?: Vector3) => Vector3 {
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
    const v = [0, 1, 2].map((k) => h00 * a[k] + h10 * h * tangent(i - 1, k) + h01 * b[k] + h11 * h * tangent(i, k));
    return out.set(v[0], v[1], v[2]);
  };
}
