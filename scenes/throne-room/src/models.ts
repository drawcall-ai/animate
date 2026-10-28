import type { Object3D } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { RigLoader, type SkeletonBone } from '@drawcall/rig';
import type { Dress } from './cast';
import { SOLDIER } from './skeletons/soldier';
import { LUKE } from './skeletons/luke';
import { HAN } from './skeletons/han';
import { CHEWBACCA } from './skeletons/chewbacca';
import { LEIA } from './skeletons/leia';
import { THREEPIO } from './skeletons/threepio';
import { MEDAL_BEARER } from './skeletons/bearer';
import { DODONNA } from './skeletons/dodonna';
import { TROOPER } from './skeletons/trooper';
import { ARTOO } from './droids/artoo';

/** Each skeleton with the model measured for it (under public/). A body whose skeleton is listed wears that model. */
export const MODELS: readonly (readonly [skeleton: readonly SkeletonBone[], url: string])[] = [
  [SOLDIER, '/models/soldier.glb'],
  [LUKE, '/models/luke.glb'],
  [HAN, '/models/han.glb'],
  [CHEWBACCA, '/models/chewbacca.glb'],
  [LEIA, '/models/leia.glb'],
  [THREEPIO, '/models/threepio.glb'],
  [MEDAL_BEARER, '/models/bearer.glb'],
  [DODONNA, '/models/dodonna.glb'],
  [TROOPER, '/models/trooper.glb'],
  [ARTOO, '/models/artoo.glb'],
];

/** loads and rigs every listed model once (cached weights for unchanged meshes and skeletons), and dresses bodies in copies */
export async function loadWardrobe(): Promise<Dress> {
  const loader = new RigLoader();
  const rigged = new Map<readonly SkeletonBone[], Object3D>();
  await Promise.all(MODELS.map(async ([skeleton, url]) => {
    const { scene } = await loader.loadAsync({ url, skeleton, source: { url, dependencyUrls: [] } });
    // (a skinned mesh's bounds are its rest pose's, at the origin: a body that has walked away would be culled)
    scene.traverse((node) => {
      node.frustumCulled = false;
      node.castShadow = true;
    });
    rigged.set(skeleton, scene);
  }));
  return (skeleton) => {
    const model = rigged.get(skeleton);
    return model && clone(model);
  };
}
