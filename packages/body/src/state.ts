import { Quaternion, Vector3 } from 'three';
import { exp, log } from './rotation.js';
import { dof, type Skeleton } from './skeleton.js';
import type { BonePoint, Load, Point } from './types.js';

/**
 * A body's configuration and motion. Its generalized coordinates are the root's position and
 * each bone's rotation in its parent's frame (the root's in the world's); its velocities the
 * root's linear velocity and each bone's angular velocity in its parent's frame. Everything
 * else (world transforms and velocities, the centre of mass) is derived from them by
 * `forward` (positions only) and `derive` (with velocities).
 */
export class BodyState {
  /** the root's position (world) */
  readonly position = new Vector3();
  /** each bone's rotation in its parent's frame (the root's in the world's) */
  readonly local: Quaternion[];
  /** the root's linear velocity (m/s, world) */
  readonly velocity = new Vector3();
  /** each bone's angular velocity in its parent's frame (rad/s) */
  readonly rates: Vector3[];
  /** the loads carried, as merged in the last solve */
  loads: readonly Load[] = [];

  /** each bone origin's world position (derived) */
  readonly positions: Vector3[];
  /** each bone's world rotation (derived) */
  readonly rotations: Quaternion[];
  /** each bone origin's world linear velocity (derived) */
  readonly velocities: Vector3[];
  /** each bone's world angular velocity (derived) */
  readonly spins: Vector3[];
  /** the mass with the loads (kg, derived) */
  mass = 0;
  /** the centre of mass with the loads (derived) */
  readonly com = new Vector3();
  /** (derived) */
  readonly comVelocity = new Vector3();

  constructor(readonly skeleton: Skeleton) {
    const n = skeleton.bones.length;
    const vectors = () => Array.from({ length: n }, () => new Vector3());
    const quaternions = () => Array.from({ length: n }, () => new Quaternion());
    this.local = quaternions();
    this.rates = vectors();
    this.positions = vectors();
    this.rotations = quaternions();
    this.velocities = vectors();
    this.spins = vectors();
    this.position.copy(skeleton.bones[0].offset);
    this.derive();
  }

  /** derives the world transforms and the centre of mass from the coordinates */
  forward(): void {
    const { bones } = this.skeleton;
    this.positions[0].copy(this.position);
    this.rotations[0].copy(this.local[0]);
    for (let i = 1; i < bones.length; i++) {
      const p = bones[i].parent;
      this.positions[i].copy(bones[i].offset).applyQuaternion(this.rotations[p]).add(this.positions[p]);
      this.rotations[i].multiplyQuaternions(this.rotations[p], this.local[i]);
    }
    this.mass = 0;
    this.com.set(0, 0, 0);
    this.masses((p, m) => {
      this.mass += m;
      this.com.addScaledVector(this.bonePoint(p, _p), m);
    });
    if (this.mass > 0) this.com.divideScalar(this.mass);
  }

  /** derives everything from the coordinates and velocities */
  derive(): void {
    this.forward();
    const { bones } = this.skeleton;
    this.velocities[0].copy(this.velocity);
    this.spins[0].copy(this.rates[0]);
    for (let i = 1; i < bones.length; i++) {
      const p = bones[i].parent;
      this.spins[i].copy(this.rates[i]).applyQuaternion(this.rotations[p]).add(this.spins[p]);
      _r.subVectors(this.positions[i], this.positions[p]);
      this.velocities[i].crossVectors(this.spins[p], _r).add(this.velocities[p]);
    }
    this.comVelocity.set(0, 0, 0);
    this.masses((p, m) => this.comVelocity.addScaledVector(this.pointVelocity(p, _p), m));
    if (this.mass > 0) this.comVelocity.divideScalar(this.mass);
  }

  /** visits each mass: every segment's at its centre, every load's where it is held */
  masses(visit: (point: BonePoint, mass: number) => void): void {
    this.skeleton.bones.forEach((b, i) => visit({ bone: i, at: b.com }, b.mass));
    for (const l of this.loads) visit(l, l.mass);
  }

  /** `point`'s world position */
  point(point: Point, out: Vector3): Vector3 {
    return point === 'com' ? out.copy(this.com) : this.bonePoint(point, out);
  }

  /** `point`'s world velocity */
  pointVelocity(point: Point, out: Vector3): Vector3 {
    if (point === 'com') return out.copy(this.comVelocity);
    _r.copy(point.at).applyQuaternion(this.rotations[point.bone]);
    return out.crossVectors(this.spins[point.bone], _r).add(this.velocities[point.bone]);
  }

  /** copies the coordinates, velocities and loads of `from`, and derives the rest */
  copy(from: Readonly<BodyState>): this {
    this.velocity.copy(from.velocity);
    this.rates.forEach((v, i) => v.copy(from.rates[i]));
    this.copyPose(from);
    this.derive();
    return this;
  }

  /** copies the coordinates and loads of `from`, and derives the positions (not the velocities) */
  copyPose(from: Readonly<BodyState>): this {
    this.position.copy(from.position);
    this.local.forEach((q, i) => q.copy(from.local[i]));
    this.loads = from.loads;
    this.forward();
    return this;
  }

  /**
   * moves the coordinates by the generalized displacement `delta` · `scale` (rotations as
   * rotation vectors in the parent's frame, applied on the left) and derives the positions
   */
  move(delta: Float64Array, scale: number): void {
    this.position.x += delta[0] * scale;
    this.position.y += delta[1] * scale;
    this.position.z += delta[2] * scale;
    this.local.forEach((q, i) => {
      const d = dof(i);
      q.premultiply(exp(delta[d] * scale, delta[d + 1] * scale, delta[d + 2] * scale, _q)).normalize();
    });
    this.forward();
  }

  /** the generalized displacement from `from`'s coordinates to these (what `move` undoes) */
  since(from: Readonly<BodyState>, out: Float64Array): Float64Array {
    out[0] = this.position.x - from.position.x;
    out[1] = this.position.y - from.position.y;
    out[2] = this.position.z - from.position.z;
    this.local.forEach((q, i) => {
      log(_q.copy(from.local[i]).invert().premultiply(q), _r);
      const d = dof(i);
      out[d] = _r.x;
      out[d + 1] = _r.y;
      out[d + 2] = _r.z;
    });
    return out;
  }

  /** the generalized velocity */
  readRates(out: Float64Array): Float64Array {
    out[0] = this.velocity.x;
    out[1] = this.velocity.y;
    out[2] = this.velocity.z;
    this.rates.forEach((v, i) => {
      const d = dof(i);
      out[d] = v.x;
      out[d + 1] = v.y;
      out[d + 2] = v.z;
    });
    return out;
  }

  /** sets the generalized velocity (and leaves deriving to the caller) */
  writeRates(v: Float64Array): void {
    this.velocity.set(v[0], v[1], v[2]);
    this.rates.forEach((r, i) => {
      const d = dof(i);
      r.set(v[d], v[d + 1], v[d + 2]);
    });
  }

  private bonePoint(point: BonePoint, out: Vector3): Vector3 {
    return out.copy(point.at).applyQuaternion(this.rotations[point.bone]).add(this.positions[point.bone]);
  }
}

const _p = new Vector3();
const _q = new Quaternion();
const _r = new Vector3();
