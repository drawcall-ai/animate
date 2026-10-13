import { Quaternion, Vector3 } from 'three';
import type { CharacterModel } from '@pmndrs/viverse';

/** what is read of a body: its posed model */
type Posed = { model: CharacterModel };

const _v = new Vector3();

/** the world position of a bone (VRM name) or landmark (nose, leftEye, leftHeel, …) of the body's model */
export function jointOf(h: Posed, name: string, out = new Vector3()): Vector3 {
  const node = h.model.scene.getObjectByName(name);
  if (!node) throw new Error(`the character model has no ${name}`);
  return node.getWorldPosition(out);
}

/** the eye midpoint (where a head target goes) */
export const eyesOf = (h: Posed, out = new Vector3()) => jointOf(h, 'leftEye', out).add(jointOf(h, 'rightEye', _v)).multiplyScalar(0.5);

const _rest = new Quaternion();
const _q = new Quaternion();

/**
 * A hand as a hand target gives it: the wrist and the hand bone's world rotation, VRM
 * normalized. The model's bone is turned from that by its rest rotation (in the hidden `rest_`
 * copy, relative to the rest root's parent, as the core's rig writes it).
 */
export function handOf(h: Posed, side: 'left' | 'right', position = new Vector3(), quaternion = new Quaternion()) {
  const scene = h.model.scene;
  const name = `${side}Hand`;
  const node = scene.getObjectByName(name);
  const rest = scene.getObjectByName(`rest_${name}`);
  const frame = scene.getObjectByName('rest_hips')?.parent?.parent;
  if (!node || !rest || !frame) throw new Error(`the character model has no ${name} with its rest copy`);
  frame.getWorldQuaternion(_rest).invert().multiply(rest.getWorldQuaternion(_q));
  return { position: node.getWorldPosition(position), quaternion: node.getWorldQuaternion(quaternion).multiply(_rest.invert()) };
}
