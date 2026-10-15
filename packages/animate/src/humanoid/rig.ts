import { yawOf } from '../core/math';
import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import type { CharacterModel } from '@pmndrs/viverse';
import type { ReadonlyPose } from '../core/pose';
import { Skeleton } from '../core/skeleton';
import { BONES, CHILD_BONES, INDEX, PARENT, createRest, perBone, type BoneName } from './bones';
import { landmarksOf, pointsOf, type BonePoint, type PointName } from './landmarks';
import { ranges } from './profile/limits';
import { derive, type Proportions } from './proportions';
import { CHAINS, skeletonOf } from './skeleton';

const UP = new Vector3(0, 1, 0);

/** the part of three-vrm's VRM used: viverse loads .vrm files as VRM instances */
interface VRMLike {
  humanoid: { getNormalizedBoneNode(name: BoneName): Object3D | null };
  meta: { metaVersion: '0' | '1' };
  update(delta: number): void;
}

const isVRM = (model: CharacterModel): model is CharacterModel & VRMLike => 'humanoid' in model;

/** R_y(π) */
const TURN = new Quaternion(0, 1, 0, 0);

interface Driven {
  index: number;
  node: Object3D;
  left: Quaternion;
  right: Quaternion;
}

/** each bone's node and its rest copy; null for missing toes (optional, placed by estimate) */
type Bones = Record<BoneName, { node: Object3D; rest: Object3D } | null>;

/**
 * A @pmndrs/viverse character model (glTF or VRM) as a skeleton, and posed from one. viverse
 * retargets VRM-normalized rotations — the skeleton's own convention — and bones are set exactly
 * as its `fixModelAnimationClip` converts a VRM-normalized clip:
 *
 *   glTF   raw local        = P⁻¹ · q · P · T   (P = rest parent world rotation, T = rest local;
 *                                                the hips premultiplied by R_y(π), position too)
 *   VRM 1  normalized local = q
 *   VRM 0  normalized local = R_y(π) · q · R_y(π)⁻¹   (x, z negated; position too)
 *
 * which leaves glTF and VRM 0 models facing −Z (viverse's forward), so `model.scene` is turned
 * by R_y(π) for them. Every bone is written as `left · q · right`.
 *
 * Every joint becomes a node of the model named after it: the landmarks (nose, headTop, leftEye,
 * leftEar, leftHeel, leftBigToe, leftSmallToe and the right's), added to their bones, and, where
 * the bones go by other names (a VRM's), a node at each bone's origin.
 */
export class Rig {
  /** measured from the model's rest pose */
  readonly proportions: Proportions;
  readonly skeleton: Skeleton;
  readonly points: Record<PointName, BonePoint>;
  /** the driven bones (toes may be missing) */
  private readonly bones: Driven[];
  private readonly hips: Object3D;
  /** the hips node's position: the rest hips' offset from the scene's placement, in the hips' parent's frame */
  private readonly hipsAt: Vector3;
  /** the model faces −Z: turned by R_y(π) from the skeleton */
  private readonly turned: boolean;
  private readonly vrm: VRMLike | null;

  constructor(readonly model: CharacterModel) {
    const bones = bonesOf(model);
    this.vrm = isVRM(model) ? model : null;
    const v0 = this.vrm?.meta.metaVersion === '0';
    this.proportions = measure(model, bones, v0);
    this.skeleton = new Skeleton(skeletonOf(this.proportions), { limits: ranges(), chains: CHAINS });
    this.points = pointsOf(this.proportions);
    this.hips = need(bones.hips, 'hips').node;
    // the rest hips' scale (glTF): positions in the bones are divided by it (bones below the hips are unscaled)
    let scale = 1;
    if (this.vrm) {
      this.bones = driven(bones, () => (v0 ? [TURN.clone(), TURN.clone().invert()] : [new Quaternion(), new Quaternion()]));
      this.turned = v0;
    } else {
      // viverse measures P with the rest root (the hips' parent) detached: relative to its parent
      const hipsRest = need(bones.hips, 'hips').rest;
      const frame = need(hipsRest.parent?.parent, 'rest root parent');
      frame.updateWorldMatrix(true, true);
      const inv = frame.getWorldQuaternion(new Quaternion()).invert();
      this.bones = driven(bones, (name, rest) => {
        const P = inv.clone().multiply(need(rest.parent, `rest_${name} parent`).getWorldQuaternion(new Quaternion()));
        const left = P.clone().invert();
        if (name === 'hips') left.premultiply(TURN);
        return [left, P.multiply(rest.quaternion)];
      });
      this.turned = true;
      scale = new Matrix4().copy(frame.matrixWorld).invert().multiply(hipsRest.matrixWorld).getMaxScaleOnAxis();
    }
    this.hipsAt = this.proportions.hips.clone().divideScalar(scale);
    if (this.turned) this.hipsAt.applyQuaternion(TURN);
    this.attach(bones, scale);
  }

