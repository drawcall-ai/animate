import { Vector3 } from 'three';

/**
 * A vector following a moving target on a critically damped spring; it starts on the first target
 * (or `reset`). Given the target's velocity, it follows without lagging (the spring then works only
 * on how the target strays from moving at that velocity). Each step is exact for the target
 * having moved at that velocity through it, so the result doesn't depend on the frame rate.
 */
export class Spring {
  readonly value = new Vector3();
  private readonly velocity = new Vector3();
  private started = false;

  step(target: Vector3, omega: number, dt: number, targetVelocity: Vector3 = STILL): Vector3 {
    if (!this.started) return this.reset(target);
    const e = Math.exp(-omega * dt);
    for (const k of ['x', 'y', 'z'] as const) {
      const u = targetVelocity[k];
      // (from where the target was as the step began)
      const delta = this.value[k] - target[k] + u * dt;
      const dv = this.velocity[k] - u;
      const c = dv + omega * delta;
      this.value[k] = target[k] + (delta + c * dt) * e;
      this.velocity[k] = u + (dv - omega * c * dt) * e;
    }
    return this.value;
  }

  reset(to: Vector3): Vector3 {
    this.started = true;
    this.velocity.set(0, 0, 0);
    return this.value.copy(to);
  }
}

const STILL = new Vector3();
