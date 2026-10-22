import { Vector3 } from 'three';
import { forwardOf, GRAVITY, leftOf } from './math';

/**
 * How a body's trunk takes its root's speeding up, slowing down and turning (`Species.inertia`): the acceleration it leans to is its
 * root's velocity as a spring of `frequency` (Hz) damped `damping` (of critical) follows it — felt over about a step, not as a box of
 * acceleration; below critical it overshoots: a stop's lean back swings forward past upright and settles. Along its facing the trunk
 * pitches front down `ahead` × atan(a / g) into speeding up and front up `back` × atan(a / g) from slowing down; across, it rolls
 * `roll` × atan(a / g) toward it (round a bend: into the turn); each eased toward at most `most` (rad).
 */
export interface Inertial {
  ahead: number;
  back: number;
  roll: number;
  most: number;
  frequency: number;
  damping: number;
}

/**
 * A body's lean into its root's acceleration as `Inertial` has it, a sub-step at a time (`step`): `pitch` (rad, + front down) and
 * `roll` (rad, + left side up). The lean atan(a / g) tips the trunk so the floor's push passes through the centre of mass.
 */
export class Inertia {
  pitch = 0;
  roll = 0;
  private felt: { velocity: Vector3; accel: Vector3 } | null = null;

  constructor(private readonly of: Inertial) {}

  /** one sub-step on, the root's ground `velocity` (m/s) as it faces `yaw` (rad) */
  step(velocity: Readonly<Vector3>, yaw: number, dt: number): void {
    const { ahead, back, roll, most, frequency, damping } = this.of, w = 2 * Math.PI * frequency;
    // (spawned on the move, it starts at that pace: no lean from nothing)
    const felt = (this.felt ??= { velocity: new Vector3(velocity.x, 0, velocity.z), accel: new Vector3() });
    felt.accel.addScaledVector(_v.set(velocity.x, 0, velocity.z).sub(felt.velocity).multiplyScalar(w * w).addScaledVector(felt.accel, -2 * damping * w), dt);
    felt.velocity.addScaledVector(felt.accel, dt);
    // (eased into `most`, not stopped at it)
    const lean = (share: number, along: number) => most * Math.tanh(share * Math.atan2(along, GRAVITY) / most);
    const along = felt.accel.dot(forwardOf(yaw, _v));
    this.pitch = lean(along > 0 ? ahead : back, along);
    this.roll = -lean(roll, felt.accel.dot(leftOf(yaw, _v)));
  }
}

const _v = new Vector3();
