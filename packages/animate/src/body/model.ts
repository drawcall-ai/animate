import { Group, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import type { SkeletonBone } from '@drawcall/rig';
import type { AnySpecies } from '../species/define';
import type { ReadonlyPose } from '../kernel/pose';

/**
 * The scene-graph side of a body: `object`, a group on the floor turned by the body's facing alone, and `bones`, by name. Given a
 * `model` (a container rigged with @drawcall/rig), the bones are the very bones bound to its meshes, found by name; else they are
 * library objects in a tree like the skeleton's, each standing at rest as a bone rig builds does (turned as the container is). Once an
 * update, `write` poses them: each moving bone's rotation through its rest turns (`turnₚ · q · turn⁻¹`, read once relative to the
 * body), the root's position relative to `object`, which follows the body. Bones the species does not move follow their parents.
 */
export class Binding<Name extends string = string> {
  readonly object = new Group();
  /** every bone the skeleton as written names, by name */
  readonly bones: Readonly<Record<Name, Object3D>>;
  /**
   * each moving bone's node, its rest turn (the skeleton's straight limbs onto the node's rest) and the nodes it hangs from; none for a
   * bone the skeleton as written lacks (a person's toes, placed at the ball of a foot without them)
   */
  private readonly moving: readonly (Moving | null)[];
  /** where the root bone's position is written from: `object`'s frame into the root node's parent's */
  private readonly rootFrame = new Matrix4();

  constructor(readonly species: Pick<AnySpecies, 'skeleton' | 'turns'> & { readonly bones: readonly SkeletonBone<Name>[] }, model?: Object3D) {
    const { skeleton } = species;
    if (model) this.object.add(model);
    const found = model ? Object.fromEntries(species.bones.flatMap((bone) => {
      const node = model.getObjectByName(bone.name);
      return node ? [[bone.name, node]] : [];
    })) : this.bare();
    const byName: Readonly<Record<string, Object3D | undefined>> = found;
    const missing = species.bones.filter((bone) => !byName[bone.name]).map((bone) => bone.name);
    if (!named(found, species.bones)) throw new Error(`the model has no bone named ${missing.join(', ')} (rig it with this skeleton: skin(model, skeleton))`);
    this.bones = found;
    this.object.updateMatrixWorld(true);
    const inverse = new Matrix4().copy(this.object.matrixWorld).invert();
    const rest = (node: Object3D) => new Matrix4().multiplyMatrices(inverse, node.matrixWorld);
    const nodes = skeleton.bones.map((bone) => byName[bone.name]);
    this.moving = skeleton.bones.map((bone, i): Moving | null => {
      const node = nodes[i];
      if (!node) return null;
      // (the nodes between this one and the moving bone it hangs from — or the body's object — kept as they stand at rest)
      let anchor = -1;
      const between = new Quaternion();
      for (let at = node.parent; at && at !== this.object; at = at.parent) {
        const k = nodes.indexOf(at);
        if (k >= i) throw new Error(`bone "${bone.name}" hangs in the model from "${skeleton.bones[k].name}", which the skeleton has after it`);
        if (k >= 0) { anchor = k; break; }
        between.premultiply(at.quaternion);
      }
      const turned = new Quaternion(), scale = new Vector3();
      rest(node).decompose(new Vector3(), turned, scale);
      return { node, anchor, between, scale: scale.x, turn: (species.turns.get(bone.name) ?? IDENTITY).clone().invert().multiply(turned) };
    });
    const parent = this.root.node.parent;
    if (parent && parent !== this.object) this.rootFrame.copy(rest(parent)).invert();
  }

  private get root(): Moving {
    const root = this.moving[0];
    if (!root) throw new Error(`the skeleton has no root bone "${this.species.skeleton.bones[0].name}"`);
    return root;
  }

  /** each moving bone's rest frame relative to the body as the scene shows it: its rotation is the pose's times this (`turn⁻¹ · rest`) */
  restOf(bone: number): Readonly<Quaternion> {
    return this.moving[bone]?.turn ?? IDENTITY;
  }

  /** a moving bone's scale in the scene (its container's, if that is scaled) */
  scaleOf(bone: number): number {
    return this.moving[bone]?.scale ?? 1;
  }

  /** `object` placed where the body stands facing, and each moving bone posed from `pose` */
  write(pose: ReadonlyPose): void {
    const root = pose.position(0), object = this.object;
    object.position.set(root.x, 0, root.z);
    object.quaternion.setFromAxisAngle(UP, pose.facing);
    const back = _back.copy(object.quaternion).invert();
    this.moving.forEach((moving, i) => {
      if (!moving) return;
      // (its rotation in the body's frame, then in its parent node's: the bone it hangs from comes before it, worked out already)
      const turned = this.turned(i).copy(back).multiply(pose.rotation(i)).multiply(moving.turn), parent = _parent.copy(moving.between);
      if (moving.anchor >= 0) parent.premultiply(this.turned(moving.anchor));
      moving.node.quaternion.copy(parent.invert().multiply(turned));
    });
    const at = _at.copy(root).sub(object.position).applyQuaternion(back);
    this.root.node.position.copy(at.applyMatrix4(this.rootFrame));
  }

  /** moving bone `i`'s rotation in the body's frame, as `write` last worked it out */
  private turned(i: number): Quaternion {
    return (this.cache[i] ??= new Quaternion());
  }

  private readonly cache: Quaternion[] = [];

  /** library bones like the skeleton's, standing at rest under `object`, by name */
  private bare(): Record<string, Object3D> {
    const at = new Map(this.species.bones.map((bone) => [bone.name, new Vector3(...bone.position)]));
    const bones: Record<string, Object3D> = Object.fromEntries(this.species.bones.map((bone) => [bone.name, Object.assign(new Object3D(), { name: bone.name })]));
    for (const bone of this.species.bones) {
      const node = bones[bone.name];
      node.position.fromArray(bone.position);
      if (bone.parent === undefined) {
        this.object.add(node);
        continue;
      }
      const parent = at.get(bone.parent);
      if (!parent) throw new Error(`bone "${bone.name}" has no parent "${bone.parent}"`);
      node.position.sub(parent);
      bones[bone.parent].add(node);
    }
    return bones;
  }
}

/** whether `bones` has every bone `written` names */
function named<Name extends string>(bones: Record<string, Object3D>, written: readonly SkeletonBone<Name>[]): bones is Record<Name, Object3D> {
  return written.every((bone) => bone.name in bones);
}

interface Moving {
  node: Object3D;
  /** the moving bone its node hangs from (-1: the body's object), through the nodes `between` at rest */
  anchor: number;
  between: Quaternion;
  /** its scale in the body's frame (its container's) */
  scale: number;
  /** its rest turn undone, then its node's rest rotation in the body's frame: what the pose's rotation is multiplied by */
  turn: Quaternion;
}

const UP = new Vector3(0, 1, 0), IDENTITY = new Quaternion();
const _back = new Quaternion(), _parent = new Quaternion(), _at = new Vector3();
