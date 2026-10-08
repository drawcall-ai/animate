import { AnimationMixer, Bone, Group } from 'three';
import type { CharacterModel } from '@pmndrs/viverse';
import { CHILD_BONES, PARENT, perBone } from './pose/bones';
import { DEFAULT_HEIGHT, proportionsFor } from './proportions';

/**
 * A character model of bare bones: the default body for a standing height (m), built the
 * way viverse's `loadCharacterModel` loads a glTF — VRM-named bones in the T-pose, facing
 * +Z, and the hidden `rest_` copy — without a mesh: add one, or draw it another way.
 */
export function createSkeletonModel(height = DEFAULT_HEIGHT): CharacterModel {
  const rest = proportionsFor(height);
  const bones = perBone((name) => Object.assign(new Bone(), { name }));
  bones.hips.position.copy(rest.hips);
  for (const b of CHILD_BONES) {
    bones[b].position.copy(rest.offsets[b]);
    bones[PARENT[b]].add(bones[b]);
  }
  const scene = new Group();
  scene.add(bones.hips);
  const restPose = scene.clone();
  restPose.visible = false;
  restPose.traverse((o) => (o.name = `rest_${o.name}`));
  scene.add(restPose);
  return { scene, mixer: new AnimationMixer(scene), currentAnimations: new Map(), height };
}
