import { Bone, BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments, Mesh, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { skin, type SkeletonBone } from '@drawcall/rig';
import type { Body } from '@drawcall/animate';
import { Joints } from '../joints';
import { OpenPoseSkeleton } from '../openpose';
import { isPerson } from '../simulation';

/** the BODY_25 keypoints of the head: nose, eyes, ears */
const HEAD_KEYPOINTS = [0, 15, 16, 17, 18];

/** The rigged models bodies wear, each loaded and skinned once (by @drawcall/rig, on the skeleton measured on it), by that skeleton. */
export class Wardrobe {
  private constructor(private readonly models: ReadonlyMap<readonly SkeletonBone[], Object3D>) {}

  /** loads each model and skins it on its skeleton (in parallel; the skinning takes a while) */
  static async load(models: readonly (readonly [skeleton: readonly SkeletonBone[], url: string])[]): Promise<Wardrobe> {
    const loader = new GLTFLoader();
    const rigged = await Promise.all(models.map(async ([skeleton, url]) => {
      const model = (await loader.loadAsync(url)).scene;
      await skin(model, skeleton);
      // (a skinned mesh's bounds are its rest pose's, at the origin: a body that has walked away would be culled)
      model.traverse((node) => (node.frustumCulled = false));
      return [skeleton, model] as const;
    }));
    return new Wardrobe(new Map(rigged));
  }

  /** a copy of the model rigged on `skeleton` (its meshes bound to bones of its own), or none: the body goes bare */
  dress = (skeleton: readonly SkeletonBone[]): Object3D | undefined => {
    const model = this.models.get(skeleton);
    return model && clone(model);
  };
}

/** whether `body` wears a rigged model (its bones are a rig's, not a bare body's empties) */
const dressed = (body: Body) => Object.values<Object3D>(body.bones).some((node) => node instanceof Bone);

/**
 * How the app draws a run's bodies besides the models they wear: a bare person as an OpenPose skeleton over its joints, a bare
 * creature as lines from each bone to its parent, and every person's joints for the 2D OpenPose overlay.
 */
export class Figures {
  /** the figures, drawn after the run's scene (they follow its bodies' world matrices) */
  readonly group = new Group();
  /** each person's joints, people in order */
  joints: Joints[] = [];
  private bodies: readonly Body[] = [];

  /** replaces the figures with those of `bodies`, as they stand now (before their first update or right after one) */
  cast(bodies: readonly Body[]) {
    for (const figure of this.group.children) {
      if (figure instanceof OpenPoseSkeleton) figure.dispose();
      if (figure instanceof BoneLines) figure.geometry.dispose();
    }
    this.group.clear();
    this.bodies = bodies;
    this.joints = bodies.filter(isPerson).map((person) => new Joints(person));
    for (const body of bodies) {
      if (dressed(body)) continue;
      const joints = this.joints.find((j) => j.body === body);
      this.group.add(joints ? new OpenPoseSkeleton(joints) : new BoneLines(body));
    }
  }

  /** every body's meshes and figure cast shadows (in lit surroundings) */
  castShadows(on: boolean) {
    for (const root of [this.group, ...this.bodies.map((body) => body.object)]) root.traverse((node) => {
      if (node instanceof Mesh) node.castShadow = on;
    });
  }

  /** the bodies and figures hidden (the 2D overlay draws the people instead) */
  set hidden(hidden: boolean) {
    this.group.visible = !hidden;
    for (const body of this.bodies) body.object.visible = !hidden;
  }

  /** hides the first person's head or shows it again (a camera inside it, as FPS games do): only around a render, never while the run steps */
  hideHead(hide: boolean) {
    const first = this.joints[0];
    if (!first) return;
    const figure = this.group.children.find((f) => f instanceof OpenPoseSkeleton && f.joints === first);
    if (figure instanceof OpenPoseSkeleton) figure.setHidden(hide ? HEAD_KEYPOINTS : []);
    // (a rigged head collapses into its neck, as an FPS body's does: the camera is not inside it)
    else first.body.bones.head.scale.setScalar(hide ? 1e-3 : 1);
  }
}

/** A bare body drawn as a line from each of its bones to its parent's, following them whenever the scene's world matrices update. */
class BoneLines extends LineSegments<BufferGeometry, LineBasicMaterial> {
  private readonly pairs: [Object3D, Object3D][];

  constructor(body: Body) {
    const nodes: Readonly<Record<string, Object3D>> = body.bones;
    const pairs = body.species.bones.flatMap((bone): [Object3D, Object3D][] => (bone.parent ? [[nodes[bone.parent], nodes[bone.name]]] : []));
    const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(pairs.length * 6), 3));
    super(geometry, LINE);
    this.pairs = pairs;
    // (its points are world positions, its bounds wherever the body has gone)
    this.frustumCulled = false;
  }

  override updateMatrixWorld(force?: boolean) {
    const positions = this.geometry.getAttribute('position');
    this.pairs.forEach(([parent, child], i) => {
      positions.setXYZ(2 * i, ..._at.setFromMatrixPosition(parent.matrixWorld).toArray());
      positions.setXYZ(2 * i + 1, ..._at.setFromMatrixPosition(child.matrixWorld).toArray());
    });
    positions.needsUpdate = true;
    super.updateMatrixWorld(force);
  }
}

const LINE = new LineBasicMaterial({ color: 0xdba66b });
const _at = new Vector3();
