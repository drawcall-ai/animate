import { lerp } from '../../math';
import type { PostureCost } from '../cost';
import { P } from '../trunk';

/** how far the trunk stoops (hip + 0.6 × spine flexion, rad) ducking under something before the knees bend instead */
const STOOP = 1;

/** Effort terms (13 rows); the planner prefers stepping over leaning. */
export function comfortRows(c: PostureCost, p: Float64Array, r: Float64Array, n: number): number {
  const { tasks, walk, planner, sit } = c;
  // leaning is costlier while walking: you don't dive toward things mid-stride (ducking
  // under something, or leaning into a push, is another matter)
  const lean = planner ? 2.2 : 1 + (tasks.head ? 0.3 : 2.5) * walk * (1 - Math.max(c.duck, c.strain));
  r[n++] = 1.1 * lean * p[P.HIP];
  r[n++] = 1.5 * lean * p[P.SPINE];
  r[n++] = 2.5 * p[P.ROLL];
  r[n++] = (planner ? 3 : 1.3) * p[P.TWIST];
  r[n++] = 0.8 * (1 - 0.9 * sit) * (p[P.DROP] - c.crouch);
  // rising onto the toes is effortful (only for out-of-reach overhead targets)
  r[n++] = 6 * Math.min(0, p[P.DROP]);
  r[n++] = 4 * (1 - sit) * (p[P.SHIFT] - c.oneLeg.shift);
  r[n++] = 6 * (p[P.SIDE] - c.oneLeg.side);
  // extending the trunk backward is effortful and rare (seated, it leans back onto a backrest)
  const recline = sit * (tasks.seat?.recline ?? 0);
  r[n++] = 6 * (1 - c.kick) * Math.min(0, p[P.HIP] + 0.08 + recline);
  r[n++] = recline > 0 ? 5 * (p[P.HIP] + 0.5 * p[P.SPINE] + recline) : 0;
  r[n++] = 6 * Math.min(0, p[P.SPINE] + 0.05);
  // back load grows steeply past ~45° of trunk flexion: bend the knees instead (ducking
  // under something, the trunk stoops further first: a bent-knee walk works the knees every step)
  r[n++] = 8 * Math.max(0, p[P.HIP] + 0.6 * p[P.SPINE] - lerp(0.62, STOOP, c.duck));
  // lumbar flexion follows hip flexion (lumbo-pelvic rhythm)
  r[n++] = 0.8 * (p[P.SPINE] - 0.45 * p[P.HIP]);
  return n;
}
