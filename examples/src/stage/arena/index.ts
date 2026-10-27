import { Color, FogExp2, Group, InstancedMesh, MeshBasicMaterial, Object3D, SphereGeometry, Vector3 } from 'three';
import { seeded } from '../../math';
import { addBalconyLights, addCrowd } from './crowd';
import { addJumbotron, addLights } from './lights';
import { addRing } from './ring';

/**
 * A boxing arena around a ring whose canvas is at y = 0 (where the fighters stand):
 * raised ring with ropes and padded corners, ringside tables, floor seats and tiered
 * stands with a seated crowd, a lighting truss, hanging jumbotron, haze and light beams.
 * Everything is procedural (canvas textures, instancing) — no assets. Lamps, screens and
 * signs are brighter than 1.0 so a bloom pass (threshold 1) makes only them glow.
 */
export interface Environment {
  group: Group;
  fog: FogExp2;
  background: Color;
  /** animate ambient details (camera flashes in the crowd) at scene time `t` */
  update(t: number): void;
  dispose(): void;
}

/** registers a GPU resource for the arena's `dispose` and returns it */
export type Keep = <T extends { dispose(): void }>(x: T) => T;

const FLASHES = 14;

export function createBoxingArena(center: Vector3): Environment {
  const rand = seeded(11);
  const group = new Group();
  group.position.set(center.x, 0, center.z);
  const disposables: { dispose(): void }[] = [];
  const keep: Keep = (x) => (disposables.push(x), x);

  addRing(group, keep);
  const people = addCrowd(group, keep, rand);
  addLights(group, keep);
  addJumbotron(group, keep);
  addBalconyLights(group, keep);

  // camera flashes in the crowd
  const flashMesh = new InstancedMesh(keep(new SphereGeometry(0.07, 8, 6)), keep(new MeshBasicMaterial({ color: new Color(9, 9, 10) })), FLASHES);
  const flashes = Array.from({ length: FLASHES }, () => {
    const p = people[Math.floor(rand() * people.length)];
    return { x: p.x, y: p.y + 1.25, z: p.z, period: 2.5 + rand() * 5, phase: rand() * 7 };
  });
  group.add(flashMesh);
  const o = new Object3D();
  const update = (t: number) => {
    flashes.forEach((f, i) => {
      // a short pop (~70 ms) once per period
      const u = (t + f.phase) % f.period;
      o.position.set(f.x, f.y, f.z);
      o.scale.setScalar(u < 0.07 ? 1 : 0.0001);
      o.updateMatrix();
      flashMesh.setMatrixAt(i, o.matrix);
    });
    flashMesh.instanceMatrix.needsUpdate = true;
  };
  update(0);

  return {
    group,
    update,
    fog: new FogExp2(0x06070b, 0.028),
    background: new Color(0x040508),
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
