import { Quaternion, Vector3 } from 'three';
import { follow, followRotation } from './follow';
import type { Motion } from './goal';
import { spinOf } from './rotation';

/** How a tracked goal is followed: `Motion`'s acceleration and speed; a goal moving faster than `speed` jumped (it is braked to, not followed). */
type Pace = Pick<Motion, 'accel' | 'speed'>;

/**
 * A goal point followed with its own velocity: it keeps where the goal was the sub-step before, so a goal moving smoothly is followed
 * without lag (`follow` with its velocity), a jump braked. A goal not seen before is taken as still. One per goal followed.
 */
export class TrackedPoint {
  private readonly sample = new PointVelocity();

  follow(prev2: Readonly<Vector3>, prev: Readonly<Vector3>, goal: Readonly<Vector3>, pace: Pace, dt: number, out: Vector3): Vector3 {
    return follow(prev2, prev, goal, { ...pace, velocity: this.sample.read(goal, dt, pace.speed) }, dt, out);
  }
}

/** Finite-difference target velocity; first samples and jumps are stationary goals. */
export class PointVelocity {
  private last: Vector3 | null = null;
  private readonly velocity = new Vector3();

  read(goal: Readonly<Vector3>, dt: number, speed = Infinity): Vector3 {
    const last = (this.last ??= goal.clone());
    this.velocity.subVectors(goal, last).divideScalar(dt);
    if (!Number.isFinite(dt) || this.velocity.length() > speed) this.velocity.set(0, 0, 0);
    last.copy(goal);
    return this.velocity;
  }
}

/** `TrackedPoint` for a rotation (in whatever frame its quaternions are in). */
export class TrackedRotation {
  private last: Quaternion | null = null;

  follow(prev2: Readonly<Quaternion>, prev: Readonly<Quaternion>, goal: Readonly<Quaternion>, pace: Pace, dt: number, out: Quaternion): Quaternion {
    const last = (this.last ??= goal.clone());
    const velocity = spinOf(last, goal, dt, _v);
    if (velocity.length() > (pace.speed ?? Infinity)) velocity.set(0, 0, 0);
    last.copy(goal);
    return followRotation(prev2, prev, goal, { ...pace, velocity }, dt, out);
  }
}

const _v = new Vector3();
