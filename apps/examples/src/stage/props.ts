import { BoxGeometry, CylinderGeometry, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import type { Part, Prop } from '../scenario';

const edgeMat = new LineBasicMaterial({ color: 0x6b6b75 });
const faceMat = new MeshBasicMaterial({ color: 0x1a1a1f, transparent: true, opacity: 0.85 });
const ghostMat = new MeshBasicMaterial({ color: 0x8a8a99, transparent: true, opacity: 0.2, depthWrite: false });
const ballMat = new MeshBasicMaterial({ color: 0x777777, wireframe: true });
const pitMat = new MeshBasicMaterial({ color: 0x050506 });
const rodMat = new MeshBasicMaterial({ color: 0xb8b8c4 });
const partMat = new MeshBasicMaterial({ color: 0x9a9aa6 });
const Y = new Vector3(0, 1, 0);
const IDENTITY = new Quaternion();
/** a torus lies in the x–y plane: turned into the y–z plane */
const TORUS = new Quaternion().setFromAxisAngle(Y, Math.PI / 2);

function box(size: Vector3, pos: Vector3, yaw = 0, ghost = false) {
  const g = new BoxGeometry(size.x, size.y, size.z);
  const m = new Mesh(g, ghost ? ghostMat : faceMat);
  m.add(new LineSegments(new EdgesGeometry(g), edgeMat));
  m.position.copy(pos);
  m.rotation.y = yaw;
  return m;
}

/** a vehicle's part, in its frame */
function part(p: Part) {
  if (p.kind === 'box') {
    const m = new Mesh(new BoxGeometry(p.size.x, p.size.y, p.size.z), partMat);
    m.position.copy(p.center);
    if (p.quaternion) m.quaternion.copy(p.quaternion);
    return m;
  }
  if (p.kind === 'wheel') {
    const m = new Mesh(new TorusGeometry(p.radius - p.tube / 2, p.tube / 2, 6, 32), partMat);
    m.position.copy(p.center);
    m.quaternion.copy(p.quaternion ?? IDENTITY).multiply(TORUS);
    return m;
  }
  const along = p.to.clone().sub(p.from);
  const m = new Mesh(new CylinderGeometry(p.radius, p.radius, along.length(), 8), partMat);
  m.position.copy(p.from).addScaledVector(along, 0.5);
  m.quaternion.copy(new Quaternion().setFromUnitVectors(Y, along.normalize()));
  return m;
}

/** Redraws `group` with the props (the previous ones' geometry is released). */
export function drawProps(group: Group, props: Prop[]) {
  group.traverse((o) => {
    if (o instanceof Mesh || o instanceof LineSegments) o.geometry.dispose();
  });
  group.clear();
  for (const p of props) {
    if (p.kind === 'box' || p.kind === 'tray') {
      const m = box(p.size, p.position, p.yaw, p.ghost);
      if (p.quaternion) m.quaternion.copy(p.quaternion);
      group.add(m);
    }
    if (p.kind === 'ball') {
      const m = new Mesh(new SphereGeometry(p.radius, 12, 8), ballMat);
      m.position.copy(p.position);
      group.add(m);
    }
    if (p.kind === 'rod') {
      const along = p.to.clone().sub(p.position);
      const m = new Mesh(new CylinderGeometry(p.radius, p.radius, along.length(), 8), rodMat);
      m.position.copy(p.position).addScaledVector(along, 0.5);
      m.quaternion.copy(new Quaternion().setFromUnitVectors(Y, along.normalize()));
      group.add(m);
    }
    if (p.kind === 'pit') {
      // a dark opening just above the floor, its walls going down
      const { x: w, y: h, z: d } = p.size;
      const top = new Mesh(new PlaneGeometry(w, d), pitMat);
      top.rotation.x = -Math.PI / 2;
      top.position.set(p.position.x, 0.002, p.position.z);
      const walls = new LineSegments(new EdgesGeometry(new BoxGeometry(w, h, d)), edgeMat);
      walls.position.set(p.position.x, -h / 2 + 0.002, p.position.z);
      group.add(top, walls);
    }
    if (p.kind === 'ladder') {
      // the rungs across between the stiles, which reach on above the top
      const { position: at, yaw, height, spacing = 0.3, width = 0.46 } = p.ladder;
      const ladder = new Group();
      ladder.position.set(at.x, at.y, at.z);
      ladder.rotation.y = yaw;
      const top = height - at.y;
      for (const x of [-width / 2, width / 2]) ladder.add(box(new Vector3(0.03, top + p.rails, 0.05), new Vector3(x, (top + p.rails) / 2, 0)));
      for (let y = spacing; y <= top + 1e-6; y += spacing) ladder.add(box(new Vector3(width, 0.03, 0.03), new Vector3(0, y, 0)));
      group.add(ladder);
    }
    if (p.kind === 'vehicle') {
      const v = new Group();
      v.position.copy(p.position);
      v.quaternion.copy(p.quaternion);
      for (const q of p.parts) v.add(part(q));
      group.add(v);
    }
    if (p.kind === 'shelf') {
      const { x, z } = p.position;
      const { x: w, y: h, z: d } = p.size;
      for (const sx of [-1, 1]) group.add(box(new Vector3(0.03, h, d), new Vector3(x + (sx * w) / 2, h / 2, z)));
      for (const y of p.boards) group.add(box(new Vector3(w, 0.02, d), new Vector3(x, y - 0.01, z)));
    }
  }
}
