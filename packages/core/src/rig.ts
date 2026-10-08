import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import type { CharacterModel } from '@pmndrs/viverse';
import { landmarksOf, type Landmark, type Pose } from './pose/pose';
import { derive, type Proportions } from './proportions';
import { BONES, CHILD_BONES, PARENT, createRest, perBone, type BoneName } from './pose/bones';

/**
 * A @pmndrs/viverse character model (glTF or VRM) as the body drives it. viverse retargets
 * VRM-normalized rotations — the pose's own convention — and bones are set exactly as its
 * `fixModelAnimationClip` converts a VRM-normalized clip:
 *
 *   glTF   raw local        = P⁻¹ · q · P · T   (P = rest parent world rotation, T = rest local;
 *                                                the hips premultiplied by R_y(π), position too)
 *   VRM 1  normalized local = q
 *   VRM 0  normalized local = R_y(π) · q · R_y(π)⁻¹   (x, z negated; position too)
 *
 * which leaves glTF and VRM 0 models facing −Z (viverse's forward), so `model.scene` is
 * turned by R_y(π) for them. Every bone is written as `left · q · right`.
 */

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
  name: BoneName;
  node: Object3D;
  left: Quaternion;
  right: Quaternion;
}

/** each bone's node and its rest copy; null for missing toes (optional, placed by estimate) */
type Bones = Record<BoneName, { node: Object3D; rest: Object3D } | null>;

export class Rig {
  /** measured from the model's rest pose */
  readonly proportions: Proportions;
  readonly landmarks: readonly Landmark[];
  /** the driven bones (toes may be missing) */
  private readonly bones: Driven[];
  private readonly hips: Object3D;
  /** the model faces −Z: turned by R_y(π) from the pose */
  private readonly turned: boolean;
  /** the rest hips' scale (glTF): positions in the bones are divided by it (bones below the hips are unscaled) */
  private readonly scale: number;
  private readonly vrm: VRMLike | null;

  constructor(private readonly model: CharacterModel) {
    const bones = bonesOf(model);
    this.vrm = isVRM(model) ? model : null;
    const v0 = this.vrm?.meta.metaVersion === '0';
    this.proportions = measure(model, bones, v0);
    this.hips = need(bones.hips, 'hips').node;
    if (this.vrm) {
      this.bones = driven(bones, () => (v0 ? [TURN.clone(), TURN.clone().invert()] : [new Quaternion(), new Quaternion()]));
      this.turned = v0;
      this.scale = 1;
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
      this.scale = new Matrix4().copy(frame.matrixWorld).invert().multiply(hipsRest.matrixWorld).getMaxScaleOnAxis();
    }
    this.landmarks = landmarksOf(this.proportions);
    this.attach(bones);
  }

  /**
   * Poses the bones as viverse would play the pose as a VRM-normalized clip, with
   * `model.scene` placed at `pose.root` (in world space); a VRM is then updated by `dt`.
   */
  write(pose: Pose, dt: number) {
    const { root, rotations, joints } = pose;
    const scene = this.model.scene;
    scene.position.copy(root.position);
    // (composed aside: each change of an Object3D's quaternion recomputes its Euler rotation)
    _q.copy(root.quaternion);
    scene.quaternion.copy(this.turned ? _q.multiply(TURN) : _q);
    // the clip is root-relative
    _inv.copy(root.quaternion).invert();
    _hips.multiplyQuaternions(_inv, rotations.hips);
    for (const { name, node, left, right } of this.bones) {
      node.quaternion.copy(_q.copy(left).multiply(name === 'hips' ? _hips : rotations[name]).multiply(right));
    }
    const p = this.hips.position.subVectors(joints.hips, root.position).applyQuaternion(_inv).divideScalar(this.scale);
    if (this.turned) p.applyQuaternion(TURN);
    this.vrm?.update(dt);
  }

  /**
   * Makes every joint a node named after it: a node per landmark on its bone (a bone's frame
   * is `right⁻¹` of its normalized frame; without toes, the toe tips ride on the foot) and,
   * where the bones go by other names (a VRM's), one at each bone's origin.
   */
  private attach(bones: Bones) {
    const scene = this.model.scene;
    for (const { name, node } of this.bones) {
      if (node.name !== name && !scene.getObjectByName(name)) node.add(Object.assign(new Object3D(), { name }));
    }
    for (const { name, bone, at } of this.landmarks) {
      if (scene.getObjectByName(name)) throw new Error(`character model already has a node named ${name}`);
      const on = bones[bone] ? bone : PARENT[bone];
      const local = on === bone ? at.clone() : at.clone().add(this.proportions.offsets[bone]);
      const { node, right } = need(this.bones.find((b) => b.name === on), on);
      const mark = new Object3D();
      mark.name = name;
      mark.position.copy(local.applyQuaternion(right.clone().invert()).divideScalar(this.scale));
      node.add(mark);
    }
  }
}

const _q = new Quaternion();
const _inv = new Quaternion();
const _hips = new Quaternion();

function driven(bones: Bones, frames: (name: BoneName, rest: Object3D) => [left: Quaternion, right: Quaternion]): Driven[] {
  return BONES.flatMap((name) => {
    const b = bones[name];
    if (!b) return [];
    const [left, right] = frames(name, b.rest);
    return [{ name, node: b.node, left, right }];
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
