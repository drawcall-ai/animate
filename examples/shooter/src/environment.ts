import { BoxCollider, RigidBody, type PhysicsWorld } from '@drawcall/physics';
import {
  BoxGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, DoubleSide,
  Fog, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry,
  SRGBColorSpace, Vector3, type Scene,
} from 'three';
import { createLadder } from './ladder/model';
import { Lift } from './lift';

type Point = readonly [number, number, number];

/** Headroom under the crouch tunnel's ceiling, in metres. */
export const TUNNEL_CLEARANCE = 1.55;

export function createEnvironment(scene: Scene) {
  const yard = new Group();
  yard.name = 'Training yard';
  scene.add(yard);
  scene.background = new Color('#b8d1d9');
  scene.fog = new Fog('#b8d1d9', 38, 95);

  const concrete = new MeshStandardMaterial({ color: '#aab7bd', roughness: 0.93 });
  const pale = new MeshStandardMaterial({ color: '#d9dfdb', roughness: 0.9 });
  const charcoal = new MeshStandardMaterial({ color: '#39474e', roughness: 0.8 });
  const orange = new MeshStandardMaterial({ color: '#ee853e', roughness: 0.77 });
  const teal = new MeshStandardMaterial({ color: '#387f84', roughness: 0.82 });
  const white = new MeshStandardMaterial({ color: '#f3f1df', roughness: 0.85 });
  const crates: RigidBody[] = [];
  const textures: CanvasTexture[] = [];

  function box(name: string, size: Point, at: Point, material = concrete, type: 'static' | 'dynamic' | 'kinematic' = 'static') {
    const body = new RigidBody({ bodyType: type, mass: type === 'dynamic' ? 12 : undefined,
      material: { staticFriction: 0.7, dynamicFriction: 0.7, restitution: 0.05 } });
    body.name = name;
    body.position.set(...at);
    const mesh = new Mesh(new BoxGeometry(...size), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    body.add(mesh, new BoxCollider({ size }));
    yard.add(body);
    return body;
  }

  function detail(parent: Group, size: Point, at: Point, material: MeshStandardMaterial) {
    const mesh = new Mesh(new BoxGeometry(...size), material);
    mesh.position.set(...at);
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function label(title: string, caption: string, at: Point, width = 3.5) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The training yard needs a 2D canvas for its signs.');
    context.fillStyle = '#253b42';
    context.fillRect(0, 0, 1024, 256);
    context.fillStyle = '#f3f1df';
    context.font = '700 67px system-ui, sans-serif';
    context.fillText(title, 42, 104);
    context.fillStyle = '#b8d9df';
    context.font = '400 37px system-ui, sans-serif';
    context.fillText(caption, 42, 181);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    textures.push(texture);
    const sign = new Mesh(new PlaneGeometry(width, width / 4), new MeshBasicMaterial({ map: texture, side: DoubleSide }));
    sign.position.set(...at);
    sign.rotation.y = Math.PI;
    yard.add(sign);
  }

  function stripe(size: Point, at: Point, material = white) {
    detail(yard, size, at, material);
  }

  function ramp(x: number, z: number, width: number, run: number, rise: number) {
    const angle = Math.atan2(rise, run);
    const body = box('Ramp', [width, 0.2, Math.hypot(run, rise)], [x, rise / 2 - 0.1 * Math.cos(angle), z + run / 2], teal);
    body.rotation.x = -angle;
    detail(body, [0.09, 0.012, Math.hypot(run, rise)], [-width / 2 + 0.12, 0.106, 0], white);
    detail(body, [0.09, 0.012, Math.hypot(run, rise)], [width / 2 - 0.12, 0.106, 0], white);
    return body;
  }

  box('Ground', [44, 1, 44], [0, -0.5, 2], pale);
  for (const x of [-22, 22]) box('Boundary', [0.6, 2.4, 44], [x, 1.2, 2], concrete);
  box('Backstop', [44, 3.8, 0.7], [0, 1.9, 24], concrete);
  box('Entrance wall', [44, 1.2, 0.6], [0, 0.6, -20], concrete);
  for (const x of [-18, -12, -6, 0, 6, 12, 18]) {
    stripe([0.025, 0.006, 42], [x, 0.004, 2], concrete);
    stripe([42, 0.006, 0.025], [0, 0.004, x + 2], concrete);
  }
  for (const x of [-2.4, 2.4]) stripe([0.12, 0.012, 28], [x, 0.012, 0], orange);
  for (let z = -12; z < 12; z += 3) stripe([0.14, 0.014, 1], [0, 0.013, z], white);
  stripe([4.8, 0.015, 0.15], [0, 0.014, -12], orange);
  label('TRAINING YARD', 'Move · aim · explore', [0, 3.1, 23.58], 8);

  // Each stair is solid down to the floor, with a 22 cm riser and 55 cm tread.
  for (let index = 0; index < 8; index++) {
    const height = (index + 1) * 0.22;
    const step = box('Stairs', [3, height, 0.55], [-8, height / 2, -5 + index * 0.55]);
    detail(step, [2.86, 0.014, 0.07], [0, height / 2 + 0.008, -0.23], orange);
  }
  box('Stair landing', [3, 1.76, 3], [-8, 0.88, 0.625]);
  label('STAIRS', '22 cm risers', [-8, 2.55, 1.6], 2.8);
  ramp(-13, -5.3, 3, 7, 2.4);
  box('Ramp landing', [3, 2.4, 3], [-13, 1.2, 3.2], concrete);
  box('Raised walkway', [6, 0.28, 1.8], [-10, 2.26, 5.6], teal);
  box('Walkway pillar', [0.6, 2.1, 1.6], [-7.3, 1.05, 5.6], concrete);
  label('SLOPE + LEDGE', 'Climb · turn · jump off', [-13, 3.3, 4.4], 3.8);

  for (const [index, height] of [0.15, 0.3, 0.45, 0.75].entries()) {
    box('Step-height block', [1.35, height, 1.35], [-17.7, height / 2, -5 + index * 2.8], index < 2 ? teal : orange);
    label(`${Math.round(height * 100)} cm`, index < 2 ? 'Step up' : 'Jump up', [-17.7, height + 0.55, -4.7 + index * 2.8], 1.6);
  }

  box('Tunnel left', [0.35, 1.9, 4], [7, 0.95, -4], teal);
  box('Tunnel right', [0.35, 1.9, 4], [10, 0.95, -4], teal);
  box('Tunnel ceiling', [3.35, 0.35, 4], [8.5, TUNNEL_CLEARANCE + 0.175, -4], concrete);
  stripe([2.6, 0.016, 4.8], [8.5, 0.014, -4], teal);
  for (const z of [-6.1, -1.9]) stripe([2.6, 0.022, 0.14], [8.5, 0.022, z], orange);
  label('CROUCH', `${TUNNEL_CLEARANCE} m clearance`, [8.5, 2.45, -6.05], 3.2);

  for (const [x, z, height] of [[-4, 8, 1.45], [4, 6, 1.45], [-4, 13, 1.8], [4, 12, 1.8]]) {
    const cover = box('Cover', [2.8, height, 0.8], [x, height / 2, z], teal);
    detail(cover, [2.82, 0.1, 0.82], [0, height / 2 - 0.05, 0], orange);
  }
  box('Cover platform', [5, 0.45, 4.4], [-8, 0.225, 10], concrete);
  const raisedCover = box('Cover', [2.8, 1.45, 0.8], [-8, 1.175, 10], teal);
  detail(raisedCover, [2.82, 0.1, 0.82], [0, 0.675, 0], orange);
  label('ELEVATED COVER', 'Jump · take cover', [-8, 2.7, 11.8], 3.3);
  label('COVER LANE', 'Peek · reposition · reload', [0, 2.8, 17], 4.6);

  const lift = new Lift(box('Lift', [3.2, 0.25, 3.2], [13.5, 0.125, 6], orange, 'kinematic'), charcoal);
  for (const x of [11.7, 15.3]) box('Lift guide', [0.2, 4.4, 0.2], [x, 2.2, 7.8], charcoal);
  box('Lift gantry', [4, 0.2, 0.25], [13.5, 4.3, 7.8], charcoal);
  box('Lift landing', [5, 0.3, 3], [13.5, 2.25, 9.4], teal);
  for (const x of [11.5, 15.5]) box('Landing support', [0.35, 2.1, 2.7], [x, 1.05, 9.4], concrete);
  detail(lift.body, [2.8, 0.016, 0.09], [0, 0.134, -1.35], white);
  detail(lift.body, [2.8, 0.016, 0.09], [0, 0.134, 1.35], white);
  label('LIFT', 'Press its button to ride up', [13.5, 3.3, 7.65], 4.2);
  // A ladder up the landing's back, climbing toward −Z.
  const ladder = createLadder(2.4);
  ladder.body.position.set(13.5, 0, 11.08);
  ladder.body.rotation.y = Math.PI;
  yard.add(ladder.body);

  for (const [index, x] of [-7, -3.5, 0, 3.5, 7].entries()) {
    box('Target stand', [0.12, 1.2, 0.12], [x, 0.6, 20.5], charcoal);
    const target = box(`Target ${index + 1}`, [0.95, 1.25, 0.12], [x, 1.75, 20.5], charcoal);
    target.userData.target = true;
    const disc = new Mesh(new CircleGeometry(0.39, 32), white);
    disc.position.z = -0.066;
    disc.rotation.y = Math.PI;
    const ring = new Mesh(new CircleGeometry(0.25, 32), orange);
    ring.position.z = 0.002;
    const bullseye = new Mesh(new CircleGeometry(0.11, 24), charcoal);
    bullseye.position.z = 0.004;
    disc.add(ring, bullseye);
    target.add(disc);
  }

  for (const [x, y, z] of [[7, 0.45, -10], [8, 0.45, -10], [7.5, 1.35, -10], [-5, 0.45, -9], [-6, 0.45, -9]]) {
    const crate = box('Physics crate', [0.85, 0.85, 0.85], [x, y, z], orange, 'dynamic');
    crate.setLinearDamping(0.2).setAngularDamping(0.3);
    for (const offset of [-0.29, 0.29]) {
      detail(crate, [0.88, 0.06, 0.88], [0, offset, 0], charcoal);
      detail(crate, [0.06, 0.88, 0.88], [offset, 0, 0], charcoal);
    }
    crates.push(crate);
  }
  label('PHYSICS PROPS', 'Shoot the crates', [7.5, 2.5, -9.3], 3.4);

  // Distant shapes give the yard a horizon without adding scenery to the collision course.
  for (let index = 0; index < 12; index++) {
    const angle = index / 12 * Math.PI * 2;
    const hill = new Mesh(new CylinderGeometry(0, 8 + index % 3 * 3, 7 + index % 4 * 2, 5), teal);
    hill.position.set(Math.sin(angle) * 60, 1, Math.cos(angle) * 60);
    yard.add(hill);
  }

  let stop: (() => void) | undefined;
  return {
    spawn: new Vector3(0, 0.04, -10), lift, ladder, moving: [lift.body, ...crates],
    bind(world: PhysicsWorld) {
      stop?.();
      stop = lift.bind(world);
    },
    dispose() {
      stop?.();
      lift.dispose();
      yard.removeFromParent();
      yard.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.geometry.dispose();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
        else object.material.dispose();
      });
      textures.forEach((texture) => texture.dispose());
    },
  };
}
