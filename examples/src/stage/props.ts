import { BoxGeometry, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, SphereGeometry, type Vector3 } from 'three';
import type { Prop } from '../scenario';

const edgeMat = new LineBasicMaterial({ color: 0x6b6b75 });
const faceMat = new MeshBasicMaterial({ color: 0x1a1a1f, transparent: true, opacity: 0.85 });
const ballMat = new MeshBasicMaterial({ color: 0x777777, wireframe: true });

function box(size: Vector3, pos: Vector3, yaw = 0) {
  const g = new BoxGeometry(size.x, size.y, size.z);
  const m = new Mesh(g, faceMat);
  m.add(new LineSegments(new EdgesGeometry(g), edgeMat));
  m.position.copy(pos);
  m.rotation.y = yaw;
  return m;
}

/** Redraws `group` with the props (the previous ones' geometry is released). */
export function drawProps(group: Group, props: Prop[]) {
  group.traverse((o) => {
    if (o instanceof Mesh || o instanceof LineSegments) o.geometry.dispose();
  });
  group.clear();
  for (const p of props) {
    if (p.kind === 'box') group.add(box(p.size, p.position, p.yaw));
    if (p.kind === 'ball') {
      const m = new Mesh(new SphereGeometry(p.radius, 12, 8), ballMat);
      m.position.copy(p.position);
      group.add(m);
    }
  }
}
