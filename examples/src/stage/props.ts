import type { ReadonlyPose } from '@drawcall/animate';
import { BoxGeometry, CylinderGeometry, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, SphereGeometry, type BufferGeometry, Quaternion, Vector3 } from 'three';
import type { Prop } from '../scenario';

const edgeMat = new LineBasicMaterial({ color: 0x6b6b75 });
const faceMat = new MeshBasicMaterial({ color: 0x1a1a1f, transparent: true, opacity: 0.85 });
const colors = new Map<number, MeshBasicMaterial>();
const ballMat = new MeshBasicMaterial({ color: 0x777777, wireframe: true });

/** a solid drawn with its outline (a cylinder's: only where its sides turn) */
function solid(g: BufferGeometry, position: Vector3, quaternion?: Quaternion, color?: number) {
  if (color !== undefined && !colors.has(color)) colors.set(color, new MeshBasicMaterial({ color }));
  const m = new Mesh(g, color === undefined ? faceMat : colors.get(color));
  m.add(new LineSegments(new EdgesGeometry(g, 30), edgeMat));
  m.position.copy(position);
  if (quaternion) m.quaternion.copy(quaternion);
  return m;
}

/** Redraws `group` with the props (the previous ones' geometry is released). */
export function drawProps(group: Group, props: Prop[]) {
  group.traverse((o) => {
    if (o instanceof Mesh || o instanceof LineSegments) o.geometry.dispose();
  });
  group.clear();
  for (const p of props) {
    if (p.kind === 'box') group.add(solid(new BoxGeometry(p.size.x, p.size.y, p.size.z), p.position, p.quaternion));
    if (p.kind === 'cylinder') group.add(solid(new CylinderGeometry(p.radius, p.radius, p.length, 12), p.position, p.quaternion, p.color));
    if (p.kind === 'ball') {
      const m = new Mesh(new SphereGeometry(p.radius, 12, 8), ballMat);
      m.position.copy(p.position);
      group.add(m);
    }
  }
}

export function line(a: Vector3, b: Vector3, radius: number, color: number): Extract<Prop, { kind: 'cylinder' }> {
  const delta = b.clone().sub(a);
  return { kind: 'cylinder', position: a.clone().lerp(b, 0.5), radius, length: delta.length(), quaternion: new Quaternion().setFromUnitVectors(UP, delta.normalize()), color };
}

export function skeletonProps(pose: ReadonlyPose, radius = 0.035): Prop[] {
  return pose.skeleton.bones.flatMap((bone, i) => bone.parent < 0 ? [] : [{ ...line(pose.position(bone.parent), pose.position(i), radius, 0xdba66b), bone: true as const }]);
}
const UP = new Vector3(0, 1, 0);
