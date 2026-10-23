import { forwardOf, leftOf } from '@drawcall/animate';
import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Keep } from '.';
import { APRON, FACINGS, FLOOR, HALF } from './layout';
import { tableClothTexture } from './textures';

export type Seat = { x: number; y: number; z: number; yaw: number };

const ROWS = 16; // tiers per stand
const standDistance = (row: number) => 9.2 + row * 0.9;
const standHeight = (row: number) => FLOOR + 0.55 + row * 0.42;
const SEAT_PITCH = 0.56;

const CLOTHES = [0x1a1a1f, 0x23252d, 0x0f1624, 0x2b2f3a, 0x3a0f14, 0xd8d8dc, 0x1f3354, 0x4a4f58, 0x7a1a1f, 0x2f4a2f, 0x9a8a6a, 0x101010];
const SKINS = [0xe0b89a, 0xc79a7a, 0x9a6a4a, 0x6b4630, 0xf0cdb0, 0x4a3020];

const forward = new Vector3();
const left = new Vector3();
/** the point `d` from the centre behind spectators facing `yaw`, `a` to their left */
function standPoint(yaw: number, d: number, a: number, y: number): Vector3 {
  forwardOf(yaw, forward);
  leftOf(yaw, left);
  return new Vector3(-forward.x * d + left.x * a, y, -forward.z * d + left.z * a);
}

/** ringside tables, floor seats and tiered stands, filled from `rand`; returns the occupied seats */
export function addCrowd(group: Group, keep: Keep, rand: () => number): Seat[] {
  addTables(group, keep);
  const seats = [...floorSeats(), ...addStands(group, keep)];
  addSeats(group, keep, seats);
  return addPeople(group, keep, seats, rand);
}

/** warm dots along the top of the stands (a depth cue) */
export function addBalconyLights(group: Group, keep: Keep) {
  const dotGeo = keep(new SphereGeometry(0.05, 8, 6));
  const dotMat = keep(new MeshBasicMaterial({ color: new Color(3, 2.4, 1.6) }));
  const d = standDistance(ROWS) + 0.6;
  const y = standHeight(ROWS) + 2.6;
  const dots = new InstancedMesh(dotGeo, dotMat, 4 * 40);
  const o = new Object3D();
  let n = 0;
  for (const yaw of FACINGS) {
    for (let i = 0; i < 40; i++) {
      o.position.copy(standPoint(yaw, d, -d + (2 * d * (i + 0.5)) / 40, y));
      o.updateMatrix();
      dots.setMatrixAt(n++, o.matrix);
    }
  }
  group.add(dots);
}

/** press tables on three sides, each with a row of glowing laptop screens */
function addTables(group: Group, keep: Keep) {
  const clothMat = keep(new MeshStandardMaterial({ map: keep(tableClothTexture()), roughness: 0.8 }));
  const tableTop = keep(new MeshStandardMaterial({ color: 0x101114, roughness: 0.35, metalness: 0.3 }));
  const screenMat = keep(new MeshBasicMaterial({ color: new Color(0.35, 0.5, 1.0) }));
  const tableGeo = keep(new BoxGeometry(2.6, 0.76, 0.62));
  for (const yaw of FACINGS.slice(0, 3)) {
    const table = new Group();
    const body = new Mesh(tableGeo, [clothMat, clothMat, tableTop, tableTop, clothMat, clothMat]);
    body.position.y = FLOOR + 0.38;
    body.castShadow = body.receiveShadow = true;
    table.add(body);
    for (const x of [-0.8, 0, 0.8]) {
      const screen = new Mesh(keep(new BoxGeometry(0.34, 0.22, 0.02)), [tableTop, tableTop, tableTop, tableTop, tableTop, screenMat]);
      screen.position.set(x, FLOOR + 0.9, 0.05);
      screen.rotation.x = -0.25;
      table.add(screen);
    }
    forwardOf(yaw, forward);
    table.position.set(forward.x * -(HALF + APRON + 1.0), 0, forward.z * -(HALF + APRON + 1.0));
    table.rotation.y = yaw;
    group.add(table);
  }
}

/** three rows on each side of the ring */
function floorSeats(): Seat[] {
  const seats: Seat[] = [];
  for (const yaw of FACINGS) {
    for (let row = 0; row < 3; row++) {
      const d = HALF + APRON + 2.2 + row * 0.85;
      for (let a = -4.2; a <= 4.2; a += SEAT_PITCH) {
        const p = standPoint(yaw, d, a, FLOOR);
        seats.push({ x: p.x, y: FLOOR, z: p.z, yaw });
      }
    }
  }
  return seats;
}

