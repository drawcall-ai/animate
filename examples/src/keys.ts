import { Vector3 } from 'three';
import type { Frame, World } from '@drawcall/animate';

/** Flash & Hogan's minimum-jerk profile, `t` in [0, 1] */
export function minimumJerk(t: number): number {
  const s = Math.min(1, Math.max(0, t));
  return s * s * s * (10 - 15 * s + 6 * s * s);
}

/** A key: a value at a time (s). */
export type Key<T> = [time: number, value: T];

/** a value through keys: from each to the next at rest at both (minimum jerk), held before the first and after the last */
export function scalar(keys: readonly Key<number>[]): (t: number) => number {
  if (keys.length === 0) throw new Error('no keys');
  for (let i = 1; i < keys.length; i++) if (!(keys[i][0] > keys[i - 1][0])) throw new Error(`key times must increase: ${keys[i - 1][0]} → ${keys[i][0]}`);
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

/** `scalar` for a point (into `out`) */
export function keyed(keys: readonly Key<[number, number, number]>[]): (t: number, out?: Vector3) => Vector3 {
  const [x, y, z] = ([0, 1, 2] as const).map((k) => scalar(keys.map(([t, p]): Key<number> => [t, p[k]])));
  return (t, out = new Vector3()) => out.set(x(t), y(t), z(t));
}

/**
 * A point going from `from` through `via` to `to` in `duration` s from when it is first read: one
 * smooth curve (a quadratic Bézier through `via` halfway), at rest at its ends (minimum jerk); it
 * stays at `to`. Into `out`.
 */
export function path(from: Vector3, via: Vector3, to: Vector3, duration: number, out = new Vector3()): (f: Frame<World>) => Vector3 {
  let start = -1;
  // (the control point that puts the curve's middle on `via`)
  const control = via.clone().multiplyScalar(2).addScaledVector(from, -0.5).addScaledVector(to, -0.5);
  return (f) => {
    if (start < 0) start = f.time;
    const s = minimumJerk((f.time - start) / duration);
    return out
      .copy(from)
      .multiplyScalar((1 - s) * (1 - s))
      .addScaledVector(control, 2 * s * (1 - s))
      .addScaledVector(to, s * s);
  };
}