  /**
   * Poses the bones as viverse would play the pose as a VRM-normalized clip, root-relative: with
   * `model.scene` placed (in world space) where the T-pose would stand with its hips there,
   * turned to their facing. A VRM is then updated by `dt`.
   */
  write(pose: ReadonlyPose, dt: number) {
    if (pose.skeleton !== this.skeleton) throw new Error("a pose of another skeleton than the rig's");
    const hips = pose.local(0);
    const root = _root.setFromAxisAngle(UP, yawOf(hips));
    const scene = this.model.scene;
    scene.position.copy(this.proportions.hips).applyQuaternion(root).negate().add(pose.position(0));
    // (composed aside: each change of an Object3D's quaternion recomputes its Euler rotation)
    _q.copy(root);
    scene.quaternion.copy(this.turned ? _q.multiply(TURN) : _q);
    // the clip is root-relative
    _hips.copy(root).invert().multiply(hips);
    for (const { index, node, left, right } of this.bones) node.quaternion.copy(_q.copy(left).multiply(index === 0 ? _hips : pose.local(index)).multiply(right));
    this.hips.position.copy(this.hipsAt);
    this.vrm?.update(dt);
  }

  /**
   * Makes every joint a node named after it: a node per landmark on its bone (a bone's frame is
   * `right⁻¹` of its normalized frame; without toes, the toe tips ride on the foot) and, where the
   * bones go by other names (a VRM's), one at each bone's origin.
   */
  private attach(bones: Bones, scale: number) {
    const scene = this.model.scene;
    for (const { index, node } of this.bones) {
      const name = BONES[index];
      if (node.name !== name && !scene.getObjectByName(name)) node.add(Object.assign(new Object3D(), { name }));
    }
    for (const [name, { bone, at }] of Object.entries(landmarksOf(this.proportions))) {
      if (scene.getObjectByName(name)) throw new Error(`character model already has a node named ${name}`);
      const on = bones[bone] ? bone : PARENT[bone];
      const local = on === bone ? at.clone() : at.clone().add(this.proportions.offsets[bone]);
      const { node, right } = need(
        this.bones.find((b) => b.index === INDEX[on]),
        on,
      );
      const mark = new Object3D();
      mark.name = name;
      mark.position.copy(local.applyQuaternion(right.clone().invert()).divideScalar(scale));
      node.add(mark);
    }
  }
}

const _q = new Quaternion();
const _root = new Quaternion();
const _hips = new Quaternion();

function driven(bones: Bones, frames: (name: BoneName, rest: Object3D) => [left: Quaternion, right: Quaternion]): Driven[] {
  return BONES.flatMap((name, index) => {
    const b = bones[name];
    if (!b) return [];
    const [left, right] = frames(name, b.rest);
    return [{ index, node: b.node, left, right }];
  });
}

function bonesOf(model: CharacterModel): Bones {
  return perBone((b) => {
    // the normalized node of a VRM
    const node = (isVRM(model) ? model.humanoid.getNormalizedBoneNode(b) : model.scene.getObjectByName(b)) ?? null;
    if (!node && b !== 'leftToes' && b !== 'rightToes') throw new Error(`character model has no ${b}`);
    return node && { node, rest: restOf(model, node) };
  });
}

/** `node`'s copy in the rest pose, which viverse's `loadCharacterModel` keeps hidden in the scene */
function restOf(model: CharacterModel, node: Object3D): Object3D {
  const rest = model.scene.getObjectByName(`rest_${node.name}`);
  if (!rest) throw new Error(`character model has no rest_${node.name} (load it with viverse's loadCharacterModel)`);
  return rest;
}

function need<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`character model has no ${what}`);
  return v;
}

/** The model's proportions, measured from its rest pose (a VRM 0 faces −Z). */
function measure(model: CharacterModel, bones: Bones, v0: boolean): Proportions {
  const at = perBone((b) => {
    const rest = bones[b]?.rest;
    if (!rest) return null;
    const p = model.scene.worldToLocal(rest.getWorldPosition(new Vector3()));
    return v0 ? p.applyQuaternion(TURN) : p;
  });
  const rest = createRest();
  rest.hips.copy(need(at.hips, 'hips'));
  for (const b of CHILD_BONES) {
    const p = at[b];
    if (p) rest.offsets[b].subVectors(p, need(at[PARENT[b]], PARENT[b]));
  }
  return derive(rest, model.height);
}
