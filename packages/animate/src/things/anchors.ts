import type { Matrix4, Object3D, Quaternion } from 'three';
import type { Self } from '../body/self';

/** each body's object (bone −1) and moving bones, by node */
export const anchors = new WeakMap<Object3D, { body: Self; bone: number }>();

/** the body that moves each thing it carries in both hands itself (one hand's hangs from that hand's bone) */
export const movers = new WeakMap<Object3D, Self>();

/** the body that keeps each node turned to a world rotation (`Body.orient`), its position following its parent: the rotation, by node */
export const turners = new WeakMap<Object3D, { readonly turned: ReadonlyMap<Object3D, Quaternion> }>();

/** a node's matrix from one update to the next, the update it was last read in, and its parent frame (null for world) */
export interface Interpolated {
  update: number;
  parent: Object3D | null;
  from: Matrix4;
  to: Matrix4;
}
