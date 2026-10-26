import { BoxGeometry, Group, Mesh, Object3D, Vector3 } from 'three';
import type { Body } from '../src';

/** an empty named `name` at `at` under `parent` */
export function empty(parent: Object3D, name: string, at: Vector3): Object3D {
  const node = new Object3D();
  node.name = name;
  node.position.copy(at);
  parent.add(node);
  return node;
}

/**
 * a box of `size` (m) at `at` in `room`, turned `turn` about +Y, weighing `mass` (kg; null: not meant to be lifted), with a `left` and a
 * `right` grip on its sides (its own +X and −X: a body's left and right hand facing it along +Z); `solid: false`, its grips alone (no mesh
 * for a hand to go round)
 */
export function box(room: Object3D, at: Vector3, { size = new Vector3(0.3, 0.2, 0.25), mass = 2 as number | null, turn = 0, name = 'box', solid = true } = {}): Object3D {
  const object = solid ? new Mesh(new BoxGeometry(size.x, size.y, size.z)) : new Object3D();
  object.name = name;
  if (mass !== null) object.userData.mass = mass;
  object.position.copy(at);
  object.rotation.y = turn;
  // (taken as the hands come: a box's sides have no one way to hold them)
  empty(object, 'left', new Vector3(size.x / 2, 0, 0)).userData.free = true;
  empty(object, 'right', new Vector3(-size.x / 2, 0, 0)).userData.free = true;
  room.add(object);
  room.updateMatrixWorld(true);
  return object;
}

/** a room with `bodies` in it */
export function roomOf(...bodies: Body[]): Group {
  const room = new Group();
  for (const body of bodies) room.add(body.object);
  return room;
}

/** where `object` is in the world */
export const worldOf = (object: Object3D) => object.getWorldPosition(new Vector3());
