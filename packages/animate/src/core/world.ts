import { Pose, type ReadonlyPose } from './pose';
import { STEP, type Body } from './body';

/**
 * The bodies sharing a place. `update` steps them all a sub-step at a time, each reading the others through `bodies` as they
 * were when the sub-step began, so the order they update in changes nothing; before each sub-step, what `moving` was given
 * moves the scene's own things.
 */
export class World {
  /** every member's final pose as of the last update's start, its own too */
  readonly bodies: ReadonlyPose[] = [];
  private readonly members: [body: Body, seen: Pose][] = [];
  private readonly movers: ((time: number) => void)[] = [];
  private pending = 0;
  /** the time of its last sub-step (s): its bodies' own, those that joined it new */
  time = 0;

  /** the final poses of its members other than `body`, as of the last sub-step's start */
  others(body: Body): ReadonlyPose[] {
    return this.members.flatMap(([member, seen]) => member === body ? [] : [seen]);
  }

  /** `bodies` join: their behaviours read this world (`Frame.world`) and `update` steps them, in the order added */
  add(...bodies: Body[]): this {
    for (const body of bodies) {
      body.join(this);
      const seen = new Pose(body.pose.skeleton).copy(body.pose);
      this.members.push([body, seen]);
      this.bodies.push(seen);
    }
    return this;
  }

  /**
   * `move` runs before every sub-step with its time (s): it moves the scene's own carriers there (`Item.move`), a cart or a target, as
   * bodies read them — however long the frames the world is updated by
   */
  moving(move: (time: number) => void): this {
    this.movers.push(move);
    return this;
  }

  /** advances every member by `dt` (s), in whole sub-steps (what is left over is taken with the next update) */
  update(dt: number): void {
    if (!(dt >= 0 && Number.isFinite(dt))) throw new Error(`cannot update by ${dt} s`);
    this.pending += dt;
    // (1e-9: 1/30 is a hair under two sub-steps of 1/60 in floating point)
    const steps = Math.floor(this.pending / STEP + 1e-9);
    this.pending = Math.max(0, this.pending - steps * STEP);
    for (let i = 0; i < steps; i++) {
      this.time += STEP;
      for (const move of this.movers) move(this.time);
      for (const [body, seen] of this.members) seen.copy(body.pose);
      for (const [body] of this.members) body.update(STEP);
    }
  }
}
