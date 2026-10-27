import { Quaternion, Vector3 } from 'three';
import { STEP } from './frame';
import type { Trail, Placement, Goal } from './goal';
import { spinOf } from './rotation';

/**
 * A rigid frame as a body follows it (a held box, a socket, a moving target), with a history like a body's: `current` where it was
 * last moved to, `prev` and `prev2` the two sub-steps before. It is moved once per sub-step: by the body that moves what it is, after
 * that body's hands, or as it is found the first time it is read in a sub-step. Read it at a sub-step's time (`at`).
 */
export class Carrier implements Trail {
  readonly prev2: Placement;
  readonly prev: Placement;
  readonly current: Placement;
  /** the time it was last moved to (s) */
  private time = -Infinity;
  /** the body whose own bone carries its goal (`Target.carriedBy`), if one does: that body letting itself down carries it down too */
  carriedBy?: object;

  /** Whether a mover has already written this sub-step. */
  moved(time: number): boolean { return this.time >= time - 1e-9; }

  constructor(position: Vector3, quaternion = new Quaternion()) {
    const at = () => ({ position: position.clone(), quaternion: quaternion.clone() });
    [this.prev2, this.prev, this.current] = [at(), at(), at()];
  }

  /** moves it to where it is at `time` (s): once per sub-step; a sub-step it was not moved in it stood still */
  move(time: number, position: Readonly<Vector3>, quaternion: Readonly<Quaternion> = this.current.quaternion): void {
    if (time <= this.time + 1e-9) throw new Error(`a carrier moved twice at ${time.toFixed(4)} s`);
    const still = time - this.time > 1.5 * STEP;
    copy(this.prev2, still ? this.current : this.prev);
    copy(this.prev, this.current);
    this.current.position.copy(position);
    this.current.quaternion.copy(quaternion);
    this.time = time;
  }

  /** where it is at `time` (s) and the two sub-steps before: its fields, but while the body that wears it is posing that sub-step — the
   * body moves what it wears after its behaviour — carried on as it last moved */
  at(time: number): Trail {
    // (not moved the sub-step before nor this one, it has stood still since it last moved: no motion carried over)
    if (this.dueAt !== time && time - this.time > 1.5 * STEP) return { prev2: this.current, prev: this.current, current: this.current };
    if (this.dueAt !== time || this.moved(time)) return this;
    const { position, quaternion } = this.ahead;
    position.copy(this.current.position).multiplyScalar(2).sub(this.prev.position);
    quaternion.copy(this.prev.quaternion).invert().premultiply(this.current.quaternion).multiply(this.current.quaternion).normalize();
    return { prev2: this.prev, prev: this.current, current: this.ahead };
  }

  /** Its mover moves it at `time` (s), after what reads it then: a body wearing it, posing that sub-step. */
  due(time: number): void {
    this.dueAt = time;
  }

  private dueAt = NaN;
  private readonly ahead = { position: new Vector3(), quaternion: new Quaternion() };

  /** put where it is at `time` (s), as if it had stood there all along (made somewhere else, it starts on a body) */
  place(time: number, position: Readonly<Vector3>, quaternion: Readonly<Quaternion>): void {
    this.move(time, position, quaternion);
    copy(this.prev, this.current);
    copy(this.prev2, this.current);
  }

  /** its velocity (m/s) over the last sub-step */
  velocity(out: Vector3): Vector3 {
    return out.subVectors(this.current.position, this.prev.position).divideScalar(STEP);
  }

  /** `local` (in its frame) in the world as it is now — at `time` (s), if given (`at`) — into `out`: moving with it (v + ω × r) */
  toWorld(local: Goal, out: Goal & { velocity: Vector3; spin: Vector3 }, time?: number): Goal & { velocity: Vector3; spin: Vector3 } {
    const { prev, current: { position, quaternion } } = time === undefined ? this : this.at(time);
    const r = _r.copy(local.position).applyQuaternion(quaternion);
    out.position.copy(r).add(position);
    if (local.quaternion) (out.quaternion ??= new Quaternion()).copy(quaternion).multiply(local.quaternion);
    else out.quaternion = undefined;
    spinOf(prev.quaternion, quaternion, STEP, out.spin);
    out.velocity.subVectors(position, prev.position).divideScalar(STEP).add(_v.crossVectors(out.spin, r));
    return out;
  }
}

function copy(to: Placement, from: Placement) {
  to.position.copy(from.position);
  to.quaternion.copy(from.quaternion);
}

const [_r, _v] = [new Vector3(), new Vector3()];
