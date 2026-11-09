import { Quaternion, Vector3 } from 'three';
import type { ReadonlyPose } from '../../kernel/pose';
import { exp } from '../../kernel/rotation';
import { INDEX } from '../anatomy/bones';

/** Supported torso response to a short push: angular momentum, then muscular recovery. */
export class Impact {
  active = false;
  readonly rotation = new Quaternion();
  /** its rotation the last two sub-steps, which the trunk's own history is read without */
  readonly prev = new Quaternion();
  readonly prev2 = new Quaternion();
  private readonly angle = new Vector3();
  private readonly velocity = new Vector3();

  apply(pose: ReadonlyPose, impulse: Readonly<Vector3>, point: Readonly<Vector3>): void {
    if (![...impulse.toArray(), ...point.toArray()].every(Number.isFinite)) throw new Error('applyImpulse: impulse and point must be finite');
    if (impulse.lengthSq() === 0) return;
    const back = pose.rotation(0).clone().invert(), hips = pose.position(0);
    const moment = new Vector3().subVectors(point, hips).cross(impulse).applyQuaternion(back);
    // Segment centres give diagonal inertia about the supported hips.
    const inertia = new Vector3();
    pose.skeleton.bones.forEach((bone, i) => {
      let parent = i;
      while (parent > 0 && parent !== INDEX.spine) parent = pose.skeleton.bones[parent].parent;
      if (parent !== INDEX.spine) return;
      const add = (mass: number, at: Readonly<Vector3>) => {
        const r = pose.point(i, at, new Vector3()).sub(hips).applyQuaternion(back);
        inertia.x += mass * (r.y * r.y + r.z * r.z);
        inertia.y += mass * (r.x * r.x + r.z * r.z);
        inertia.z += mass * (r.x * r.x + r.y * r.y);
      };
      add(bone.mass, bone.com);
      const load = pose.load(i);
      add(load.mass, load.at);
    });
    if (Math.min(inertia.x, inertia.y, inertia.z) <= 0) throw new Error('applyImpulse: torso needs mass about each axis');
    this.velocity.add(moment.divide(inertia));
    this.active = true;
  }

  step(dt: number): void {
    if (!this.active) return;
    this.prev2.copy(this.prev);
    this.prev.copy(this.rotation);
    // Exact underdamped spring (`RECOVERY`). An impulse changes velocity, never pose; repeated pushes add momentum and recover continuously.
    const w = 2 * Math.PI * RECOVERY.hz, decay = RECOVERY.damping * w, damped = Math.sqrt(w * w - decay * decay);
    const e = Math.exp(-decay * dt), c = Math.cos(damped * dt), s = Math.sin(damped * dt) / damped;
    const angle = this.angle.clone();
    this.angle.multiplyScalar(c + decay * s).addScaledVector(this.velocity, s).multiplyScalar(e);
    this.velocity.multiplyScalar(c - decay * s).addScaledVector(angle, -w * w * s).multiplyScalar(e);
    // Spine and chest each take half of the torso's rotation.
    exp(this.angle.x / 2, this.angle.y / 2, this.angle.z / 2, this.rotation);
    // (recovered: the trunk follows its own history alone again)
    if (this.angle.length() < SETTLED && this.velocity.length() < SETTLED) {
      this.active = false;
      this.angle.set(0, 0, 0);
      this.velocity.set(0, 0, 0);
      this.rotation.identity();
      this.prev.identity();
      this.prev2.identity();
    }
  }
}

/** Tuned: the trunk springs back from a push at `hz`, damped at `damping` of critical */
const RECOVERY = { hz: 3, damping: 0.65 };
/** Tuned: a push has settled once the trunk is turned less than this (rad) and turning slower than this (rad/s) */
const SETTLED = 1e-5;
