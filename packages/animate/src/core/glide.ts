import { Vector3 } from 'three';

/**
 * A point gliding to a goal along a minimum-jerk path (a bell of speed: it sets off and comes to
 * rest smoothly, peaking at 1.875× its mean speed — Flash & Hogan 1985) in `seconds`, from wherever
 * it is and however it moves when it sets off. It re-plans every step for the time left (the
 * quintic from where it is, how fast and how it speeds up, to the goal moving with its velocity: the
 * online form, Hoff & Arbib 1993), so it follows a goal that moves on; once its time is up it goes
 * with the goal. One per glide.
 */
export class Glide {
  private readonly position = new Vector3();
  private readonly velocity = new Vector3();
  private readonly acceleration = new Vector3();
  private left = NaN;

  constructor(readonly seconds: number) {
    if (!(seconds > 0)) throw new Error(`a glide of ${seconds} s`);
  }

  /**
   * where it is a step of `dt` on toward `goal` moving at `going` (into `out`: its position and
   * velocity); `from` and `moving` are where it sets off from and how fast, read the first step
   */
  step(from: Readonly<Vector3>, moving: Readonly<Vector3>, goal: Readonly<Vector3>, going: Readonly<Vector3>, dt: number, out: { position: Vector3; velocity: Vector3 }): { position: Vector3; velocity: Vector3 } {
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
      const t = dt;
      x.addScaledVector(v, t).addScaledVector(a, (t * t) / 2).addScaledVector(c3, t ** 3).addScaledVector(c4, t ** 4).addScaledVector(c5, t ** 5);
      const a0 = _a0.copy(a);
      a.addScaledVector(c3, 6 * t).addScaledVector(c4, 12 * t * t).addScaledVector(c5, 20 * t ** 3);
      v.addScaledVector(a0, t).addScaledVector(c3, 3 * t * t).addScaledVector(c4, 4 * t ** 3).addScaledVector(c5, 5 * t ** 4);
    }
    out.position.copy(this.position);
    out.velocity.copy(this.velocity);
    return out;
  }
}

const _e0 = new Vector3();
const _e1 = new Vector3();
const _e2 = new Vector3();
const _c3 = new Vector3();
const _c4 = new Vector3();
const _c5 = new Vector3();
const _a0 = new Vector3();
