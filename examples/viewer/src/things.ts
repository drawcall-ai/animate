// The scenes' props and things: plain three.js meshes and empties, placed where they stand.
import { BoxGeometry, CylinderGeometry, Mesh, MeshStandardMaterial, Object3D, SphereGeometry, type Vector3 } from 'three';

const material = new MeshStandardMaterial({ color: 0x8a8a94, roughness: 0.8 });

/** a box of `size` (m) under `parent` at `position`, named `name` */
export function box(parent: Object3D, name: string, size: Vector3, position: Vector3): Mesh {
  return place(parent, new Mesh(new BoxGeometry(size.x, size.y, size.z), material), name, position);
}

/** a ball of `radius` (m) under `parent` at `position`, named `name` */
export function ball(parent: Object3D, name: string, radius: number, position: Vector3): Mesh {
  return place(parent, new Mesh(new SphereGeometry(radius, 16, 12), material), name, position);
}

/** a cylinder of `radius` and `length` (m) along its +Y under `parent` at `position`, named `name` */
export function cylinder(parent: Object3D, name: string, radius: number, length: number, position: Vector3): Mesh {
  return place(parent, new Mesh(new CylinderGeometry(radius, radius, length, 16), material), name, position);
}

/** an empty (a place, a grip) under `parent` at `position`, named `name` */
export function empty(parent: Object3D, name: string, position: Vector3): Object3D {
  return place(parent, new Object3D(), name, position);
}

function place<T extends Object3D>(parent: Object3D, object: T, name: string, position: Vector3): T {
  object.name = name;
  object.position.copy(position);
  parent.add(object);
  return object;
}
