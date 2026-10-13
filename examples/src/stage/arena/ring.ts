import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry, QuadraticBezierCurve3, TubeGeometry, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Keep } from '.';
import { APRON, CORNERS, FLOOR, HALF, POST, SIDES, onSide } from './layout';
import { matTexture, skirtTexture } from './textures';

const ROPES = [0.46, 0.76, 1.07, 1.37];
const ROPE_COLORS = [0xeeeeee, 0x2043c8, 0xeeeeee, 0xcf1f27]; // bottom → top
const PAD_COLORS = [0xb3141b, 0xe6e6e6, 0x1d3fb8, 0xe6e6e6]; // per corner

/** the arena floor and the raised ring on it */
export function addRing(group: Group, keep: Keep) {
  addFloor(group, keep);
  addPlatform(group, keep);
  addCorners(group, keep);
  addRopes(group, keep);
  addSteps(group, keep);
}

function addFloor(group: Group, keep: Keep) {
  const floorMat = keep(new MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.42, metalness: 0.2 }));
  const floor = new Mesh(keep(new PlaneGeometry(90, 90)), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR;
  floor.receiveShadow = true;
  group.add(floor);
  const carpet = new Mesh(keep(new PlaneGeometry(15.5, 15.5)), keep(new MeshStandardMaterial({ color: 0x1b0d12, roughness: 0.95 })));
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.y = FLOOR + 0.004;
  carpet.receiveShadow = true;
  group.add(carpet);
}

function addPlatform(group: Group, keep: Keep) {
  const W = 2 * (HALF + APRON);
  const skirt = keep(new MeshStandardMaterial({ map: keep(skirtTexture()), roughness: 0.7 }));
  const top = keep(new MeshStandardMaterial({ map: keep(matTexture()), roughness: 0.92 }));
  const under = keep(new MeshStandardMaterial({ color: 0x050505 }));
  const platform = new Mesh(keep(new BoxGeometry(W, -FLOOR, W)), [skirt, skirt, top, under, skirt, skirt]);
  platform.position.y = FLOOR / 2;
  platform.receiveShadow = true;
  platform.castShadow = true;
  group.add(platform);
}

/** posts, corner pads, and a stool by the red and blue corners' apron */
function addCorners(group: Group, keep: Keep) {
  const postMat = keep(new MeshStandardMaterial({ color: 0xb8bec8, metalness: 0.9, roughness: 0.28 }));
  const postGeo = keep(new CylinderGeometry(0.055, 0.06, 1.6, 20));
  const padGeo = keep(new RoundedBoxGeometry(0.2, 1.08, 0.2, 4, 0.05));
  CORNERS.forEach(([x, z], i) => {
    const post = new Mesh(postGeo, postMat);
    post.position.set(x, 0.8, z);
    post.castShadow = true;
    group.add(post);
    const pad = new Mesh(padGeo, keep(new MeshStandardMaterial({ color: PAD_COLORS[i], roughness: 0.5 })));
    const inward = new Vector3(-x, 0, -z).normalize();
    pad.position.set(x + inward.x * 0.1, 0.92, z + inward.z * 0.1);
    pad.rotation.y = Math.atan2(inward.x, inward.z);
    pad.castShadow = true;
    group.add(pad);
    if (i % 2 === 1) return;
    const stool = new Mesh(keep(new CylinderGeometry(0.2, 0.18, 0.05, 20)), keep(new MeshStandardMaterial({ color: 0x151515, roughness: 0.6 })));
    stool.position.set(x * 1.13, FLOOR + 0.45, z * 1.13);
    group.add(stool);
  });
}

/** ropes sagging a little between the posts, and two vertical ties per side */
function addRopes(group: Group, keep: Keep) {
  ROPES.forEach((h, level) => {
    const mat = keep(new MeshStandardMaterial({ color: ROPE_COLORS[level], roughness: 0.42 }));
    CORNERS.forEach(([ax, az], k) => {
      const [bx, bz] = CORNERS[(k + 1) % 4];
      const a = new Vector3(ax, h, az).addScaledVector(new Vector3(-ax, 0, -az).normalize(), 0.06);
      const b = new Vector3(bx, h, bz).addScaledVector(new Vector3(-bx, 0, -bz).normalize(), 0.06);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      mid.y -= 0.035;
      const rope = new Mesh(keep(new TubeGeometry(new QuadraticBezierCurve3(a, mid, b), 64, 0.022, 10)), mat);
      rope.castShadow = true;
      group.add(rope);
    });
  });
  const tieMat = keep(new MeshStandardMaterial({ color: 0x14203f, roughness: 0.7 }));
  const tieGeo = keep(new BoxGeometry(0.055, ROPES[3] - ROPES[0] + 0.06, 0.035));
  for (const side of SIDES) {
    for (const f of [-1 / 3, 1 / 3]) {
      const tie = new Mesh(tieGeo, tieMat);
      tie.position.copy(onSide(side, POST + 0.03, f * 2 * POST, (ROPES[0] + ROPES[3]) / 2 - 0.03));
      tie.rotation.y = side.yaw;
      group.add(tie);
    }
  }
}

/** steps up to the red and blue corners */
function addSteps(group: Group, keep: Keep) {
  const stepMat = keep(new MeshStandardMaterial({ color: 0x1b1d22, metalness: 0.6, roughness: 0.4 }));
  for (const [x, z] of [CORNERS[0], CORNERS[2]]) {
    for (let s = 0; s < 3; s++) {
      const h = (-FLOOR * (s + 1)) / 3.4;
      const step = new Mesh(keep(new BoxGeometry(0.9, h, 0.32)), stepMat);
      const d = HALF + APRON + 0.16 + (2 - s) * 0.32;
      step.position.set(x * 0.72, FLOOR + h / 2, Math.sign(z) * d);
      step.castShadow = step.receiveShadow = true;
      group.add(step);
    }
  }
}
