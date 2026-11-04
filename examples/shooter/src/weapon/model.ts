import {
  BufferGeometry, CylinderGeometry, DataTexture, ExtrudeGeometry, LatheGeometry,
  Mesh, MeshStandardMaterial, Object3D, Path, RepeatWrapping, RGBAFormat,
  Shape, UnsignedByteType, Vector2,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type Point = readonly [x: number, y: number, z: number];
type Profile = readonly (readonly [z: number, y: number])[];

/** A compact carbine built in metres; geometry stays independent of its animation. */
export class WeaponModel {
  private readonly grain = grain();
  private readonly metal = new MeshStandardMaterial({ name: 'Anodized receiver', color: '#343d43', metalness: 0.85, roughness: 0.36, envMapIntensity: 2.8, bumpMap: this.grain, bumpScale: 0.00007 });
  private readonly steel = new MeshStandardMaterial({ name: 'Machined steel', color: '#7e898f', metalness: 1, roughness: 0.27, envMapIntensity: 2.8 });
  private readonly dark = new MeshStandardMaterial({ name: 'Phosphated barrel', color: '#252b30', metalness: 0.9, roughness: 0.44, envMapIntensity: 2.8 });
  private readonly polymer = new MeshStandardMaterial({ name: 'Moulded polymer', color: '#282c2c', metalness: 0, roughness: 0.72, bumpMap: this.grain, bumpScale: 0.00025 });
  private readonly rubber = new MeshStandardMaterial({ name: 'Rubber pad', color: '#151919', metalness: 0, roughness: 0.94 });
  private readonly inset = new MeshStandardMaterial({ name: 'Recesses', color: '#101416', metalness: 0.35, roughness: 0.65 });

  rifle(parent: Object3D, arms: number) {
    const p = new Parts();
    // Bevelled upper/lower receiver, magwell, ejection port and bolt carrier.
    p.profile([[-0.095, 0.045], [-0.095, 0.084], [-0.07, 0.099], [0.26, 0.099], [0.285, 0.079], [0.275, 0.035], [0.025, 0.032]], 0.06, [0, 0, 0], this.metal);
    p.profile([[-0.073, 0.034], [0.163, 0.034], [0.161, -0.047], [0.125, -0.069], [0.058, -0.055], [0.052, -0.003], [-0.058, -0.006]], 0.052, [0, 0, 0], this.metal);
    p.box([0.002, 0.021, 0.092], [0.032, 0.068, 0.12], this.inset);
    p.box([0.0025, 0.013, 0.057], [0.0335, 0.069, 0.104], this.steel);
    p.box([0.003, 0.006, 0.093], [0.034, 0.053, 0.12], this.dark);
    p.box([0.011, 0.016, 0.032], [0.036, 0.07, 0.046], this.metal);
    p.box([0.072, 0.008, 0.015], [0, 0.092, -0.087], this.dark);

    // Free-floating handguard: real openings, a visible barrel inside, and a continuous top rail.
    const vents: Profile[] = [0, 1, 2].map(i => [[0.29 + i * 0.06, 0.045], [0.333 + i * 0.06, 0.045], [0.333 + i * 0.06, 0.068], [0.29 + i * 0.06, 0.068]]);
    for (const side of [-1, 1]) {
      p.profile([[0.265, 0.032], [0.28, 0.021], [0.493, 0.021], [0.506, 0.038], [0.506, 0.081], [0.49, 0.094], [0.267, 0.094]], 0.004, [side * 0.032, 0, 0], this.metal, vents);
      p.box([0.006, 0.012, 0.22], [side * 0.025, 0.027, 0.382], this.dark);
      p.box([0.005, 0.012, 0.22], [side * 0.025, 0.087, 0.382], this.metal);
      for (let i = 0; i < 5; i++) p.box([0.007, 0.014, 0.018], [side * 0.035, 0.031, 0.289 + i * 0.043], this.polymer);
    }
    p.tube(0.011, 0.006, 0.39, [0, 0.06, 0.425], this.dark);
    p.tube(0.018, 0.011, 0.025, [0, 0.06, 0.511], this.metal);
    p.tube(0.0135, 0.009, 0.012, [0, 0.06, 0.614], this.steel);
    p.tube(0.017, 0.007, 0.055, [0, 0.06, 0.65], this.dark);
    for (let i = 0; i < 3; i++) {
      p.box([0.024, 0.003, 0.007], [0, 0.076, 0.633 + i * 0.014], this.inset);
      for (const side of [-1, 1]) p.box([0.002, 0.014, 0.007], [side * 0.016, 0.06, 0.633 + i * 0.014], this.inset);
    }
    p.box([0.028, 0.006, 0.55], [0, 0.098, 0.212], this.dark);
    for (let i = 0; i < 31; i++) p.box([0.033, 0.007, 0.009], [0, 0.104, -0.05 + i * 0.0175], this.metal);

    // Grip, open trigger guard and curved trigger.
    p.profile([[-0.028, 0.009], [0.023, 0.007], [0.018, -0.035], [-0.006, -0.137], [-0.048, -0.128], [-0.04, -0.051]], 0.039, [0, 0, 0], this.polymer);
    for (const side of [-1, 1]) for (let i = 0; i < 6; i++)
      p.box([0.002, 0.0025, 0.031], [side * 0.021, -0.037 - i * 0.014, -0.008 - i * 0.003], this.rubber);
    p.profile([[0.018, -0.005], [0.08, -0.005], [0.083, -0.047], [0.067, -0.067], [0.025, -0.057]], 0.014, [0, 0, 0], this.dark,
      [[[0.028, -0.015], [0.069, -0.015], [0.071, -0.043], [0.062, -0.055], [0.032, -0.048]]]);
    p.profile([[0.037, -0.009], [0.044, -0.01], [0.044, -0.031], [0.052, -0.044], [0.045, -0.045], [0.036, -0.03]], 0.006, [0, 0, 0], this.steel);

    // Buffer tube and adjustable stock. Its length follows the soldier's reach.
    const back = -0.24 * arms;
    p.tube(0.018, 0.012, Math.abs(back + 0.075), [0, 0.064, (back - 0.075) / 2], this.dark);
    p.profile([[back - 0.04, 0.087], [-0.12, 0.087], [-0.12, 0.047], [back + 0.015, -0.049], [back - 0.04, -0.061]], 0.05, [0, 0, 0], this.polymer,
      [[[back + 0.003, 0.033], [-0.15, 0.033], [back + 0.003, -0.025]]]);
    p.box([0.056, 0.154, 0.017], [0, 0.013, back - 0.044], this.rubber);
    for (let i = 0; i < 9; i++) p.box([0.058, 0.003, 0.003], [0, -0.05 + i * 0.016, back - 0.054], this.polymer);
    p.box([0.055, 0.009, 0.045], [0, 0.005, back + 0.055], this.dark);

    // Steel hardware, selector and sight adjustments break up the flat receiver surfaces.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) p.box([0.0008, 0.0008, 0.012], [side * 0.0308, 0.093, 0.019 + i * 0.073], this.steel);
      for (const [z, y] of [[-0.055, 0.022], [0.055, 0.018], [0.235, 0.062], [0.274, 0.079]]) {
        p.pin(0.0045, 0.004, [side * 0.033, y, z], this.steel);
        p.box([0.0008, 0.0014, 0.006], [side * 0.0355, y, z], this.inset);
      }
      p.pin(0.009, 0.004, [side * 0.029, 0.016, -0.025], this.dark);
      p.box([0.005, 0.005, 0.022], [side * 0.032, 0.015, -0.035], this.steel);
      p.box([0.004, 0.026, 0.013], [side * 0.015, 0.12, 0], this.dark);
    }
    p.box([0.027, 0.003, 0.013], [0, 0.1345, 0], this.dark);
    p.box([0.027, 0.003, 0.013], [0, 0.1055, 0], this.dark);
    p.pin(0.007, 0.007, [0.022, 0.118, 0], this.steel);
    p.box([0.003, 0.025, 0.006], [0, 0.1075, 0.475], this.dark);
    for (const side of [-1, 1]) p.box([0.003, 0.033, 0.008], [side * 0.009, 0.111, 0.475], this.metal);
    p.finish(parent);
  }

  magazine(parent: Object3D) {
    const p = new Parts();
    p.profile([[-0.029, 0.074], [0.033, 0.074], [0.037, 0.009], [0.023, -0.069], [0.014, -0.081], [-0.047, -0.07], [-0.036, -0.008]], 0.028, [0, 0, 0], this.metal);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) p.profile([[i * 0.016 - 0.024, 0.048], [i * 0.016 - 0.02, 0.048], [i * 0.016 - 0.026, -0.056], [i * 0.016 - 0.03, -0.056]], 0.001, [side * 0.015, 0, 0], this.dark);
      p.box([0.002, 0.008, 0.06], [side * 0.015, 0.046, 0], this.steel);
    }
    p.box([0.034, 0.009, 0.067], [0, -0.076, -0.015], this.polymer);
    p.finish(parent);
  }

  dispose() {
    for (const material of [this.metal, this.steel, this.dark, this.polymer, this.rubber, this.inset]) material.dispose();
    this.grain.dispose();
  }
}

