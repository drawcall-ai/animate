import type { Body } from '@drawcall/animate';
import { Object3D, Vector3 } from 'three';

/** an empty `name` on `bone` of `person`, `offset` from the bone in the body's frame, turned as the body faces */
export function onBone(person: Body, bone: Object3D, name: string, offset: Vector3): Object3D {
  const placed = new Object3D();
  placed.name = name;
  placed.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), person.facing);
  placed.position.copy(offset).applyQuaternion(placed.quaternion).add(bone.getWorldPosition(new Vector3()));
  bone.attach(placed);
  return placed;
}
