// The height a body stands at over its floor: the floor under its way, kept low over its edges and smoothed over its stride.
import { FLAT, type Floor } from '../floor';
import type { Steering } from './state';

/**
 * The ground a body's pelvis stands its height over, a sub-step at a time: the floor under the root's way — the heights it has passed
 * kept, those to come read on along its velocity (not a planner's forecast: its plans change from one sub-step to the next, its velocity
 * only as fast as it speeds up) — each the lowest within `LOW` either side of it (an erosion: the
 * body stays down over a rise until it is nearly past it, and goes down to a drop before it), then averaged over `SPAN` s centred on
 * now (a Hann window). Up a flight walked at a steady pace it rises steadily (recalled: the centre of mass rises through the stride
 * climbing, ~0.3–0.5 m/s), each tread's step averaged out; standing, it is the floor under the body. The legs reach down or up from
 * there to the feet as they stand: the lead knee bent on the tread above, the stance leg lifting the body as the trailing foot leaves.
 */
export class Ground {
  /** the floor under the root each sub-step it has passed, the newest first */
  private readonly passed: number[] = [];
  private readonly heights: number[] = [];
  private readonly times: number[] = [];

  /** `length`: the legs' (m), which the floor's edges are kept low over in proportion to */
  constructor(private readonly floor: Floor, private readonly length: number) {}

  /** the ground under root `r` this sub-step of `dt` s (m) */
  at(r: Steering, dt: number): number {
    const { floor, passed, heights, times } = this, here = floor(r.position.x, r.position.z);
    if (floor === FLAT) return here;
    const speed = Math.hypot(r.velocity.x, r.velocity.z), back = Math.round((LOW.most + SPAN / 2) / dt);
    const low = Math.min(LOW.most, LOW.legs * this.length / Math.max(speed, LOW.slow)), reach = low + SPAN / 2;
    if (passed.length === 0) passed.push(...Array.from({ length: back }, () => here));
    passed.unshift(here);
    passed.length = back + 1;
    [heights.length, times.length] = [0, 0];
    for (let k = Math.round(reach / dt); k >= 0; k--) [heights[heights.length], times[times.length]] = [passed[k], -k * dt];
    for (let t = AHEAD * dt; t <= reach + 1e-9; t += AHEAD * dt) {
      heights.push(floor(r.position.x + r.velocity.x * t, r.position.z + r.velocity.z * t));
      times.push(t);
    }
    let sum = 0, weights = 0;
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      if (Math.abs(t) > SPAN / 2) continue;
      let lowest = Infinity;
      for (let j = 0; j < times.length; j++) if (Math.abs(times[j] - t) <= low + 1e-9) lowest = Math.min(lowest, heights[j]);
      // (each weighed for the sub-steps it stands for)
      const w = Math.cos(Math.PI * t / SPAN) ** 2 * (t > 0 ? AHEAD : 1);
      [sum, weights] = [sum + w * lowest, weights + w];
    }
    return sum / weights;
  }
}

/**
 * Tuned: the window the ground averages the floor over (s). Recalled: stair ascent at ~1.5–1.8 steps/s puts a tread ~0.55–0.65 s
 * apart: a Hann window as wide as two of them leaves no ripple of the treads.
 */
const SPAN = 1.2;
/**
 * Tuned: how far either side the ground takes the lowest floor: `legs` × the legs' length of its way (at no slower than `slow` m/s),
 * at most `most` s — about a step, so a rise lifts the body once its stance leg stands on the tread above, and a drop lets it down as
 * its swinging foot reaches for the tread below
 */
const LOW = { legs: 0.8, slow: 0.3, most: 1 };
/** sub-steps between the heights to come it reads */
const AHEAD = 2;
