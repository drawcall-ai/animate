import { Quaternion, Vector3 } from 'three';
import { follow, followRotation } from './follow';
import type { Motion } from './goal';
import { spinOf } from './rotation';

/** How a tracked goal is followed: `Motion`'s acceleration and speed. */
type TrackedMotion = Pick<Motion, 'accel' | 'speed'>;

/** Follow finite-difference goal velocity without lag; brake jumps and treat the first sample as stationary. One sampler per goal. */
export class TrackedPoint {
  private readonly sample = new PointVelocity();

  /** `jumpAbove`: a goal moving faster than this (m/s; default the pace's speed) jumped: it is braked to as at rest, not followed in its motion */
  follow(prev2: Readonly<Vector3>, prev: Readonly<Vector3>, goal: Readonly<Vector3>, pace: TrackedMotion, dt: number, out: Vector3, jumpAbove = pace.speed): Vector3 {
    return follow(prev2, prev, goal, { ...pace, velocity: this.sample.read(goal, dt, jumpAbove) }, dt, out);
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

  /** `jumpAbove`: a goal turning faster than this (rad/s; default the pace's speed) jumped: it is braked to as at rest, not followed */
  follow(prev2: Readonly<Quaternion>, prev: Readonly<Quaternion>, goal: Readonly<Quaternion>, pace: TrackedMotion, dt: number, out: Quaternion,
    jumpAbove = pace.speed ?? Infinity): Quaternion {
    const last = (this.last ??= goal.clone());
    const velocity = spinOf(last, goal, dt, _v);
    if (velocity.length() > jumpAbove) velocity.set(0, 0, 0);
    last.copy(goal);
    return followRotation(prev2, prev, goal, { ...pace, velocity }, dt, out);
  }
}

const _v = new Vector3();
