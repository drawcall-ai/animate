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

/** the way yaw `yaw` faces on the floor (0 faces +Z, positive turns toward +X), into `out` */
export const forwardOf = (yaw: number, out = new Vector3()) => out.set(Math.sin(yaw), 0, Math.cos(yaw));

/** the left of a body facing `yaw` on the floor, into `out` */
export const leftOf = (yaw: number, out = new Vector3()) => out.set(Math.cos(yaw), 0, -Math.sin(yaw));

/** `angle` wrapped into [−π, π] */
export const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** a random source seeded by `seed` (mulberry32): the same numbers every run */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
