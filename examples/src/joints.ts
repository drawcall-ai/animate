import { Matrix4, Vector3, type Object3D } from 'three';
import type { HumanoidBone } from '@drawcall/animate';
import type { Person } from './scenario';

/** the points on a person that are not bones: on its head and its feet */
export type Landmark = 'nose' | 'headTop' | 'leftEye' | 'rightEye' | 'leftEar' | 'rightEar' | 'leftHeel' | 'rightHeel' | 'leftBigToe' | 'rightBigToe' | 'leftSmallToe' | 'rightSmallToe';

/** a bone of a person or a landmark on it */
export type JointName = HumanoidBone | Landmark;

/** where a joint is read from: a node of the body's scene graph and the point fixed in its frame */
interface Fixed {
  node: Object3D;
  local: Vector3;
}

/**
 * A person's joints as its scene graph shows them: each bone's node and the landmarks (nose, eyes, ears, heels, toe tips) fixed in
 * their bones' frames, where the person's proportions put them. Made while the scene graph shows the person's pose (before its first
 * update, or right after one): each landmark is read off the pose then, and rides on its node from there, so a blended scene graph
 * (the app's display) shows them blended too.
 */
export class Joints {
  private readonly fixed = new Map<JointName, Fixed>();

  constructor(readonly body: Person) {
    const proportions = body.species.person;
    if (!proportions) throw new Error('joints are read off a person');
    const bones: Readonly<Record<string, Object3D | undefined>> = body.bones;
    body.object.updateWorldMatrix(true, true);
    for (const [name, node] of Object.entries(bones)) if (node) this.fixed.set(name as HumanoidBone, { node, local: new Vector3() });
    const { head, sole } = proportions;
    const mirror = (at: Vector3) => new Vector3(-at.x, at.y, at.z);
    const landmarks: [Landmark, string, Vector3][] = [
      ['nose', 'head', head.nose], ['headTop', 'head', head.top],
      ['leftEye', 'head', head.eye], ['rightEye', 'head', mirror(head.eye)], ['leftEar', 'head', head.ear], ['rightEar', 'head', mirror(head.ear)],
      ['leftHeel', 'leftFoot', sole.heel], ['rightHeel', 'rightFoot', mirror(sole.heel)],
      ['leftBigToe', 'leftToes', sole.bigToe], ['rightBigToe', 'rightToes', mirror(sole.bigToe)],
      ['leftSmallToe', 'leftToes', sole.smallToe], ['rightSmallToe', 'rightToes', mirror(sole.smallToe)],
    ];
    for (const [name, bone, at] of landmarks) {
      const index = body.species.skeleton.bones.findIndex((b) => b.name === bone);
      // (a skeleton without toes: the tips ride on the foot)
      const node = bones[bone] ?? bones[bone.replace('Toes', 'Foot')];
      if (index < 0 || !node) throw new Error(`the person has no ${bone}`);
      const world = body.pose.point(index, at, new Vector3());
      this.fixed.set(name, { node, local: world.applyMatrix4(new Matrix4().copy(node.matrixWorld).invert()) });
    }
  }

  /** where joint `name` is (world), as the nodes' world matrices stand */
  at(name: JointName, out = new Vector3()): Vector3 {
    const fixed = this.fixed.get(name);
    if (!fixed) throw new Error(`the person has no ${name}`);
    return out.copy(fixed.local).applyMatrix4(fixed.node.matrixWorld);
  }

  /** the eyes' midpoint (world) */
  eyes(out = new Vector3()): Vector3 {
    return this.at('leftEye', out).add(this.at('rightEye', _other)).multiplyScalar(0.5);
  }
}

const _other = new Vector3();
