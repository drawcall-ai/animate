import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import type { Body } from '@drawcall/animate';

// How the film shows the ceremony's medals and the cushion they wait on: the medals are the ceremony beat's props (their mass and
// grips), given a gold disc on a short red ribbon to be seen; the cushion lies on a slim stand before the bearer.

// (half metallic: the hall has no environment map, so a fully metallic medal would show black)
const GOLD = new MeshStandardMaterial({ color: 0xe8b445, metalness: 0.55, roughness: 0.3, emissive: 0x3a2808 });
const RED = new MeshStandardMaterial({ color: 0xb8322a, roughness: 0.8 });
const VELVET = new MeshStandardMaterial({ color: 0x3b2c55, roughness: 1 });
const BRASS = new MeshStandardMaterial({ color: 0x8a6a2e, metalness: 0.4, roughness: 0.5 });

/** `medal` given a gold disc on a short red ribbon, its face toward its +Z (it is returned) */
export function dressMedal(medal: Object3D): Object3D {
  const disc = new Mesh(new CylinderGeometry(0.04, 0.04, 0.008, 24), GOLD);
  disc.rotation.x = Math.PI / 2;
  const ribbon = new Mesh(new BoxGeometry(0.03, 0.11, 0.004), RED);
  ribbon.position.y = 0.075;
  disc.castShadow = ribbon.castShadow = true;
  medal.add(disc, ribbon);
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
