import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  QuadraticBezierCurve3,
  ShaderMaterial,
  SphereGeometry,
  SpotLight,
  SRGBColorSpace,
  TubeGeometry,
  Vector3,
  type Texture,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

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

const FLOOR = -1.1; // arena floor below the canvas
const HALF = 3.05; // inside the ropes: 6.1 m (20 ft)
const APRON = 0.6;
const ROPES = [0.46, 0.76, 1.07, 1.37];
const ROPE_COLORS = [0xeeeeee, 0x2043c8, 0xeeeeee, 0xcf1f27]; // bottom → top

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, n: number, alpha: number, rand: () => number) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = rand() < 0.5 ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha})`;
    g.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
}

/** ring canvas incl. apron: light grey fabric, navy apron band with lettering, centre logo */
function matTexture() {
  const rand = rng(3);
  const S = 2048;
  const ppm = S / (2 * (HALF + APRON));
  return canvasTexture(S, S, (g) => {
    g.fillStyle = '#12203d';
    g.fillRect(0, 0, S, S);
    const inner = 2 * HALF * ppm;
    const o = (S - inner) / 2;
    g.fillStyle = '#b4b8c2';
    g.fillRect(o, o, inner, inner);
    // worn centre: scuffs where the fighters move most
    for (let i = 0; i < 60; i++) {
      const x = S / 2 + (rand() - 0.5) * inner * 0.7;
      const y = S / 2 + (rand() - 0.5) * inner * 0.7;
      const r = 40 + rand() * 160;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(90,90,100,${0.05 + rand() * 0.05})`);
      gr.addColorStop(1, 'rgba(90,90,100,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    noise(g, S, S, 90000, 0.05, rand);
    // centre logo
    g.save();
    g.translate(S / 2, S / 2);
    g.strokeStyle = 'rgba(18,32,61,0.85)';
    g.lineWidth = 22;
    g.beginPath();
    g.arc(0, 0, 1.05 * ppm, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(200,30,40,0.8)';
    g.lineWidth = 8;
    g.beginPath();
    g.arc(0, 0, 0.92 * ppm, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = 'rgba(18,32,61,0.88)';
    g.font = `900 ${0.36 * ppm}px Helvetica, Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('PROHUMAN', 0, -0.06 * ppm);
    g.font = `700 ${0.13 * ppm}px Helvetica, Arial, sans-serif`;
    g.fillStyle = 'rgba(200,30,40,0.85)';
    g.fillText('FIGHT  NIGHT', 0, 0.3 * ppm);
    g.restore();
    // apron lettering, one run per side, reading from outside the ring
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.font = `800 ${0.3 * ppm}px Helvetica, Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let k = 0; k < 4; k++) {
      g.save();
      g.translate(S / 2, S / 2);
      g.rotate((k * Math.PI) / 2);
      g.fillText('PROHUMAN   ·   SPARSE-INPUT IK   ·   PROHUMAN', 0, S / 2 - o / 2);
      g.restore();
    }
    // canvas seam where the apron folds over the edge
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 4;
    g.strokeRect(o, o, inner, inner);
  });
}

function skirtTexture() {
  const W = 2048;
  const H = Math.round((W * -FLOOR) / (2 * (HALF + APRON)));
  return canvasTexture(W, H, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#141a2c');
    gr.addColorStop(1, '#07080d');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#c8202a';
    g.fillRect(0, 0, W, H * 0.07);
    g.fillStyle = '#ffffff';
    g.fillRect(0, H * 0.07, W, H * 0.015);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `900 ${H * 0.36}px Helvetica, Arial, sans-serif`;
    g.fillStyle = '#f2f2f2';
    g.fillText('PROHUMAN', W / 2, H * 0.52);
    g.font = `700 ${H * 0.13}px Helvetica, Arial, sans-serif`;
    g.fillStyle = '#c8202a';
    g.fillText('FIGHT NIGHT', W * 0.13, H * 0.52);
    g.fillText('FIGHT NIGHT', W * 0.87, H * 0.52);
  });
}

