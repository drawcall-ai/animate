import { Vector3 } from 'three';
import type { CharacterModel } from '@pmndrs/viverse';

/** what is read of a body: its posed model */
export type Posed = { model: CharacterModel };

const _v = new Vector3();

/** the world position of a bone (VRM name) or landmark (nose, leftEye, leftHeel, …) of the body's model */
export function jointOf(h: Posed, name: string, out = new Vector3()): Vector3 {
  const node = h.model.scene.getObjectByName(name);
  if (!node) throw new Error(`the character model has no ${name}`);
  return node.getWorldPosition(out);
}

/** the eye midpoint (where a head target goes) */
export const eyesOf = (h: Posed, out = new Vector3()) => jointOf(h, 'leftEye', out).add(jointOf(h, 'rightEye', _v)).multiplyScalar(0.5);
