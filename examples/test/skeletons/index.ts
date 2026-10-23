import { AnimationMixer, Bone, Group, Vector3 } from 'three';
import type { CharacterModel } from '@pmndrs/viverse';
import soldier from './soldier.json';
import outlier from './outlier.json';

/** where each joint stands in the T-pose (world, facing +Z, its left +X), and its parent's name */
export type Joints = Record<string, { parent: string | null; position: [number, number, number] }>;

/** A character model of bare bones from its joints, loaded as viverse loads a glTF (the hidden `rest_` copy; `height` its mesh's, floor to crown). */
export function skeletonModel(joints: Joints, height: number): CharacterModel {
  const bones = new Map(Object.keys(joints).map((name) => [name, Object.assign(new Bone(), { name })]));
  const scene = new Group();
  for (const [name, { parent, position }] of Object.entries(joints)) {
    const bone = bones.get(name)!, at = new Vector3(...position);
    if (parent) {
      bone.position.copy(at.sub(new Vector3(...joints[parent].position)));
      bones.get(parent)!.add(bone);
    } else {
      bone.position.copy(at);
      scene.add(bone);
    }
  }
  const rest = scene.clone();
  rest.visible = false;
  rest.traverse((o) => (o.name = `rest_${o.name}`));
  scene.add(rest);
  return { scene, mixer: new AnimationMixer(scene), currentAnimations: new Map(), height };
}

/**
 * Humanoid skeletons unlike the default body, each with its standing height: the soldier the examples wear (rigged off a generated
 * model: arms short for its 1.8 m, 0.46 m against the default's 0.60 m) and an outlier (the default's at 1.75 m with legs 0.7×,
 * trunk 1.3× and arms 1.3× as long).
 */
export const SKELETONS = { soldier: { joints: soldier as unknown as Joints, height: 1.8 }, outlier: { joints: outlier as unknown as Joints, height: 1.75 } };
