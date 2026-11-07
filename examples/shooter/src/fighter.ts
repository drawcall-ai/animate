import { humanoid } from '@drawcall/animate';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Mesh, SkinnedMesh, Texture } from 'three';
import { BRAID_HANG, FIGHTER } from '../assets/fighter';

/** One setting for the whole braid; its seven links come from the rig's existing hierarchy. */
export const fighter = {
  ...humanoid(FIGHTER),
  springs: { braid: { stiffness: 60, damping: 0.6, hang: BRAID_HANG } },
};

export async function loadFighter() {
  const { scene } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('models/fighter.glb');
  return {
    scene,
    dispose() {
      scene.traverse(node => {
        if (!(node instanceof Mesh)) return;
        node.geometry.dispose();
        if (node instanceof SkinnedMesh) node.skeleton.dispose();
        for (const material of [node.material].flat()) {
          for (const value of Object.values(material)) if (value instanceof Texture) value.dispose();
          material.dispose();
        }
      });
    },
  };
}
