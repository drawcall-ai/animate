import { Quaternion, Vector3, type Object3D } from 'three';
import type { Placement } from './goal';

/** Where something is with its scale: its position, turn and (uniform) scale. */
export interface Placed extends Placement {
  scale: number;
}

/** the top of the tree `node` is in: its scene's root, if it is in one */
export function topOf(node: Object3D): Object3D {
  let top = node;
  while (top.parent) top = top.parent;
  return top;
}

/** where `node` is in the world as the scene stands now, its scale with it */
export function placedOf(node: Object3D): Placed {
  node.updateWorldMatrix(true, false);
  const placed = { position: new Vector3(), quaternion: new Quaternion() }, scale = new Vector3();
  node.matrixWorld.decompose(placed.position, placed.quaternion, scale);
  return { ...placed, scale: scale.x };
}

/** where `node` is in the world as the scene stands now, its scale left out */
export function worldOf(node: Object3D): Placement {
  const { position, quaternion } = placedOf(node);
  return { position, quaternion };
}

/** `at` (the world) in the frame `frame` places */
export function inFrame(at: Placed, frame: Placement): Placed {
  const back = frame.quaternion.clone().invert();
  return { position: at.position.clone().sub(frame.position).applyQuaternion(back), quaternion: back.multiply(at.quaternion), scale: at.scale };
}

/** `at` (in the frame `frame` places) in the world */
export function toWorld(at: Placement, frame: Placement): Placement {
  return { position: at.position.clone().applyQuaternion(frame.quaternion).add(frame.position), quaternion: frame.quaternion.clone().multiply(at.quaternion) };
}

/** whether `object` is `node` or hangs from it in the scene */
export function within(object: Object3D, node: Object3D): boolean {
  for (let at: Object3D | null = object; at; at = at.parent) if (at === node) return true;
  return false;
}

/** `value` as a vector: a `Vector3` or [x, y, z]; none, the zero vector; anything else a misuse, said at once (`what`: what gave it) */
export function vectorOf(value: unknown, what: string): Vector3 {
  if (value === undefined) return new Vector3();
  if (value instanceof Vector3) return value.clone();
  if (Array.isArray(value) && value.length === 3 && value.every((x) => typeof x === 'number' && Number.isFinite(x))) return new Vector3(value[0], value[1], value[2]);
  throw new Error(`${what} is neither a Vector3 nor [x, y, z]`);
}
