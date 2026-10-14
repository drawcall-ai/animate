import { Vector3 } from 'three';
import { minimumJerk } from '@drawcall/animate';

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

/** A key a point goes to, round `via` on its way there from the key before. */
export type Way = [time: number, to: [number, number, number], via?: [number, number, number]];

/**
 * a point through keys: from each to the next at rest at both (minimum jerk), straight or round its
 * way's `via` (`curve`), held before the first and after the last (into `out`)
 */
export function route(ways: readonly Way[]): (t: number, out?: Vector3) => Vector3 {
  if (ways.length === 0) throw new Error('no keys');
  const points = ways.map(([, to]) => new Vector3(...to));
  const curves = ways.map(([, , via], i) => (i > 0 && via ? curve(points[i - 1], new Vector3(...via), points[i]) : null));
  return (t, out = new Vector3()) => {
    if (t <= ways[0][0]) return out.copy(points[0]);
    for (let i = 1; i < ways.length; i++) {
      const t1 = ways[i][0];
      if (t > t1) continue;
      const t0 = ways[i - 1][0];
      if (!(t1 > t0)) throw new Error(`key times must increase: ${t0} → ${t1}`);
      const s = minimumJerk((t - t0) / (t1 - t0));
      return curves[i]?.(s, out) ?? out.lerpVectors(points[i - 1], points[i], s);
    }
    return out.copy(points[points.length - 1]);
  };
}

/** where a point through keys (see `route`) is going at `t`: the key it next comes to rest at (into `out`) */
export function destination(ways: readonly Way[]): (t: number, out?: Vector3) => Vector3 {
  return (t, out = new Vector3()) => out.set(...(ways.find(([time]) => time >= t) ?? ways[ways.length - 1])[1]);
}

/** the quadratic Bézier from `from` to `to` through `via` halfway, at `s` (0 … 1, into `out`) */
function curve(from: Vector3, via: Vector3, to: Vector3): (s: number, out: Vector3) => Vector3 {
  // (the control point that puts the curve's middle on `via`)
  const control = via.clone().multiplyScalar(2).addScaledVector(from, -0.5).addScaledVector(to, -0.5);
  return (s, out) =>
    out
      .copy(from)
      .multiplyScalar((1 - s) * (1 - s))
      .addScaledVector(control, 2 * s * (1 - s))
      .addScaledVector(to, s * s);
}
