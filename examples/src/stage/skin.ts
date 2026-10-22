import { Bone, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import { Pose, type ReadonlyPose, type Skeleton } from '@drawcall/animate';

/** a bone of the model the body's skeleton drives */
interface Driven {
  node: Bone;
  /** the body's bone */
  bone: number;
  /** the node's world rotation at rest, turned so its segment (to its first driven child) lies along the body's at rest */
  rest: Quaternion;
}

/**
 * A rigged model posed by a body: every bone named after one of the skeleton's is placed where the body's is and turned as it is.
 * The model's own anatomy need not match the skeleton's: each segment is turned at rest onto the skeleton's (a hoof set a little
 * further forward, a neck a little steeper) and stretched to its length, so the mesh follows the body's joints exactly. Its other
 * bones (the ends of chains) ride on their parents.
 */
export class Skin {
  private readonly driven: Driven[] = [];

  constructor(readonly scene: Object3D, skeleton: Skeleton) {
    // (its bounds are its rest pose's, at the origin: a body that has moved away would be culled)
    scene.traverse((o) => (o.frustumCulled = false));
    scene.updateMatrixWorld(true);
    const rest = new Pose(skeleton);
    rest.forward();
    const nodes = skeleton.bones.map((b) => {
      const node = scene.getObjectByName(b.name);
      return node instanceof Bone ? node : null;
    });
    if (!nodes[0]) throw new Error(`the skin has no ${skeleton.bones[0].name}`);
    skeleton.bones.forEach((_, bone) => {
      const node = nodes[bone];
      if (!node) return;
      const at = node.getWorldPosition(new Vector3()), q = node.getWorldQuaternion(new Quaternion());
      // (its continuation: the skin's first child that is one of the skeleton's bones, along which the skin weights its segment)
      const child = nodes.findIndex((n) => n && n.parent === node && n === node.children.find((c) => nodes.includes(c as Bone)));
      const turn = new Quaternion();
      if (child >= 0) {
        const mesh = nodes[child]!.getWorldPosition(new Vector3()).sub(at).normalize();
        const body = rest.position(child).clone().sub(rest.position(bone)).normalize();
        turn.setFromUnitVectors(mesh, body);
      }
      this.driven.push({ node, bone, rest: turn.multiply(q) });
    });
  }

  /** poses the model as `pose` stands (world) */
  pose(pose: ReadonlyPose) {
    for (const { node, bone, rest } of this.driven) {
      _world.compose(pose.position(bone), _q.copy(pose.rotation(bone)).multiply(rest), ONE);
      node.parent!.updateWorldMatrix(true, false);
      _local.copy(node.parent!.matrixWorld).invert().multiply(_world).decompose(node.position, node.quaternion, _scale);
      node.updateMatrixWorld(true);
    }
  }
}

const ONE = new Vector3(1, 1, 1);
const _world = new Matrix4(), _local = new Matrix4(), _q = new Quaternion(), _scale = new Vector3();
