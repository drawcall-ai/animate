import { Quaternion, Vector3 } from 'three';
import type { Skeleton } from './skeleton';

/** A pose to read: by bone index, the transforms of `Pose`. */
export type ReadonlyPose = Readonly<Pick<Pose, 'skeleton' | 'facing' | 'local' | 'position' | 'rotation' | 'point' | 'com' | 'load'>>;

/** Root world position and parent-relative bone rotations (the root rotation is world-relative), with lazy forward kinematics. Weighted writes
 * blend from the current pose, so repeated blends depend on the sub-step.
 */
export class Pose {
  private readonly root = new Vector3();
  private readonly locals: Quaternion[];
  private readonly positions: Vector3[];
  private readonly rotations: Quaternion[];
  /** what each bone carries besides its segment: a mass (kg) at a point in its frame */
  private readonly loads: { mass: number; at: Vector3 }[];
  private stale = 0;
  /** the way the body faces (rad about +Y; 0 faces +Z): its stance's, which the root's own turn sways about */
  facing = 0;

  constructor(readonly skeleton: Skeleton) {
    const n = skeleton.bones.length;
    this.locals = Array.from({ length: n }, () => new Quaternion());
    this.positions = Array.from({ length: n }, () => new Vector3());
    this.rotations = Array.from({ length: n }, () => new Quaternion());
    this.loads = Array.from({ length: n }, () => ({ mass: 0, at: new Vector3() }));
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

  /** the centre of mass (world): the segments' and what the bones carry (`setLoad`) */
  com(out: Vector3): Vector3 {
    out.set(0, 0, 0);
    let mass = 0;
    this.skeleton.bones.forEach((b, i) => {
      if (b.mass > 0) {
        out.addScaledVector(this.point(i, b.com, _v), b.mass);
        mass += b.mass;
      }
      const load = this.loads[i];
      if (load.mass === 0) return;
      out.addScaledVector(this.point(i, load.at, _v), load.mass);
      mass += load.mass;
    });
    return mass > 0 ? out.divideScalar(mass) : out.copy(this.position(0));
  }

  /** what `bone` carries besides its segment (see `setLoad`) */
  load(bone: number): Readonly<{ mass: number; at: Readonly<Vector3> }> {
    return this.loads[bone];
  }

  /** what `bone` carries besides its segment: `mass` (kg; 0: nothing) with its centre at `at` (in the bone's frame); it goes with the pose (copies carry it) */
  setLoad(bone: number, mass: number, at: Readonly<Vector3>): void {
    if (!(mass >= 0 && Number.isFinite(mass))) throw new Error(`a load of ${mass} kg`);
    this.loads[bone].mass = mass;
    this.loads[bone].at.copy(at);
  }

  /** writes `bone`'s rotation in its parent's frame (the root's in the world's) */
  setLocal(bone: number, q: Readonly<Quaternion>, weight = 1): void {
    checkWeight(weight);
    if (weight === 1) this.locals[bone].copy(q);
    else this.locals[bone].slerp(q, weight);
    this.stale = Math.min(this.stale, bone);
  }

  setRoot(position: Readonly<Vector3>, weight = 1): void {
    checkWeight(weight);
    if (weight === 1) this.root.copy(position);
    else this.root.lerp(position, weight);
    this.stale = 0;
  }

  copy(from: ReadonlyPose): this {
    if (from.skeleton !== this.skeleton) throw new Error('cannot copy a pose of another skeleton');
    this.root.copy(from.position(0));
    this.facing = from.facing;
    this.locals.forEach((q, i) => q.copy(from.local(i)));
    this.loads.forEach((_, i) => this.setLoad(i, from.load(i).mass, from.load(i).at));
    this.stale = 0;
    return this;
  }

  /** brings the world transforms up to date (forward kinematics) */
  forward(): void {
    if (this.stale === Infinity) return;
    const { bones } = this.skeleton;
    if (this.stale === 0) {
      this.positions[0].copy(this.root);
      this.rotations[0].copy(this.locals[0]);
    }
    // (parents precede their children: no earlier transform depends on the first changed bone)
    for (let i = Math.max(1, this.stale); i < bones.length; i++) {
      const parent = bones[i].parent;
      this.positions[i].copy(bones[i].offset).applyQuaternion(this.rotations[parent]).add(this.positions[parent]);
      this.rotations[i].multiplyQuaternions(this.rotations[parent], this.locals[i]);
    }
    this.stale = Infinity;
  }
}

function checkWeight(weight: number) {
  if (!(weight >= 0 && weight <= 1)) throw new Error(`a weight of ${weight}, not within 0..1`);
}

const _v = new Vector3();
