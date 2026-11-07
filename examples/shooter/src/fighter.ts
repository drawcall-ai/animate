import { humanoid } from '@drawcall/animate';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Mesh, SkinnedMesh, Texture } from 'three';
import { FIGHTER } from '../assets/fighter';

/** One setting for the whole braid; its seven links come from the rig's existing hierarchy. */
export const fighter = {
  ...humanoid(FIGHTER),
  springs: { braid: { stiffness: 60, damping: 0.9 } },
};

export async function loadFighter() {
  const { scene } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('models/fighter.glb');
  const braid = scene.getObjectByName('braid');
  if (!braid) throw new Error('The fighter model has no braid bone');
  // The mesh was bound with the braid up, clear of the torso. Its animation rest pose hangs behind the head.
  braid.rotation.x = -2.2;
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