/** the tiers of the four stands, with an exit sign above each; returns their seats */
function addStands(group: Group, keep: Keep): Seat[] {
  const seats: Seat[] = [];
  const tierMat = keep(new MeshStandardMaterial({ color: 0x15161b, roughness: 0.85 }));
  for (const yaw of FACINGS) {
    for (let row = 0; row < ROWS; row++) {
      const d = standDistance(row);
      const y = standHeight(row);
      const len = 2 * (d - 1.2);
      const tier = new Mesh(keep(new BoxGeometry(len, y - FLOOR, 0.9)), tierMat);
      tier.position.copy(standPoint(yaw, d + 0.2, 0, (y + FLOOR) / 2));
      tier.rotation.y = yaw;
      tier.receiveShadow = true;
      group.add(tier);
      for (let a = -len / 2 + 0.5; a <= len / 2 - 0.5; a += SEAT_PITCH) {
        // aisles every 12 seats
        if (Math.round((a + len / 2) / SEAT_PITCH) % 13 === 0) continue;
        const p = standPoint(yaw, d, a, y);
        seats.push({ x: p.x, y, z: p.z, yaw });
      }
    }
    const exit = new Mesh(keep(new BoxGeometry(0.7, 0.28, 0.05)), keep(new MeshBasicMaterial({ color: new Color(0.1, 2.2, 0.5) })));
    exit.position.copy(standPoint(yaw, standDistance(ROWS) + 0.4, 0, standHeight(ROWS) + 1.6));
    exit.rotation.y = yaw;
    group.add(exit);
  }
  return seats;
}

function addSeats(group: Group, keep: Keep, seats: Seat[]) {
  const o = new Object3D();
  const seatMat = keep(new MeshStandardMaterial({ color: 0x3d0b10, roughness: 0.6 }));
  const seatMesh = new InstancedMesh(keep(new BoxGeometry(0.46, 0.08, 0.44)), seatMat, seats.length);
  const backMesh = new InstancedMesh(keep(new BoxGeometry(0.46, 0.46, 0.06)), seatMat, seats.length);
  seats.forEach((s, i) => {
    o.position.set(s.x, s.y + 0.44, s.z);
    o.rotation.set(0, s.yaw, 0);
    o.updateMatrix();
    seatMesh.setMatrixAt(i, o.matrix);
    forwardOf(s.yaw, forward);
    o.position.set(s.x - forward.x * 0.22, s.y + 0.7, s.z - forward.z * 0.22);
    o.updateMatrix();
    backMesh.setMatrixAt(i, o.matrix);
  });
  seatMesh.receiveShadow = backMesh.receiveShadow = true;
  group.add(seatMesh, backMesh);
}

/** seated (some standing) figures facing the ring in most seats; returns the occupied seats */
function addPeople(group: Group, keep: Keep, seats: Seat[], rand: () => number): Seat[] {
  const people = seats.filter(() => rand() < 0.82);
  // shoulders make a crowd read as people (a capsule reads as a bowling pin)
  const torsoMesh = new InstancedMesh(keep(new RoundedBoxGeometry(0.46, 0.52, 0.26, 3, 0.1)), keep(new MeshStandardMaterial({ roughness: 0.85 })), people.length);
  const headMesh = new InstancedMesh(keep(new SphereGeometry(0.092, 14, 10)), keep(new MeshStandardMaterial({ roughness: 0.7 })), people.length);
  const armMesh = new InstancedMesh(keep(new CapsuleGeometry(0.055, 0.4, 3, 6)), keep(new MeshStandardMaterial({ roughness: 0.85 })), people.length);
  const o = new Object3D();
  const c = new Color();
  const toRing = new Vector3();
  people.forEach((s, i) => {
    const standing = rand() < 0.1;
    const lean = (rand() - 0.3) * 0.25; // mostly leaning in toward the action
    const base = s.y + (standing ? 0.95 : 0.72);
    toRing.set(-s.x, 0, -s.z).normalize();
    const yaw = Math.atan2(toRing.x, toRing.z) + (rand() - 0.5) * 0.5;
    const sc = 0.9 + rand() * 0.2;
    o.position.set(s.x + toRing.x * 0.03, base, s.z + toRing.z * 0.03);
    o.rotation.set(lean, yaw, 0, 'YXZ');
    o.scale.set(sc, sc, sc * 0.7);
    o.updateMatrix();
    torsoMesh.setMatrixAt(i, o.matrix);
    const shirt = CLOTHES[Math.floor(rand() * CLOTHES.length)];
    torsoMesh.setColorAt(i, c.setHex(shirt));
    // head on top of the (leaning) torso
    o.scale.setScalar(sc);
    o.position.set(s.x + toRing.x * (0.03 + lean * 0.35), base + 0.37 * sc, s.z + toRing.z * (0.03 + lean * 0.35));
    o.updateMatrix();
    headMesh.setMatrixAt(i, o.matrix);
    headMesh.setColorAt(i, c.setHex(SKINS[Math.floor(rand() * SKINS.length)]));
    // a few fans with an arm up (the rest: arm hidden in the lap)
    const cheer = rand() < 0.06;
    const side = rand() < 0.5 ? 1 : -1;
    leftOf(yaw, left);
    o.position.set(s.x + left.x * side * 0.25 * sc, base + (cheer ? 0.45 : -0.5) * sc, s.z + left.z * side * 0.25 * sc);
    o.rotation.set(0, yaw, cheer ? -side * 0.2 : 0, 'YXZ');
    o.scale.setScalar(cheer ? sc : 0.001);
    o.updateMatrix();
    armMesh.setMatrixAt(i, o.matrix);
    armMesh.setColorAt(i, c.setHex(shirt));
  });
  group.add(torsoMesh, headMesh, armMesh);
  return people;
}
