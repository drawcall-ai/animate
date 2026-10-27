import { Vector3 } from 'three';

/**
 * A point gliding to a goal along a minimum-jerk path (a bell of speed: it sets off and comes to rest smoothly, peaking at 1.875× its
 * mean speed — Flash & Hogan 1985) in `seconds`, from wherever it is and however it moves when it sets off. It re-plans every step for
 * the time left (the quintic from where it is, how fast and how it speeds up, to the goal moving with its velocity: the online form,
 * Hoff & Arbib 1993), so it follows a goal that moves on; once its time is up it goes with the goal. One per glide.
 */
export class Glide {
  private readonly position = new Vector3();
  private readonly velocity = new Vector3();
  private readonly acceleration = new Vector3();
  private left = NaN;

  constructor(readonly seconds: number) {
    if (!(seconds > 0)) throw new Error(`a glide of ${seconds} s`);
  }

  /** where it is a step of `dt` on toward `goal` moving at `going` (into `out`: its position and velocity); `from` and `moving` are
   * where it sets off from and how fast, read the first step */
  step(
    from: Readonly<Vector3>,
    moving: Readonly<Vector3>,
    goal: Readonly<Vector3>,
    going: Readonly<Vector3>,
    dt: number,
    out: { position: Vector3; velocity: Vector3 },
  ): { position: Vector3; velocity: Vector3 } {
    if (Number.isNaN(this.left)) {
      this.left = this.seconds;
      this.position.copy(from);
      this.velocity.copy(moving);
      this.acceleration.set(0, 0, 0);
    }
    const T = this.left;
    this.left -= dt;
    if (T <= dt) {
      this.position.copy(goal);
      this.velocity.copy(going);
      this.acceleration.set(0, 0, 0);
    } else {
      // (the quintic x0 + v0 t + a0 t²/2 + c3 t³ + c4 t⁴ + c5 t⁵ that ends on the goal, moving with it, not speeding up)
      const { position: x, velocity: v, acceleration: a } = this;
      const e0 = _e0.copy(goal).sub(x).addScaledVector(v, -T).addScaledVector(a, (-T * T) / 2);
      const e1 = _e1.copy(going).sub(v).addScaledVector(a, -T);
      const e2 = _e2.copy(a).negate();
      const c3 = _c3.copy(e0).multiplyScalar(20).addScaledVector(e1, -8 * T).addScaledVector(e2, T * T).divideScalar(2 * T ** 3);
      const c4 = _c4.copy(e0).multiplyScalar(-30).addScaledVector(e1, 14 * T).addScaledVector(e2, -2 * T * T).divideScalar(2 * T ** 4);
      const c5 = _c5.copy(e0).multiplyScalar(12).addScaledVector(e1, -6 * T).addScaledVector(e2, T * T).divideScalar(2 * T ** 5);
      x.addScaledVector(v, dt).addScaledVector(a, (dt * dt) / 2).addScaledVector(c3, dt ** 3).addScaledVector(c4, dt ** 4).addScaledVector(c5, dt ** 5);
      const a0 = _a0.copy(a);
      a.addScaledVector(c3, 6 * dt).addScaledVector(c4, 12 * dt * dt).addScaledVector(c5, 20 * dt ** 3);
      v.addScaledVector(a0, dt).addScaledVector(c3, 3 * dt * dt).addScaledVector(c4, 4 * dt ** 3).addScaledVector(c5, 5 * dt ** 4);
    }
    out.position.copy(this.position);
    out.velocity.copy(this.velocity);
    return out;
  }
}

const [_e0, _e1, _e2, _c3, _c4, _c5, _a0] = Array.from({ length: 7 }, () => new Vector3());
