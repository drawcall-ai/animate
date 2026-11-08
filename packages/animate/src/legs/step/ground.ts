// The height a body stands at over its floor: the floor under its way, kept low over its edges and smoothed over its stride.
import { FLAT, type Floor } from '../floor';
import { Matrix4, Vector3 } from 'three';
import type { Steering } from './state';

/**
 * The ground a body's pelvis stands its height over, a sub-step at a time: the floor under the root's way — the heights it has passed
 * kept, those to come read on along its velocity (not a planner's forecast: its plans change from one sub-step to the next, its velocity
 * only as fast as it speeds up) — each the lowest within `LOW` behind and ahead of it (an erosion: the
 * body stays down over a rise until it stands over it, and goes down to a drop before it), then averaged over `SPAN` s centred on
 * now (a Hann window). Up a flight walked at a steady pace it rises steadily (recalled: the centre of mass rises through the stride
 * climbing, ~0.3–0.5 m/s), each tread's step averaged out; standing, it is the floor under the body. The legs reach down or up from
 * there to the feet as they stand: the lead knee bent on the tread above, the stance leg lifting the body as the trailing foot leaves.
 */
export class Ground {
  /** the floor and actual distance travelled at each passed sub-step, newest first */
  private readonly passed: { height: number; distance: number }[] = [];
  private readonly heights: number[] = [];
  private readonly times: number[] = [];
  private readonly distances: number[] = [];
  private distance = 0;
  private previous: readonly [number, number] | undefined;
  /** the last average read where the floor is level all along the way: the same height over as many samples averages the same */
  private level = { height: NaN, samples: 0, average: NaN };
  /** how fast it rose over the last sub-step (m/s) */
  rising = 0;
  private last = NaN;

  /** `length`: the legs' (m), which the floor's edges are kept low over in proportion to */
  constructor(private readonly floor: Floor, private readonly length: number) {}

  /** A new support after flight has no grounded path back to the take-off surface. */
  reset() {
    this.passed.length = 0;
    this.distance = 0;
    this.previous = undefined;
    this.last = NaN;
  }

  /** Carry the remembered path with a level moving platform. */
  transport(matrix: Matrix4) {
    const height = matrix.elements[13];
    for (const sample of this.passed) sample.height += height;
    if (this.previous) {
      const point = new Vector3(this.previous[0], this.last, this.previous[1]).applyMatrix4(matrix);
      this.previous = [point.x, point.z];
    }
    this.last += height;
  }

  /** the ground under root `r` this sub-step of `dt` s (m), standing on physics' `contact` if it has one: a drop ahead deeper than the
   * legs' `stroke` (m) is a fall, not ground */
  at(r: Steering, dt: number, stroke: number, contact: Vector3 | undefined): number {
    const height = this.under(r, dt, stroke, contact);
    this.rising = Number.isNaN(this.last) ? 0 : (height - this.last) / dt;
    this.last = height;
    return height;
  }

  private under(r: Steering, dt: number, stroke: number, contact: Vector3 | undefined): number {
    const { floor, passed, heights, times, distances } = this, here = contact?.y ?? floor(r.position.x, r.position.z);
    if (floor === FLAT) return here;
    if (this.previous) this.distance += Math.hypot(r.position.x - this.previous[0], r.position.z - this.previous[1]);
    this.previous = [r.position.x, r.position.z];
    const speed = Math.hypot(r.velocity.x, r.velocity.z), back = Math.round((LOW.most + SPAN / 2) / dt);
    const ahead = Math.min(LOW.most, LOW.drop * this.length / Math.max(speed, LOW.slow));
    if (passed.length === 0) passed.push(...Array.from({ length: back }, () => ({ height: here, distance: this.distance })));
    passed.unshift({ height: here, distance: this.distance });
    passed.length = back + 1;
    [heights.length, times.length, distances.length] = [0, 0, 0];
    for (let k = back; k >= 0; k--) {
      heights.push(passed[k].height);
      times.push(-k * dt);
      distances.push(passed[k].distance);
    }
    for (let t = dt; t <= ahead + SPAN / 2 + 1e-9; t += dt) {
      const at = contact ?? r.position;
      const height = floor(at.x + r.velocity.x * t, at.z + r.velocity.z * t);
      // Preview reachable steps. A drop beyond the knees' range is a fall for physics to begin.
      heights.push(contact && here - height > stroke ? here : height);
      times.push(t);
      distances.push(this.distance + speed * t);
    }
    // (a level way, as most of a body's sub-steps are: the erosion below, every sample against every other, finds nothing lower)
    const flat = heights.every((height) => height === here);
    if (flat && this.level.height === here && this.level.samples === times.length) return this.level.average;
    let sum = 0, weights = 0;
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      if (Math.abs(t) > SPAN / 2) continue;
      let lowest = Infinity;
      for (let j = 0; j < times.length; j++) {
        if (Math.abs(times[j] - t) > LOW.most + 1e-9) continue;
        const distance = distances[j] - distances[i];
        // Physics already advances the support down the stairs; eroding into future drops lowers the hips before the trailing foot clears.
        if (distance >= -LOW.rise * this.length - 1e-9 && distance <= (contact ? 0 : LOW.drop * this.length) + 1e-9)
          lowest = Math.min(lowest, heights[j]);
      }
      // (read every sub-step: read every other one ahead, a tread's edge entered each sample's lowest in jumps of a centimetre every
      // other sub-step, the pelvis' speed alternating with them)
      const w = Math.cos(Math.PI * t / SPAN) ** 2;
      [sum, weights] = [sum + w * lowest, weights + w];
    }
    if (flat) this.level = { height: here, samples: times.length, average: sum / weights };
    return sum / weights;
  }
}

/**
 * Tuned: the window the ground averages the floor over (s). Recalled: stair ascent at ~1.5–1.8 steps/s puts a tread ~0.55–0.65 s
 * apart: a Hann window as wide as two of them leaves no ripple of the treads.
 */
const SPAN = 1.2;
/**
 * Tuned: how far behind and ahead the ground takes the lowest floor, in legs' lengths of its way, at most `most` s; `slow` bounds the
 * future sampling window. A little behind — a rise lifts the body once its stance leg stands on the tread above, the lead knee bent; well ahead — a
 * drop lets it down as its swinging foot reaches for the tread below, the stance knee bending to lower it (a step down's swing lets the
 * pelvis down the rest: the farther ahead, the earlier and deeper the body crouches — at 0.7 its knees bent 105° on the landing above
 * the flight before its first step down, 100° as a foot landed on a tread — the nearer, the faster it is let down through each swing)
 */
const LOW = { rise: 0.25, drop: 0.45, slow: 0.3, most: 1 };
