// Reference curves: a value over one gait cycle, read off published plots as keyframes.

/** degrees to radians */
export const DEG = Math.PI / 180;

/**
 * A value over one cycle of a leg: keyframes `[u, value]` (u in [0, 1), rising), periodic, a
 * Catmull-Rom spline through them. `duty` is where the cycle's own stance ends (its toe-off).
 */
export interface Cycle {
  duty: number;
  keys: readonly (readonly [number, number])[];
}

/** the curve at `u` (0 … 1, wrapping); not `periodic`, held at its ends past them */
export function valueAt(keys: Cycle['keys'], u: number, periodic = true): number {
  const n = keys.length;
  if (n === 0) throw new Error('a cycle without keys');
  if (!periodic) return spanAt(keys, Math.min(keys[n - 1][0], Math.max(keys[0][0], u)));
  const x = u - Math.floor(u);
  let i = n - 1;
  for (let k = 0; k < n; k++) if (keys[k][0] <= x) i = k;
  const at = (k: number) => keys[((k % n) + n) % n];
  // (the keys' u unwrapped around x: before the first key, the last one's is a cycle back)
  let u0 = at(i)[0];
  if (u0 > x) u0 -= 1;
  let u1 = at(i + 1)[0];
  while (u1 <= u0) u1 += 1;
  const t = (x - u0) / (u1 - u0);
  const [p0, p1, p2, p3] = [at(i - 1)[1], at(i)[1], at(i + 1)[1], at(i + 2)[1]];
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

/** an open curve at `x` within its keys, its ends' neighbours themselves */
function spanAt(keys: Cycle['keys'], x: number): number {
  const n = keys.length;
  let i = 0;
  for (let k = 0; k < n - 1; k++) if (keys[k][0] <= x) i = k;
  if (n === 1) return keys[0][1];
  const at = (k: number) => keys[Math.min(n - 1, Math.max(0, k))][1];
  const t = (x - keys[i][0]) / (keys[i + 1][0] - keys[i][0]);
  const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

/**
 * The cycle's phase for a leg `u` into its cycle (0 … 1) whose stance lasts `duty` of it: the
 * stance and the swing each stretched onto the cycle's own (a reference curve keeps its shape over
 * contact, whatever the speed's duty)
 */
export function cyclePhase(u: number, duty: number, cycleDuty: number): number {
  const x = u - Math.floor(u);
  if (x < duty) return (x / duty) * cycleDuty;
  return cycleDuty + ((x - duty) / (1 - duty)) * (1 - cycleDuty);
}

/** the cycle at leg phase `u` of a stride whose stance lasts `duty` (rad: its keys are degrees) */
export const angleAt = (c: Cycle, u: number, duty: number) => valueAt(c.keys, cyclePhase(u, duty, c.duty)) * DEG;
