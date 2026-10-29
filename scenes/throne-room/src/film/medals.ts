import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Vector3, type Object3D } from 'three';
import type { Body } from '@drawcall/animate';

// How the film shows the ceremony's medals and the cushion they wait on: the medals are the ceremony beat's props (their mass and
// grips), given a gold disc on its red ribbon to be seen; the cushion lies on a slim stand before the bearer.

// (polished metal: it mirrors the viewer's environment, the hall's colours)
const GOLD = new MeshStandardMaterial({ color: 0xf0c050, metalness: 1, roughness: 0.25 });
const RED = new MeshStandardMaterial({ color: 0xb8322a, roughness: 0.8 });
const VELVET = new MeshStandardMaterial({ color: 0x3b2c55, roughness: 1 });
const BRASS = new MeshStandardMaterial({ color: 0x8a6a2e, metalness: 0.4, roughness: 0.5 });

/** `medal` given a gold disc, its face toward its +Z, on a red ribbon: a strip from the disc up to each of its outer grips (it is returned) */
export function dressMedal(medal: Object3D): Object3D {
  const disc = new Mesh(new CylinderGeometry(0.04, 0.04, 0.008, 24), GOLD);
  disc.rotation.x = Math.PI / 2;
  disc.castShadow = true;
  medal.add(disc);
  for (const side of ['left', 'right']) {
    const end = medal.getObjectByName(`outer ${side}`);
    if (!end) throw new Error(`${medal.name} has no grip "outer ${side}" for its ribbon to rise to`);
    const strip = new Mesh(new BoxGeometry(0.025, 1, 0.003), RED);
    const from = new Vector3(0, 0.035, 0);
    strip.position.lerpVectors(from, end.position, 0.5);
    strip.scale.y = from.distanceTo(end.position);
    strip.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), end.position.clone().sub(from).normalize());
    strip.castShadow = true;
    medal.add(strip);
  }
  return medal;
}

/** the cushion the medals wait on: on a stand 0.35 m before `bearer`, its top 0.95 m above his floor, turned as he faces */
export function cushion(bearer: Body): Group {
  const tray = new Group();
  tray.name = 'medal cushion';
  tray.position.set(Math.sin(bearer.facing) * 0.35, 0.95, Math.cos(bearer.facing) * 0.35).add(bearer.position);
  tray.rotation.y = bearer.facing;
  const pad = new Mesh(new BoxGeometry(0.36, 0.035, 0.2), VELVET);
  pad.position.y = -0.02;
  const stand = new Mesh(new CylinderGeometry(0.02, 0.05, 0.92, 12), BRASS);
  stand.position.y = -0.5;
  pad.castShadow = stand.castShadow = true;
  tray.add(pad, stand);
  return tray;
}