function screenTexture() {
  return canvasTexture(1024, 576, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 576);
    gr.addColorStop(0, '#0a1230');
    gr.addColorStop(1, '#020309');
    g.fillStyle = gr;
    g.fillRect(0, 0, 1024, 576);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#e8243a';
    g.font = '900 64px Helvetica, Arial, sans-serif';
    g.fillText('ROUND 3', 512, 90);
    g.fillStyle = '#ffffff';
    g.font = '900 190px Helvetica, Arial, sans-serif';
    g.fillText('1:47', 512, 280);
    g.font = '700 54px Helvetica, Arial, sans-serif';
    g.fillStyle = '#c9d4ff';
    g.fillText('RED   ·   PROHUMAN   ·   BLUE', 512, 470);
  });
}

function tableClothTexture() {
  return canvasTexture(1024, 256, (g) => {
    g.fillStyle = '#08090d';
    g.fillRect(0, 0, 1024, 256);
    g.fillStyle = '#c8202a';
    g.fillRect(0, 0, 1024, 14);
    g.fillStyle = '#e9e9ee';
    g.font = '800 92px Helvetica, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('PROHUMAN', 512, 140);
  });
}

/** soft vertical light shaft (additive, fades toward the floor and the edges) */
function beamMaterial(color: number, strength: number) {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: { color: { value: new Color(color) }, strength: { value: strength } },
    vertexShader: /* glsl */ `
      varying float vY; varying vec3 vN; varying vec3 vView;
      void main() {
        vY = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color; uniform float strength;
      varying float vY; varying vec3 vN; varying vec3 vView;
      void main() {
        float edge = pow(abs(dot(vN, vView)), 1.5);
        float along = smoothstep(0.0, 1.0, vY) * 0.85 + 0.15;
        gl_FragColor = vec4(color * strength * edge * along, 1.0);
      }`,
  });
}

