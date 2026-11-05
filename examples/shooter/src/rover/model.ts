import { BoxCollider, RigidBody } from '@drawcall/physics';
import {
  BufferGeometry, CylinderGeometry, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, Quaternion, RepeatWrapping, SRGBColorSpace,
  TextureLoader, TorusGeometry, Vector2, Vector3, type Texture,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Parts, type Point, type Profile } from '../parts';
import { roadWheel, steeringWheel } from './wheel';

/** What the running gear needs of the body: its mass (kg) and centre of mass, wheel radius and spring travel below each wheel mount (m). */
export const CHASSIS = { mass: 2000, center: [0, 0.75, 0.1] as const, radius: 0.4, suspension: 0.3 };

const WHEELBASE = 2.79;
const TRACK = 1.49;
const ARCH = 0.5, ARCH_CORNER = 0.18;
/** The steering wheel's rim radius where the hands hold it (m), how far above level they hold it, ten to two (rad), and how much further
 * up the rim each thumb lies along it (rad). */
const RIM = 0.19, TEN_TO_TWO = 0.5, THUMB = 0.4;
/** How a hand holds the rim: as a handle this thick (m; the rim's 0.015 and a few millimetres of give in the glove, so the palm and the
 * thumb's web lie on it rather than in it), its grasp line this far out from the rim's middle toward the fingers (m), so the rim lies
 * across the palm rather than under the fingers' roots. */
const HOLD = { radius: 0.019, out: 0.012 };
/** The driver's seat's middle: right-hand drive sits on −X. */
const DRIVER = -0.4;
/** The cab floor's height (m). */
const FLOOR = 0.62;
/** How far the grab handle's upright stands back off the windscreen's pillar, centre to centre (m). */
const GRAB = { standoff: 0.07 };
export type Wheel = { mount: Vector3; pivot: Group; spin: Group; front: boolean };
export type Rover = ReturnType<typeof createRover>;
export type PaintMaps = Awaited<ReturnType<typeof loadPaintMaps>>;

/**
 * An open-topped, doorless long-wheelbase military Land Rover, right-hand drive, built in metres: +Z forward, +X to its left, the ground
 * at y = 0 with the suspension settled. Its driver's seat, wheel grips, pedals, grab handle, rifle rack and doorway are empties on its body.
 * `maps`, from `loadPaintMaps`, give its paint wear; without them it is plain.
 */
