import { Quaternion, Vector3 } from 'three';
import type { Gait } from '../gait/gait';
import { clamp, hypot, smoothstep, Spring } from '../math';
import type { Proportions } from '../proportions';
import type { HandTask } from './tasks';

/** how fast readiness may rise per second once it is easing in */
const RISE_RATE = 2.2;
/** how fast a vanished target's weight fades per second */
const FADE_RATE = 0.9;

/**
 * One hand's readiness to reach its target. Far targets are walked to first and the arm
 * only reaches once in range; readiness rises at once for strikes but relaxes gently, and
 * a vanished target is let go of gradually. Explicit weights pass straight through.
 */
export class Reach {
  private readiness = new Spring();
  private target = new Vector3();
  private rot = new Quaternion();
  private rotated = false;
  private lastWeight = 0;
  private task: HandTask = { pos: this.target, rot: null, weight: 0 };

  constructor(
    private d: Proportions,
    private gait: Gait,
    /** the upper-arm joint */
    private shoulder: Vector3,
  ) {}

  /**
   * The hand task to act on this tick, given the requested target (`pos` null when none;
   * a target with weight 0 lets go at once) and hand rotation. `travel`: horizontal
   * distance the body still travels to where it is heading; `headTracked` (VR): the user
   * decides when to go down.
   */
  update(pos: Vector3 | null, rot: Quaternion | null, weight: number, travel: number, headTracked: boolean, dt: number): HandTask | null {
    const wanted = pos && weight > 0;
    const ready = wanted ? this.readinessFor(pos, travel, headTracked) : 0;
    if (wanted) this.lastWeight = weight;
    else this.lastWeight = Math.max(0, this.lastWeight - dt * FADE_RATE);

    const sp = this.readiness;
    const inStrikeRange = pos ? pos.distanceTo(this.shoulder) < 1.45 * this.d.armLength : false;
    let r: number;
    // a target that appears already within striking range is struck at once (punches);
    // anything already easing in keeps easing in
    if (ready >= sp.value && inStrikeRange && sp.value < 0.02) {
      sp.reset(ready);
      r = ready;
    } else if (ready >= sp.value) {
      sp.reset(Math.min(ready, sp.value + RISE_RATE * dt));
      r = sp.value;
    } else r = sp.step(ready, 4, dt);
    // when a target disappears, the hand eases back from where it was
    if (pos) {
      this.target.copy(pos);
      this.rotated = !!rot;
      if (rot) this.rot.copy(rot);
    }
    const w = clamp(r, 0, 1) * (pos ? weight : this.lastWeight);
    if (w <= 0.002) return null;
    const task = this.task;
    task.rot = this.rotated ? this.rot : null;
    task.weight = w;
    return task;
  }

  private readinessFor(pos: Vector3, travel: number, headTracked: boolean): number {
    const { d, shoulder, gait: g } = this;
    const L = d.armLength;
    // horizontal distance: anything below can be reached by bending/squatting
    const dh = hypot(pos.x - shoulder.x, pos.z - shoulder.z);
    const above = Math.max(0, pos.y - shoulder.y);
    const dist = hypot(dh, above);
    let ready = 1 - smoothstep(1.4 * L, 2.0 * L, dist);
    // don't reach out while still walking there: arrive, then reach
    const low = 1 - smoothstep(0.25 * d.height, 0.45 * d.height, pos.y);
    // floor-level things: arrive and plant first, then go down once
    if (!headTracked) ready *= 1 - low * Math.max(smoothstep(0.05, 0.3, g.walk), smoothstep(0.08, 0.2, travel));
    ready *= 1 - smoothstep(0.8, 1.4, travel) * smoothstep(0.2, 0.5, g.speed) * smoothstep(0.9 * L, 1.3 * L, dist);
    return ready;
  }
}