export function createBoxingArena(center: Vector3): Environment {
  const rand = rng(11);
  const group = new Group();
  group.position.set(center.x, 0, center.z);
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  // ------------------------------------------------------------ floor
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

  // ------------------------------------------------------------ ring platform
  const W = 2 * (HALF + APRON);
  const skirt = keep(new MeshStandardMaterial({ map: keep(skirtTexture()), roughness: 0.7 }));
  const top = keep(new MeshStandardMaterial({ map: keep(matTexture()), roughness: 0.92 }));
  const under = keep(new MeshStandardMaterial({ color: 0x050505 }));
  const platform = new Mesh(keep(new BoxGeometry(W, -FLOOR, W)), [skirt, skirt, top, under, skirt, skirt]);
  platform.position.y = FLOOR / 2;
  platform.receiveShadow = true;
  platform.castShadow = true;
  group.add(platform);

  // ------------------------------------------------------------ posts, corner pads, ropes
  const P = HALF + 0.14;
  const corners: [number, number][] = [
    [-P, -P],
    [P, -P],
    [P, P],
    [-P, P],
  ];
  const postMat = keep(new MeshStandardMaterial({ color: 0xb8bec8, metalness: 0.9, roughness: 0.28 }));
  const postGeo = keep(new CylinderGeometry(0.055, 0.06, 1.6, 20));
  const padGeo = keep(new RoundedBoxGeometry(0.2, 1.08, 0.2, 4, 0.05));
  const padColors = [0xb3141b, 0xe6e6e6, 0x1d3fb8, 0xe6e6e6]; // red corner, neutral, blue, neutral
  corners.forEach(([x, z], i) => {
    const post = new Mesh(postGeo, postMat);
    post.position.set(x, 0.8, z);
    post.castShadow = true;
    group.add(post);
    const pad = new Mesh(padGeo, keep(new MeshStandardMaterial({ color: padColors[i], roughness: 0.5 })));
    const inward = new Vector3(-x, 0, -z).normalize();
    pad.position.set(x + inward.x * 0.1, 0.92, z + inward.z * 0.1);
    pad.rotation.y = Math.atan2(inward.x, inward.z);
    pad.castShadow = true;
    group.add(pad);
    // a corner stool leaning against the red and blue corners' apron
    if (i === 0 || i === 2) {
      const stool = new Mesh(keep(new CylinderGeometry(0.2, 0.18, 0.05, 20)), keep(new MeshStandardMaterial({ color: 0x151515, roughness: 0.6 })));
      stool.position.set(x * 1.13, FLOOR + 0.45, z * 1.13);
      group.add(stool);
    }
  });
  ROPES.forEach((h, level) => {
    const mat = keep(new MeshStandardMaterial({ color: ROPE_COLORS[level], roughness: 0.42 }));
    for (let k = 0; k < 4; k++) {
      const [ax, az] = corners[k];
      const [bx, bz] = corners[(k + 1) % 4];
      const a = new Vector3(ax, h, az).addScaledVector(new Vector3(-ax, 0, -az).normalize(), 0.06);
      const b = new Vector3(bx, h, bz).addScaledVector(new Vector3(-bx, 0, -bz).normalize(), 0.06);
      // ropes sag a little between the posts
      const mid = a.clone().add(b).multiplyScalar(0.5);
      mid.y -= 0.035;
      const rope = new Mesh(keep(new TubeGeometry(new QuadraticBezierCurve3(a, mid, b), 64, 0.022, 10)), mat);
      rope.castShadow = true;
      group.add(rope);
    }
  });
  // rope spacers: two vertical ties per side
  const tieMat = keep(new MeshStandardMaterial({ color: 0x14203f, roughness: 0.7 }));
  const tieGeo = keep(new BoxGeometry(0.055, ROPES[3] - ROPES[0] + 0.06, 0.035));
  for (let k = 0; k < 4; k++) {
    for (const f of [-1 / 3, 1 / 3]) {
      const tie = new Mesh(tieGeo, tieMat);
      const along = f * 2 * P;
      const side = P + 0.03;
      if (k % 2 === 0) tie.position.set(along, (ROPES[0] + ROPES[3]) / 2 - 0.03, k === 0 ? -side : side);
      else {
        tie.position.set(k === 1 ? side : -side, (ROPES[0] + ROPES[3]) / 2 - 0.03, along);
        tie.rotation.y = Math.PI / 2;
      }
      group.add(tie);
    }
  }
  // steps up to the red and blue corners
  const stepMat = keep(new MeshStandardMaterial({ color: 0x1b1d22, metalness: 0.6, roughness: 0.4 }));
  for (const [x, z] of [corners[0], corners[2]]) {
    for (let s = 0; s < 3; s++) {
      const h = (-FLOOR * (s + 1)) / 3.4;
      const step = new Mesh(keep(new BoxGeometry(0.9, h, 0.32)), stepMat);
      const d = HALF + APRON + 0.16 + (2 - s) * 0.32;
      step.position.set(x * 0.72, FLOOR + h / 2, Math.sign(z) * d);
      step.castShadow = step.receiveShadow = true;
      group.add(step);
    }
  }

  // ------------------------------------------------------------ ringside tables
  const clothMat = keep(new MeshStandardMaterial({ map: keep(tableClothTexture()), roughness: 0.8 }));
  const tableTop = keep(new MeshStandardMaterial({ color: 0x101114, roughness: 0.35, metalness: 0.3 }));
  const screenMat = keep(new MeshBasicMaterial({ color: new Color(0.35, 0.5, 1.0) }));
  const tableGeo = keep(new BoxGeometry(2.6, 0.76, 0.62));
  for (let k = 0; k < 3; k++) {
    const yaw = (k * Math.PI) / 2;
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
    table.position.set(Math.sin(yaw) * -(HALF + APRON + 1.0), 0, Math.cos(yaw) * -(HALF + APRON + 1.0));
    table.rotation.y = yaw;
    group.add(table);
  }

  // ------------------------------------------------------------ seats and crowd
  type Seat = { x: number; y: number; z: number; yaw: number };
  const seats: Seat[] = [];
  // floor seats: three rows on each side
  for (let k = 0; k < 4; k++) {
    const yaw = (k * Math.PI) / 2;
    const fx = Math.sin(yaw),
      fz = Math.cos(yaw);
    for (let row = 0; row < 3; row++) {
      const d = HALF + APRON + 2.2 + row * 0.85;
      for (let a = -4.2; a <= 4.2; a += 0.56) seats.push({ x: -fx * d + fz * a, y: FLOOR, z: -fz * d - fx * a, yaw });
    }
  }
  // tiered stands
  const tierMat = keep(new MeshStandardMaterial({ color: 0x15161b, roughness: 0.85 }));
  const ROWS = 16;
  for (let k = 0; k < 4; k++) {
    const yaw = (k * Math.PI) / 2;
    const fx = Math.sin(yaw),
      fz = Math.cos(yaw);
    for (let row = 0; row < ROWS; row++) {
      const d = 9.2 + row * 0.9;
      const y = FLOOR + 0.55 + row * 0.42;
      const len = 2 * (d - 1.2);
      const tier = new Mesh(keep(new BoxGeometry(len, y - FLOOR, 0.9)), tierMat);
      tier.position.set(-fx * (d + 0.2), (y + FLOOR) / 2, -fz * (d + 0.2));
      tier.rotation.y = yaw;
      tier.receiveShadow = true;
      group.add(tier);
      for (let a = -len / 2 + 0.5; a <= len / 2 - 0.5; a += 0.56) {
        // aisles every 12 seats
        if (Math.round((a + len / 2) / 0.56) % 13 === 0) continue;
        seats.push({ x: -fx * d + fz * a, y, z: -fz * d - fx * a, yaw });
      }
    }
    // an exit sign above each side's top row
    const exit = new Mesh(keep(new BoxGeometry(0.7, 0.28, 0.05)), keep(new MeshBasicMaterial({ color: new Color(0.1, 2.2, 0.5) })));
    const d = 9.2 + ROWS * 0.9 + 0.4;
    exit.position.set(-fx * d, FLOOR + 0.55 + ROWS * 0.42 + 1.6, -fz * d);
    exit.rotation.y = yaw;
    group.add(exit);
  }

  const o = new Object3D();
  const seatMat = keep(new MeshStandardMaterial({ color: 0x3d0b10, roughness: 0.6 }));
  const seatMesh = new InstancedMesh(keep(new BoxGeometry(0.46, 0.08, 0.44)), seatMat, seats.length);
  const backMesh = new InstancedMesh(keep(new BoxGeometry(0.46, 0.46, 0.06)), seatMat, seats.length);
  seats.forEach((s, i) => {
    o.position.set(s.x, s.y + 0.44, s.z);
    o.rotation.set(0, s.yaw, 0);
    o.updateMatrix();
    seatMesh.setMatrixAt(i, o.matrix);
    o.position.set(s.x - Math.sin(s.yaw) * 0.22, s.y + 0.7, s.z - Math.cos(s.yaw) * 0.22);
    o.updateMatrix();
    backMesh.setMatrixAt(i, o.matrix);
  });
  seatMesh.receiveShadow = backMesh.receiveShadow = true;
  group.add(seatMesh, backMesh);

  // the crowd: seated (some standing) figures facing the ring
  const clothes = [0x1a1a1f, 0x23252d, 0x0f1624, 0x2b2f3a, 0x3a0f14, 0xd8d8dc, 0x1f3354, 0x4a4f58, 0x7a1a1f, 0x2f4a2f, 0x9a8a6a, 0x101010];
  const skins = [0xe0b89a, 0xc79a7a, 0x9a6a4a, 0x6b4630, 0xf0cdb0, 0x4a3020];
  const people = seats.filter(() => rand() < 0.82);
  // shoulders make a crowd read as people (a capsule reads as a bowling pin)
  const torsoMesh = new InstancedMesh(keep(new RoundedBoxGeometry(0.46, 0.52, 0.26, 3, 0.1)), keep(new MeshStandardMaterial({ roughness: 0.85 })), people.length);
  const headMesh = new InstancedMesh(keep(new SphereGeometry(0.092, 14, 10)), keep(new MeshStandardMaterial({ roughness: 0.7 })), people.length);
  const armMesh = new InstancedMesh(keep(new CapsuleGeometry(0.055, 0.4, 3, 6)), keep(new MeshStandardMaterial({ roughness: 0.85 })), people.length);
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
    const shirt = clothes[Math.floor(rand() * clothes.length)];
    torsoMesh.setColorAt(i, c.setHex(shirt));
    // head on top of the (leaning) torso
    o.scale.setScalar(sc);
    o.position.set(s.x + toRing.x * (0.03 + lean * 0.35), base + 0.37 * sc, s.z + toRing.z * (0.03 + lean * 0.35));
    o.updateMatrix();
    headMesh.setMatrixAt(i, o.matrix);
    headMesh.setColorAt(i, c.setHex(skins[Math.floor(rand() * skins.length)]));
    // a few fans with an arm up (the rest: arm hidden in the lap)
    const cheer = rand() < 0.06;
    const side = rand() < 0.5 ? 1 : -1;
    const lx = Math.cos(yaw) * side,
      lz = -Math.sin(yaw) * side;
    o.position.set(s.x + lx * 0.25 * sc, base + (cheer ? 0.45 : -0.5) * sc, s.z + lz * 0.25 * sc);
    o.rotation.set(0, yaw, cheer ? -side * 0.2 : 0, 'YXZ');
    o.scale.setScalar(cheer ? sc : 0.001);
    o.updateMatrix();
    armMesh.setMatrixAt(i, o.matrix);
    armMesh.setColorAt(i, c.setHex(shirt));
  });
  group.add(torsoMesh, headMesh, armMesh);

  // ------------------------------------------------------------ lighting rig
  const trussMat = keep(new MeshStandardMaterial({ color: 0x2a2c31, metalness: 0.8, roughness: 0.35 }));
  const TY = 5.2;
  const T = HALF + 0.9;
  for (let k = 0; k < 4; k++) {
    const beam = new Mesh(keep(new BoxGeometry(2 * T + 0.3, 0.3, 0.3)), trussMat);
    beam.position.set(k % 2 ? 0 : 0, TY, 0);
    if (k === 0) beam.position.z = -T;
    if (k === 1) beam.position.z = T;
    if (k === 2) {
      beam.position.x = -T;
      beam.rotation.y = Math.PI / 2;
    }
    if (k === 3) {
      beam.position.x = T;
      beam.rotation.y = Math.PI / 2;
    }
    group.add(beam);
    // suspension cables
    const cable = new Mesh(keep(new CylinderGeometry(0.012, 0.012, 14, 6)), trussMat);
    cable.position.set(corners[k][0] * 1.2, TY + 7, corners[k][1] * 1.2);
    group.add(cable);
  }
  // lamp housings on the truss, glowing faces aimed at the canvas
  const lampGeo = keep(new CylinderGeometry(0.16, 0.13, 0.3, 16));
  const lampFaceGeo = keep(new CylinderGeometry(0.125, 0.125, 0.01, 16));
  const lampFaceMat = keep(new MeshBasicMaterial({ color: new Color(6, 5.6, 5) }));
  const beamMat = keep(beamMaterial(0xfff2de, 0.012));
  const lamps: Vector3[] = [];
  for (let k = 0; k < 4; k++) {
    for (const f of [-0.6, 0, 0.6]) {
      const p = k === 0 ? new Vector3(f * T, TY - 0.3, -T) : k === 1 ? new Vector3(f * T, TY - 0.3, T) : k === 2 ? new Vector3(-T, TY - 0.3, f * T) : new Vector3(T, TY - 0.3, f * T);
      lamps.push(p);
    }
  }
  lamps.forEach((p) => {
    const aim = new Vector3(-p.x * 0.35, 0, -p.z * 0.35);
    const lamp = new Group();
    lamp.position.copy(p);
    lamp.lookAt(aim);
    lamp.rotateX(Math.PI / 2);
    const housing = new Mesh(lampGeo, trussMat);
    lamp.add(housing);
    const face = new Mesh(lampFaceGeo, lampFaceMat);
    face.position.y = -0.155;
    lamp.add(face);
    group.add(lamp);
    // hazy shaft toward the canvas
    const len = p.distanceTo(aim);
    const shaft = new Mesh(keep(new ConeGeometry(0.55, len, 24, 1, true)), beamMat);
    shaft.position.copy(p).lerp(aim, 0.5);
    shaft.lookAt(aim);
    shaft.rotateX(-Math.PI / 2);
    group.add(shaft);
  });

  // key light straight above, with soft shadows on the canvas
  const key = new SpotLight(0xfff4e6, 120, 0, 0.5, 0.55, 2);
  key.position.set(0, 9, 0);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 4;
  key.shadow.camera.far = 14;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.02;
  group.add(key, key.target);
  // truss fills from the four sides (modelling light on the fighters)
  for (const [x, z] of [
    [0, -T],
    [0, T],
    [-T, 0],
    [T, 0],
  ]) {
    const s = new SpotLight(0xfff0dc, 26, 0, 0.75, 0.6, 2);
    s.position.set(x, TY - 0.3, z);
    s.target.position.set(-x * 0.3, 0.8, -z * 0.3);
    group.add(s, s.target);
  }
  // cool wash over the stands so the crowd reads as a crowd
  for (let k = 0; k < 4; k++) {
    const yaw = (k * Math.PI) / 2;
    const s = new SpotLight(0x6d82c4, 30, 0, 0.9, 0.8, 2);
    s.position.set(0, 7.5, 0);
    s.target.position.set(-Math.sin(yaw) * 14, FLOOR + 3, -Math.cos(yaw) * 14);
    group.add(s, s.target);
  }
  group.add(new HemisphereLight(0x3a4668, 0x08080a, 0.18));

  // ------------------------------------------------------------ jumbotron
  const screenTex = keep(screenTexture());
  const tron = new Group();
  tron.position.y = 8.6;
  const frameMat = keep(new MeshStandardMaterial({ color: 0x0c0d10, metalness: 0.7, roughness: 0.4 }));
  const scr = keep(new MeshBasicMaterial({ map: screenTex, color: new Color(1.6, 1.6, 1.6) }));
  const box = new Mesh(keep(new BoxGeometry(3.4, 1.95, 3.4)), [scr, scr, frameMat, frameMat, scr, scr]);
  tron.add(box);
  const rim = new Mesh(keep(new BoxGeometry(3.6, 0.12, 3.6)), keep(new MeshBasicMaterial({ color: new Color(2.4, 0.25, 0.3) })));
  rim.position.y = -1.03;
  tron.add(rim);
  group.add(tron);

  // ------------------------------------------------------------ balcony lights (depth cue)
  const dotGeo = keep(new SphereGeometry(0.05, 8, 6));
  const dotMat = keep(new MeshBasicMaterial({ color: new Color(3, 2.4, 1.6) }));
  const topD = 9.2 + ROWS * 0.9 + 0.6;
  const topY = FLOOR + 0.55 + ROWS * 0.42 + 2.6;
  const dots = new InstancedMesh(dotGeo, dotMat, 4 * 40);
  let n = 0;
  for (let k = 0; k < 4; k++) {
    const yaw = (k * Math.PI) / 2;
    for (let i = 0; i < 40; i++) {
      const a = -topD + (2 * topD * (i + 0.5)) / 40;
      o.position.set(-Math.sin(yaw) * topD + Math.cos(yaw) * a, topY, -Math.cos(yaw) * topD - Math.sin(yaw) * a);
      o.rotation.set(0, 0, 0);
      o.scale.setScalar(1);
      o.updateMatrix();
      dots.setMatrixAt(n++, o.matrix);
    }
  }
  group.add(dots);

  // ------------------------------------------------------------ camera flashes in the crowd
  const FLASHES = 14;
  const flashMesh = new InstancedMesh(keep(new SphereGeometry(0.07, 8, 6)), keep(new MeshBasicMaterial({ color: new Color(9, 9, 10) })), FLASHES);
  const flashes = Array.from({ length: FLASHES }, () => {
    const p = people[Math.floor(rand() * people.length)];
    return { x: p.x, y: p.y + 1.25, z: p.z, period: 2.5 + rand() * 5, phase: rand() * 7 };
  });
  group.add(flashMesh);
  const update = (t: number) => {
    flashes.forEach((f, i) => {
      // a short pop (~70 ms) once per period
      const u = (t + f.phase) % f.period;
      o.position.set(f.x, f.y, f.z);
      o.rotation.set(0, 0, 0);
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
