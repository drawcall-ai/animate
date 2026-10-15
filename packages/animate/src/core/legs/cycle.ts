// Reference curves: a value over one gait cycle, read off published plots as keyframes.

/** degrees to radians */
export const DEG = Math.PI / 180;

/**
 * A value over one cycle of a leg: keyframes `[u, value]` (u in [0, 1), rising), periodic, a
 * Catmull-Rom spline through them. `duty` is where the cycle's own stance ends (its toe-off).
 */
export interface JointCycle {
  duty: number;
  /** A second reference shape; the gait selects its share independently of contact timing. */
  alternate?: JointCycle['keys'];
  keys: readonly (readonly [number, number])[];
}

/** the curve at `u` (0 … 1, wrapping) */
export function valueAt(keys: JointCycle['keys'], u: number): number {
  const n = keys.length;
  if (n === 0) throw new Error('a cycle without keys');
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
export const angleAt = (c: JointCycle, u: number, duty: number, blend = 0) => cycleAt(c, cyclePhase(u, duty, c.duty), blend);

/** The reference at its own phase, independently of the contact schedule. */
export function cycleAt(c: JointCycle, phase: number, blend = 0): number {
  const base = valueAt(c.keys, phase);
  if (!c.alternate || blend === 0) return base * DEG;
  return (base + (valueAt(c.alternate, phase) - base) * blend) * DEG;
}
