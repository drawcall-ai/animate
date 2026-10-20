import { Pose, type ReadonlyPose } from './pose';
import type { Body } from './body';

/**
 * The bodies sharing a place. `update` steps them all, each reading the others through `bodies` as they
 * were when the update began, so the order they update in changes nothing.
 */
export class World {
  /** every member's final pose as of the last update's start, its own too */
  readonly bodies: ReadonlyPose[] = [];
  private readonly members: [body: Body, seen: Pose][] = [];

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

  /** advances every member by `dt` (s) */
  update(dt: number): void {
    for (const [body, seen] of this.members) seen.copy(body.pose);
    for (const [body] of this.members) body.update(dt);
  }
}