/** Merge static detail by finish, keeping the rifle to six draw calls. */
class Parts {
  private readonly parts = new Map<MeshStandardMaterial, BufferGeometry[]>();

  box(size: Point, at: Point, material: MeshStandardMaterial) {
    const radius = Math.min(...size) * 0.18;
    this.add(new RoundedBoxGeometry(...size, 1, radius), at, material);
  }

  profile(outline: Profile, width: number, at: Point, material: MeshStandardMaterial, holes: readonly Profile[] = []) {
    const points = (profile: Profile) => profile.map(([z, y]) => new Vector2(-z, y));
    const shape = new Shape(points(outline));
    shape.holes = holes.map(hole => new Path(points(hole)));
    const geometry = new ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.001, bevelThickness: 0.001 });
    geometry.translate(0, 0, -width / 2).rotateY(Math.PI / 2);
    this.add(geometry, at, material);
  }

  tube(radius: number, bore: number, length: number, at: Point, material: MeshStandardMaterial) {
    const half = length / 2;
    const section = [[bore, -half], [radius, -half], [radius, half], [bore, half], [bore, -half]].map(([x, y]) => new Vector2(x, y));
    this.add(new LatheGeometry(section, 24).rotateX(Math.PI / 2), at, material);
  }

  pin(radius: number, length: number, at: Point, material: MeshStandardMaterial) {
    this.add(new CylinderGeometry(radius, radius, length, 12).rotateZ(Math.PI / 2), at, material);
  }

  finish(parent: Object3D) {
    for (const [material, geometries] of this.parts) {
      const merged = mergeGeometries(geometries);
      if (!merged) throw new Error(`Could not build ${material.name}`);
      const mesh = new Mesh(merged, material);
      mesh.name = material.name;
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
      for (const geometry of geometries) geometry.dispose();
    }
  }

  private add(geometry: BufferGeometry, at: Point, material: MeshStandardMaterial) {
    geometry.translate(...at);
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    const batch = this.parts.get(material) ?? [];
    batch.push(flat);
    this.parts.set(material, batch);
  }
}

function grain() {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const value = 110 + ((Math.imul(i + 1, 1597334677) >>> 24) % 35);
    data.set([value, value, value, 255], i * 4);
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(5, 5);
  texture.needsUpdate = true;
  return texture;
}
