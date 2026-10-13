import { Quaternion, Vector3 } from 'three';
import type { Skeleton } from './skeleton';

/**
 * A skeleton's pose: the root's world position and each bone's rotation in its parent's frame
 * (the root's in the world's). The world transforms follow by forward kinematics, recomputed
 * when read after a write. Writes take a weight: 1 sets the value, less blends toward it from
 * what is there (slerp for rotations, lerp for the root's position).
 */
export class Pose {
  private readonly root = new Vector3();
  private readonly locals: Quaternion[];
  private readonly positions: Vector3[];
  private readonly rotations: Quaternion[];
  private stale = true;

  constructor(readonly skeleton: Skeleton) {
    const n = skeleton.bones.length;
    this.locals = Array.from({ length: n }, () => new Quaternion());
    this.positions = Array.from({ length: n }, () => new Vector3());
    this.rotations = Array.from({ length: n }, () => new Quaternion());
    this.root.copy(skeleton.bones[0].offset);
  }

  /** `bone`'s rotation in its parent's frame (the root's in the world's) */
  local(bone: number): Readonly<Quaternion> {
    return this.locals[bone];
  }

  /** `bone`'s origin in the world */
  position(bone: number): Readonly<Vector3> {
    this.forward();
    return this.positions[bone];
  }

  /** `bone`'s rotation in the world */
  rotation(bone: number): Readonly<Quaternion> {
    this.forward();
    return this.rotations[bone];
  }

  /** the world position of `at`, a point in `bone`'s frame */
  point(bone: number, at: Vector3, out: Vector3): Vector3 {
    return out.copy(at).applyQuaternion(this.rotation(bone)).add(this.positions[bone]);
  }

  /** the centre of mass (world) */
  com(out: Vector3): Vector3 {
    out.set(0, 0, 0);
    let mass = 0;
    this.skeleton.bones.forEach((b, i) => {
      if (b.mass === 0) return;
      out.addScaledVector(this.point(i, b.com, _v), b.mass);
      mass += b.mass;
    });
    return mass > 0 ? out.divideScalar(mass) : out.copy(this.position(0));
  }

  /** writes `bone`'s rotation in its parent's frame (the root's in the world's) */
  setLocal(bone: number, q: Readonly<Quaternion>, weight = 1): void {
    checkWeight(weight);
    if (weight === 1) this.locals[bone].copy(q);
    else this.locals[bone].slerp(q, weight);
    this.stale = true;
  }

  /** writes `bone`'s rotation in the world, its parent's as it is */
  setRotation(bone: number, q: Readonly<Quaternion>, weight = 1): void {
    const parent = this.skeleton.bones[bone].parent;
    if (parent < 0) return this.setLocal(bone, q, weight);
    this.setLocal(bone, _q.copy(this.rotation(parent)).invert().multiply(q), weight);
  }

  /** writes the root's world position */
  setRoot(position: Readonly<Vector3>, weight = 1): void {
    checkWeight(weight);
    if (weight === 1) this.root.copy(position);
    else this.root.lerp(position, weight);
    this.stale = true;
  }

  copy(from: Pose): this {
    if (from.skeleton !== this.skeleton) throw new Error('cannot copy a pose of another skeleton');
    this.root.copy(from.root);
    this.locals.forEach((q, i) => q.copy(from.locals[i]));
    this.stale = true;
    return this;
  }

  /** brings the world transforms up to date (forward kinematics) */
  forward(): void {
    if (!this.stale) return;
    this.stale = false;
    const { bones } = this.skeleton;
    this.positions[0].copy(this.root);
    this.rotations[0].copy(this.locals[0]);
    for (let i = 1; i < bones.length; i++) {
      const p = bones[i].parent;
      this.positions[i].copy(bones[i].offset).applyQuaternion(this.rotations[p]).add(this.positions[p]);
      this.rotations[i].multiplyQuaternions(this.rotations[p], this.locals[i]);
    }
  }
}

function checkWeight(weight: number) {
  if (!(weight >= 0 && weight <= 1)) throw new Error(`a weight of ${weight}, not within 0..1`);
}

const _v = new Vector3();
const _q = new Quaternion();
