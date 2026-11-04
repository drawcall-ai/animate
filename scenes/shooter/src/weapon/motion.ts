import { Vector3 } from 'three';

/** Inertia follows the solved torso relative to the controller root, without a separate gait clock. */
export class WeaponMotion {
  readonly drift = new Spring(18);
  readonly recoil = new Spring(22);
  private readonly torso = new Spring(32);
  private previous: Vector3 | undefined;
  private readonly velocity = new Vector3();

  update(dt: number, chest: Vector3) {
    // Contact corrections are not hand impulses. Filter the attachment before differentiating it.
    if (!this.previous) this.torso.position.copy(chest);
    this.torso.update(dt, chest);
    if (this.previous) {
      const velocity = this.torso.position.clone().sub(this.previous).divideScalar(dt);
      this.drift.velocity.sub(velocity.clone().sub(this.velocity));
      this.velocity.copy(velocity);
    }
    this.previous = this.torso.position.clone();
    this.drift.update(dt);
    this.recoil.update(dt);
  }

  fire() {
    // The muzzle rotates around the stock; the body's impulse moves the shoulder itself.
    this.recoil.velocity.x -= 6.8;
  }
}

class Spring {
  readonly position = new Vector3();
  readonly velocity = new Vector3();

  constructor(private readonly frequency: number) {}

  update(dt: number, target = new Vector3()) {
    const offset = this.position.clone().sub(target);
    const change = this.velocity.clone().addScaledVector(offset, this.frequency);
    const decay = Math.exp(-this.frequency * dt);
    this.position.copy(offset).addScaledVector(change, dt).multiplyScalar(decay).add(target);
    this.velocity.addScaledVector(change, -this.frequency * dt).multiplyScalar(decay);
  }
}