export function createRover(maps?: PaintMaps) {
  const worn = maps && { map: maps.color, normalMap: maps.normal, normalScale: new Vector2(0.8, 0.8), roughnessMap: maps.roughness, aoMap: maps.occlusion };
  const paint = new MeshStandardMaterial({ name: 'Bronze green paint', color: '#8b9a6c', metalness: 0.1, roughness: 0.95, ...worn });
  const black = new MeshStandardMaterial({ name: 'Black chassis paint', color: '#34352e', metalness: 0.3, roughness: 0.8, ...worn });
  const plastic = new MeshStandardMaterial({ name: 'Black plastic', color: '#1d1e1b', roughness: 0.8 });
  const rubber = new MeshStandardMaterial({ name: 'Tyre rubber', color: '#2b2b28', roughness: 0.93 });
  const canvas = new MeshStandardMaterial({ name: 'Seat canvas', color: '#4d523c', roughness: 1 });
  const steel = new MeshStandardMaterial({ name: 'Bare steel', color: '#9a9e97', metalness: 1, roughness: 0.38 });
  const glass = new MeshPhysicalMaterial({ name: 'Windscreen', color: '#c7d6d8', roughness: 0.04, transparent: true, opacity: 0.14, depthWrite: false });
  const mirror = new MeshStandardMaterial({ name: 'Mirror', color: '#c9d4d8', metalness: 1, roughness: 0.05 });
  const lamp = new MeshStandardMaterial({ name: 'Lamp glass', color: '#f2efe2', emissive: '#40392a', roughness: 0.08, metalness: 0.2 });
  const red = new MeshStandardMaterial({ name: 'Tail lamp', color: '#9b1d16', emissive: '#2a0505', roughness: 0.2 });
  const amber = new MeshStandardMaterial({ name: 'Indicator', color: '#d0801c', emissive: '#2a1604', roughness: 0.2 });
  const dial = new MeshStandardMaterial({ name: 'Dial face', color: '#0d0f0e', emissive: '#121410', roughness: 0.3 });
  const materials = [paint, black, plastic, rubber, canvas, steel, glass, mirror, lamp, red, amber, dial];

  const body = new RigidBody({
    mass: CHASSIS.mass, centerOfMass: [...CHASSIS.center], diagonalInertia: [3600, 3800, 950], colliders: false, canSleep: false,
    material: { staticFriction: 0.6, dynamicFriction: 0.6, restitution: 0.05 },
  });
  body.name = 'Land Rover';
  // The chassis, bonnet, seat box and tub collide; the cab above the floor stays open for the driver.
  const boxes: [size: Point, at: Point][] = [
    [[1.78, 0.27, 4.3], [0, 0.485, 0.05]], [[1.78, 0.5, 1.4], [0, 0.87, 1.45]],
    [[1.74, 0.24, 0.5], [0, 0.74, -0.22]], [[1.78, 0.5, 1.62], [0, 0.87, -1.29]],
  ];
  for (const [size, at] of boxes) {
    const collider = new BoxCollider({ size: [...size] });
    collider.position.set(...at);
    body.add(collider);
  }

  const p = new Parts();
  hullParts(p, { paint, black, plastic, canvas, steel, mirror, lamp, red, amber, dial });
  p.finish(body, 0.5);
  const screen = new Parts();
  screen.shape(new RoundedBoxGeometry(1.62, 0.76, 0.008, 1, 0.003).rotateX(-0.12), [0, 1.535, 0.615], glass);
  screen.finish(body);

  const template = roadWheel(CHASSIS.radius, { rubber, rim: paint, steel });
  const spare = template.clone();
  spare.rotation.z = Math.PI / 2;
  spare.position.set(0, 1.24, 1.42);
  body.add(spare);

  const wheels: Wheel[] = [];
  for (const z of [WHEELBASE / 2, -WHEELBASE / 2]) for (const side of [1, -1]) {
    const mount = new Vector3(side * TRACK / 2, CHASSIS.radius + CHASSIS.suspension / 2, z);
    const pivot = new Group(), spin = new Group(), wheel = template.clone();
    wheel.rotation.y = side > 0 ? 0 : Math.PI;
    spin.add(wheel);
    pivot.add(spin);
    pivot.position.copy(mount).y -= CHASSIS.suspension / 2;
    body.add(pivot);
    wheels.push({ mount, pivot, spin, front: z > 0 });
  }

  // The wheel faces the driver's chest, tipped 50° back from upright; its column runs down into the dash.
  const column = new Group();
  column.position.set(DRIVER, 1.3, 0.18);
  column.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.87));
  const steering = steeringWheel({ plastic, steel });
  column.add(steering);
  const shaft = new Parts();
  shaft.tube(0.026, 0, 0.32, [0, 0, -0.2], plastic);
  shaft.finish(column);
  body.add(column);

  const mark = (parent: Object3D, name: string, at: Point) => {
    const empty = new Object3D();
    empty.name = name;
    empty.position.set(...at);
    parent.add(empty);
    return empty;
  };
  // A rifle stands in the rack muzzle up beside the windscreen's right pillar, outboard of the dash and its top to the rear: where a
  // soldier at the doorway sets it in one hand.
  const rack = mark(body, 'rifle rack', [-0.93, 0.95, 0.64]);
  rack.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
  // (left of the wheel's centre as the driver sees it is −X: the wheel faces back, turned half round)
  // (each a handle: the rim, its thumb up along it, the palm on the rim's back and outside, facing mostly away from the driver and a
  // little in toward the hub; the thumb's pad on the rim's face toward the driver, THUMB further up it)
  const grip = (side: -1 | 1) => {
    const name = side < 0 ? 'left' : 'right', on = (angle: number, radius: number, z: number): Point => [side * radius * Math.cos(angle), radius * Math.sin(angle), z];
    const thumb = mark(steering, `${name} thumb`, on(TEN_TO_TWO + THUMB, RIM - 0.004, 0.017));
    // (the fingers point out from the rim and a little away from the driver: square to the rim and to the palm)
    const palm = new Vector3(-side * 0.4, 0, -0.9).normalize(), fingers = new Vector3(side * -palm.z, 0, side * palm.x);
    const at = mark(steering, `${name} grip`, on(TEN_TO_TWO, RIM + HOLD.out * fingers.x * side, HOLD.out * fingers.z));
    at.rotation.z = side * TEN_TO_TWO;
    Object.assign(at.userData, { handle: [0, 1, 0], palm: palm.toArray(), radius: HOLD.radius, fingers: { thumb: thumb.name } });
    return at;
  };
  /** an empty a hand holds as a handle along `axis` (its thumb toward the axis's end), its palm facing onto it along `palm`, `radius` thick;
   * each digit in `pads`, if given, reaching its pad to the empty named */
  const holdable = (name: string, at: Point, axis: Point, palm: Point, radius: number, pads?: Record<string, string>) => {
    const empty = mark(body, name, at);
    Object.assign(empty.userData, { handle: axis, palm, radius }, pads && { fingers: pads });
    return empty;
  };
  const marks = {
    /** where the driver's hips sit */
    seat: mark(body, 'driver seat', [DRIVER, 1.09, -0.11]),
    /** where each ankle rests: the left beside the clutch, the right on the accelerator */
    pedals: { left: mark(body, 'clutch', [DRIVER + 0.14, 0.73, 0.47]), right: mark(body, 'accelerator', [DRIVER - 0.07, 0.75, 0.48]) },
    /** where the hands hold the rim, ten to two, each turned with it: +Y along the rim upward, +Z out of the wheel's face */
    grips: { left: grip(-1), right: grip(1) },
    /** the grab handle's upright behind the windscreen's right pillar, held from the doorway as the forearm reaches it, in and forward:
     * thumb up along the pillar's lean, the palm on its outboard front facing in and back, the fingers round its inboard side, the
     * thumb's pad on its outboard back above them */
    handle: holdable('grab handle', [-0.86, 1.475, 0.622 - GRAB.standoff], [0, 1, -0.117], [0.6, 0, -0.8], 0.012,
      { thumb: mark(body, 'handle thumb', [-0.876, 1.52, 0.622 - GRAB.standoff - 0.017]).name }),
    /** the dash's top at its outboard end, leant on getting in as the forearm comes onto it from inboard: the palm flat on it, facing
     * down, the fingers out over its end (the line across the palm 15° off square to them, as a grasp's is, so the knuckles lie along
     * the end) and closing down round it, the thumb's pad on it toward its back edge */
    dash: holdable('dash top', [-0.848, 1.115, 0.5], [-0.09, 0, -1], [0, -1, 0], 0.003, { thumb: mark(body, 'dash thumb', [-0.81, 1.12, 0.46]).name }),
    rack,
    /** the engine under the bonnet, where it is heard from */
    engine: mark(body, 'engine', [0, 0.85, 1.35]),
    /** where the driver stands to get in, on the ground beside the front of the doorway, facing forward: a standing capsule's width off the hull */
    door: mark(body, 'doorway', [-1.21, 0, 0.42]),
  };

  return {
    body, wheels, steering, marks,
    dispose() {
      body.removeFromParent();
      const geometries = new Set<BufferGeometry>();
      body.traverse((node) => { if (node instanceof Mesh) geometries.add(node.geometry); });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

/** The worn-metal maps from @drawcall/market's metal-01, tinted by each paint's colour. */
export async function loadPaintMaps() {
  const loader = new TextureLoader();
  const load = async (name: string) => {
    const texture = await loader.loadAsync(`textures/metal-${name}.png`);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.anisotropy = 8;
    return texture;
  };
  const [color, normal, roughness, occlusion] = await Promise.all([load('baseColor'), load('normal'), load('roughness'), load('ambientOcclusion')]);
  color.colorSpace = SRGBColorSpace;
  return {
    color, normal, roughness, occlusion,
    dispose() { for (const texture of [color, normal, roughness, occlusion] satisfies Texture[]) texture.dispose(); },
  };
}

interface HullMaterials {
  paint: MeshStandardMaterial; black: MeshStandardMaterial; plastic: MeshStandardMaterial; canvas: MeshStandardMaterial; steel: MeshStandardMaterial;
  mirror: MeshStandardMaterial; lamp: MeshStandardMaterial; red: MeshStandardMaterial; amber: MeshStandardMaterial; dial: MeshStandardMaterial;
}

function hullParts(p: Parts, m: HullMaterials) {
  const front = WHEELBASE / 2, rear = -WHEELBASE / 2;
  const rivets = (x: number, y: number, from: number, to: number) => {
    for (let z = from; z <= to; z += 0.09) p.pin(0.006, 0.01, [x, y, z], m.paint);
  };
  // Chassis rails, axles with their differentials, gearbox, fuel tank and exhaust under the body.
  for (const side of [1, -1]) p.box([0.1, 0.17, 4.2], [side * 0.43, 0.5, 0.05], m.black);
  for (const z of [front, rear]) {
    p.pin(0.055, TRACK - 0.2, [0, CHASSIS.radius, z], m.black);
    p.shape(new CylinderGeometry(0.13, 0.13, 0.2, 18).rotateZ(Math.PI / 2), [0.12, CHASSIS.radius, z], m.black);
  }
  p.box([0.55, 0.3, 0.6], [0, 0.48, 0.5], m.black);
  p.box([0.5, 0.22, 0.7], [0.48, 0.5, -0.8], m.black);
  p.rod(0.03, [-0.3, 0.38, 0.3], [-0.55, 0.36, -2.15], m.black);

  // Front wings: flat tops, sides cut round the front wheels with flared arches, the lamp panels at their noses.
  const wing: Profile = [[2.02, 0.7], [2.02, 1.06], [0.7, 1.06], [0.7, FLOOR], [0.9, FLOOR], ...arch(front, 0.7), [2.02, 0.7]];
  for (const side of [1, -1]) {
    p.profile(wing, 0.014, [side * 0.888, 0, 0], m.paint, [], 0.004);
    p.profile(arch(front, 0.7, 0.07), 0.05, [side * 0.905, 0, 0], m.plastic, [], 0.006);
    p.box([0.33, 0.035, 1.33], [side * 0.725, 1.045, 1.36], m.paint, 0.008);
    p.box([0.025, 0.02, 1.33], [side * 0.89, 1.065, 1.36], m.paint, 0.006);
    p.box([0.012, 0.3, 1.25], [side * 0.565, 0.9, 1.36], m.black);
    rivets(side * 0.896, 1.04, 0.75, 2.0);
    p.box([0.33, 0.36, 0.03], [side * 0.725, 0.88, 2.02], m.paint, 0.006);
    p.tube(0.1, 0.084, 0.04, [side * 0.71, 0.92, 2.04], m.steel);
    p.shape(new CylinderGeometry(0.086, 0.086, 0.02, 24).rotateX(Math.PI / 2), [side * 0.71, 0.92, 2.045], m.lamp);
    p.box([0.07, 0.05, 0.02], [side * 0.79, 0.77, 2.04], m.amber, 0.005);
    p.box([0.07, 0.05, 0.02], [side * 0.64, 0.77, 2.04], m.lamp, 0.005);
  }
  // Bonnet with its hinges and the spare wheel's clamp, the grille between the wings and the bumper with its towing eyes.
  p.box([1.1, 0.05, 1.22], [0, 1.08, 1.38], m.paint, 0.012);
  p.box([1.0, 0.012, 0.02], [0, 1.106, 1.98], m.paint, 0.004);
  for (const x of [-0.42, 0.42]) p.pin(0.014, 0.12, [x, 1.1, 0.78], m.steel);
  p.box([0.08, 0.05, 0.08], [0, 1.12, 1.42], m.black, 0.01);
  p.box([1.1, 0.38, 0.04], [0, 0.86, 2.0], m.plastic, 0.01);
  for (let i = 0; i < 9; i++) p.box([1.0, 0.012, 0.03], [0, 0.71 + i * 0.035, 2.02], m.black, 0.004);
  p.box([1.94, 0.17, 0.14], [0, 0.57, 2.12], m.black, 0.012);
  for (const side of [1, -1]) {
    p.tube(0.04, 0.022, 0.03, [side * 0.55, 0.47, 2.18], m.black);
    p.box([0.06, 0.1, 0.12], [side * 0.55, 0.52, 2.15], m.black);
  }
  p.box([0.42, 0.1, 0.012], [0, 0.57, 2.195], m.plastic, 0.002);

  // Bulkhead and footwells, the scuttle with its vents, the dash shelf with the driver's binnacle, the windscreen frame with its hinges,
  // clamps and wipers, and a mirror on an arm from each pillar.
  p.box([1.76, 0.36, 0.05], [0, 0.8, 0.79], m.paint);
  p.box([1.78, 0.1, 0.16], [0, 1.08, 0.7], m.paint, 0.01);
  for (const side of [1, -1]) p.box([0.4, 0.012, 0.08], [side * 0.45, 1.135, 0.7], m.black, 0.003);
  p.box([1.72, 0.17, 0.2], [0, 1.03, 0.55], m.paint, 0.012);
  p.box([1.7, 0.03, 0.04], [0, 0.95, 0.46], m.paint, 0.006);
  p.box([0.32, 0.13, 0.08], [DRIVER, 1.06, 0.43], m.plastic, 0.02);
  for (const x of [DRIVER + 0.075, DRIVER - 0.075]) {
    p.shape(new CylinderGeometry(0.045, 0.045, 0.01, 24).rotateX(Math.PI / 2 - 0.35), [x, 1.07, 0.39], m.dial);
    p.shape(new TorusGeometry(0.047, 0.006, 8, 24).rotateX(-0.35), [x, 1.07, 0.388], m.steel);
  }
  for (let i = 0; i < 4; i++) p.box([0.04, 0.02, 0.03], [0.1 + i * 0.07, 0.99, 0.45], m.plastic, 0.005);
  for (const side of [1, -1]) p.box([0.07, 0.5, 0.16], [side * 0.855, 0.87, 0.7], m.paint, 0.01);
  const base: Point = [0, 1.15, 0.66], top: Point = [0, 1.92, 0.57];
  p.box([1.76, 0.05, 0.05], base, m.paint, 0.01);
  p.box([1.76, 0.05, 0.05], top, m.paint, 0.01);
  for (const side of [1, -1]) {
    p.rod(0.026, [side * 0.86, base[1], base[2]], [side * 0.86, top[1], top[2]], m.paint);
    p.box([0.06, 0.05, 0.08], [side * 0.82, 1.13, 0.7], m.steel, 0.01);
    p.box([0.03, 0.06, 0.05], [side * 0.88, 1.65, 0.6], m.steel, 0.008);
    p.rod(0.007, [side * 0.12, 1.18, 0.64], [side * 0.48, 1.27, 0.62], m.black);
    p.rod(0.009, [side * 0.88, 1.6, 0.6], [side * 0.99, 1.62, 0.59], m.black);
    p.rod(0.009, [side * 0.99, 1.62, 0.59], [side * 1.03, 1.67, 0.59], m.black);
    p.box([0.12, 0.15, 0.025], [side * 1.06, 1.72, 0.59], m.plastic, 0.012);
    p.box([0.105, 0.135, 0.004], [side * 1.06, 1.72, 0.576], m.mirror, 0.002);
  }
  // The driver's grab handle on its pillar: an upright standing off the pillar's back on two brackets, a hand's fingers clear between them.
  for (const [y, z] of [[1.38, 0.633], [1.57, 0.611]] as const) p.rod(0.012, [-0.86, y, z], [-0.86, y, z - GRAB.standoff], m.black);
  p.rod(0.012, [-0.86, 1.38, 0.633 - GRAB.standoff], [-0.86, 1.57, 0.611 - GRAB.standoff], m.black);
  // The rifle rack: a bracket down the dash's side with a butt cup and a sprung clamp at the barrel.
  p.box([0.03, 0.66, 0.05], [-0.915, 0.95, 0.7], m.black, 0.008);
  p.box([0.08, 0.03, 0.14], [-0.96, 0.62, 0.66], m.black, 0.01);
  p.box([0.08, 0.04, 0.08], [-0.96, 1.28, 0.67], m.black, 0.01);

  // Cab: floor, transmission tunnel and levers, the sills with their stepping plates on brackets, the seat box and seats.
  p.box([1.7, 0.04, 1.3], [0, 0.6, 0.15], m.plastic, 0.01);
  p.box([0.32, 0.22, 0.7], [0, 0.71, 0.35], m.plastic, 0.03);
  p.rod(0.011, [0.07, 0.8, 0.3], [0.05, 1.12, 0.16], m.steel);
  p.shape(new CylinderGeometry(0.025, 0.025, 0.05, 12), [0.05, 1.13, 0.16], m.plastic);
  p.rod(0.009, [0.13, 0.8, 0.22], [0.15, 1.03, 0.12], m.steel);
  p.shape(new CylinderGeometry(0.02, 0.02, 0.04, 12), [0.15, 1.05, 0.12], m.red);
  for (const side of [1, -1]) {
    p.box([0.07, 0.3, 1.24], [side * 0.86, 0.53, 0.12], m.paint, 0.012);
    p.box([0.025, 0.02, 1.2], [side * 0.89, FLOOR + 0.06, 0.12], m.paint, 0.006);
    rivets(side * 0.896, 0.45, -0.4, 0.6);
    p.box([0.2, 0.025, 0.3], [side * 0.97, 0.37, 0.12], m.black, 0.006);
    for (const z of [0.0, 0.24]) p.box([0.12, 0.12, 0.03], [side * 0.92, 0.42, z], m.black, 0.006);
  }
  // Pedals hung from under the dash: the clutch, the brake and, by the driver's right foot, the accelerator.
  for (const [x, w] of [[DRIVER + 0.14, 0.07], [DRIVER + 0.02, 0.07], [DRIVER - 0.07, 0.05]] as const) {
    p.box([w, 0.1, 0.015], [x, 0.76, 0.58], m.black, 0.004);
    p.rod(0.008, [x, 0.81, 0.585], [x, 0.95, 0.6], m.black);
  }
  p.box([1.74, 0.24, 0.5], [0, 0.73, -0.22], m.paint, 0.012);
  for (const x of [DRIVER, -DRIVER]) {
    p.box([0.5, 0.1, 0.47], [x, 0.9, -0.2], m.canvas, 0.04);
    p.shape(new RoundedBoxGeometry(0.48, 0.42, 0.08, 2, 0.035).rotateX(-0.14), [x, 1.17, -0.46], m.canvas);
    p.box([0.44, 0.025, 0.03], [x, 0.945, 0.04], m.black, 0.006);
  }
  p.box([0.3, 0.06, 0.4], [0, 0.88, -0.2], m.canvas, 0.02);

  // Rear tub: sides cut round the rear wheels with capping strips, inner wheel boxes with troop benches, floor, tailgate, lamps and
  // jerrycans.
  const tub: Profile = [[-0.47, FLOOR], [-0.47, 1.1], [-2.06, 1.1], [-2.06, FLOOR], ...arch(rear, FLOOR), [-0.47, FLOOR]];
  for (const side of [1, -1]) {
    p.profile(tub, 0.014, [side * 0.888, 0, 0], m.paint, [], 0.004);
    p.profile(arch(rear, FLOOR, 0.07), 0.05, [side * 0.905, 0, 0], m.plastic, [], 0.006);
    p.box([0.08, 0.035, 1.62], [side * 0.86, 1.115, -1.27], m.paint, 0.01);
    rivets(side * 0.896, 1.06, -2.0, -0.55);
    p.box([0.02, 0.46, 1.56], [side * 0.84, 0.86, -1.27], m.paint);
    p.box([0.3, 0.28, 1.0], [side * 0.68, 0.76, rear], m.paint, 0.02);
    p.box([0.3, 0.07, 0.95], [side * 0.66, 0.935, rear], m.canvas, 0.025);
    p.box([0.08, 0.15, 0.025], [side * 0.79, 0.8, -2.075], m.red, 0.006);
    p.box([0.08, 0.06, 0.025], [side * 0.79, 0.69, -2.075], m.amber, 0.006);
    p.pin(0.02, 0.05, [side * 0.8, 1.02, -2.07], m.steel);
  }
  p.box([1.7, 0.04, 1.6], [0, 0.6, -1.27], m.plastic, 0.01);
  p.box([1.66, 0.48, 0.045], [0, 0.85, -2.06], m.paint, 0.01);
  for (let i = 0; i < 3; i++) p.box([1.6, 0.02, 0.012], [0, 0.72 + i * 0.13, -2.088], m.paint, 0.004);
  p.box([1.75, 0.14, 0.12], [0, 0.52, -2.1], m.black, 0.012);
  p.box([0.25, 0.1, 0.06], [0, 0.5, -2.18], m.black, 0.01);
  for (const x of [0.5, 0.26]) {
    p.box([0.165, 0.46, 0.34], [x, 0.85, -1.84], m.paint, 0.02);
    p.box([0.17, 0.02, 0.34], [x, 0.9, -1.84], m.paint, 0.006);
    for (const dx of [-0.05, 0, 0.05]) p.rod(0.008, [x + dx, 1.08, -1.76], [x + dx, 1.12, -1.84], m.paint);
  }

  // Roll bar behind the front seats, braced back to the tub's rear corners, and the radio's whip aerial.
  const hoop = -0.6, high = 1.86;
  for (const side of [1, -1]) {
    p.rod(0.026, [side * 0.8, 1.1, hoop], [side * 0.8, high - 0.06, hoop - 0.02], m.black);
    p.rod(0.026, [side * 0.8, high - 0.06, hoop - 0.02], [side * 0.74, high, hoop - 0.03], m.black);
    p.rod(0.022, [side * 0.8, high - 0.08, hoop - 0.04], [side * 0.8, 1.12, -1.98], m.black);
    p.box([0.1, 0.03, 0.1], [side * 0.8, 1.12, hoop], m.black, 0.008);
  }
  p.rod(0.026, [0.74, high, hoop - 0.03], [-0.74, high, hoop - 0.03], m.black);
  p.box([0.08, 0.08, 0.08], [-0.78, 1.15, -1.98], m.black, 0.01);
  p.rod(0.005, [-0.78, 1.18, -1.98], [-0.74, 3.1, -2.0], m.black);
}

/** A body side's lower edge round a wheel arch, rear to front, where that edge is at `bottom`: Land Rover's flat-topped cut-out with
 * rounded corners, clearing the tyre at full bump; with `flare`, the band of that width round the arch. */
function arch(z: number, bottom: number, flare = 0): [number, number][] {
  const half = ARCH + flare, top = CHASSIS.radius + ARCH + flare, corner = ARCH_CORNER + flare;
  const points: [number, number][] = [[z - half, bottom]];
  for (const [x, start] of [[z - half + corner, Math.PI], [z + half - corner, Math.PI / 2]] as const) {
    for (let i = 0; i <= 8; i++) {
      const angle = start - Math.PI / 2 * i / 8;
      points.push([x + corner * Math.cos(angle), top - corner + corner * Math.sin(angle)]);
    }
  }
  points.push([z + half, bottom]);
  return flare ? [...points, ...arch(z, bottom).reverse()] : points;
}
