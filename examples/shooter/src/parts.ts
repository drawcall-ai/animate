import {
  BufferAttribute, BufferGeometry, CylinderGeometry, ExtrudeGeometry, LatheGeometry, Mesh, Path, Quaternion, Shape, Vector2, Vector3,
  type Material, type Object3D,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type Point = readonly [x: number, y: number, z: number];
export type Profile = readonly (readonly [z: number, y: number])[];

/** Static detail built in metres and merged by material, one draw call each. */
export class Parts {
  private readonly parts = new Map<Material, BufferGeometry[]>();

  box(size: Point, at: Point, material: Material, round = Math.min(...size) * 0.18) {
    this.shape(new RoundedBoxGeometry(...size, 1, round), at, material);
  }

  /** `outline` in the YZ plane, extruded `width` along X. */
  profile(outline: Profile, width: number, at: Point, material: Material, holes: readonly Profile[] = [], bevel = 0.001) {
    const points = (profile: Profile) => profile.map(([z, y]) => new Vector2(-z, y));
    const shape = new Shape(points(outline));
    shape.holes = holes.map(hole => new Path(points(hole)));
    const geometry = new ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: bevel, bevelThickness: bevel });
    geometry.translate(0, 0, -width / 2).rotateY(Math.PI / 2);
    this.shape(geometry, at, material);
  }

  /** A hollow tube along Z. */
  tube(radius: number, bore: number, length: number, at: Point, material: Material) {
    const half = length / 2;
    const section = [[bore, -half], [radius, -half], [radius, half], [bore, half], [bore, -half]].map(([x, y]) => new Vector2(x, y));
    this.shape(new LatheGeometry(section, 24).rotateX(Math.PI / 2), at, material);
  }

  /** A solid cylinder along X. */
  pin(radius: number, length: number, at: Point, material: Material) {
    this.shape(new CylinderGeometry(radius, radius, length, 12).rotateZ(Math.PI / 2), at, material);
  }

  /** A solid bar of `radius` from `from` to `to`. */
  rod(radius: number, from: Point, to: Point, material: Material) {
    const a = new Vector3(...from), b = new Vector3(...to), along = b.clone().sub(a);
    const geometry = new CylinderGeometry(radius, radius, along.length(), 14);
    geometry.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), along.normalize()));
    this.shape(geometry, a.add(b).multiplyScalar(0.5).toArray(), material);
  }

  /** Any geometry, moved to `at`. */
  shape(geometry: BufferGeometry, at: Point, material: Material) {
    geometry.translate(...at);
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    const batch = this.parts.get(material) ?? [];
    batch.push(flat);
    this.parts.set(material, batch);
  }

  /** Adds the merged meshes to `parent` and starts afresh. With `tile` (m), textures are projected along each face's main axis at that size, so every
   * part shares one texel density instead of stretching a whole texture over each face. */
  finish(parent: Object3D, tile?: number) {
    for (const [material, geometries] of this.parts) {
      const merged = mergeGeometries(geometries);
      if (!merged) throw new Error(`Could not build ${material.name}`);
      if (tile) project(merged, tile);
      const mesh = new Mesh(merged, material);
      mesh.name = material.name;
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
      for (const geometry of geometries) geometry.dispose();
    }
    this.parts.clear();
  }
}

function project(geometry: BufferGeometry, tile: number) {
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const nx = Math.abs(normal.getX(i)), ny = Math.abs(normal.getY(i)), nz = Math.abs(normal.getZ(i));
    const [u, v] = nx >= ny && nx >= nz ? [position.getZ(i), position.getY(i)] : ny >= nz ? [position.getX(i), position.getZ(i)] : [position.getX(i), position.getY(i)];
    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = v / tile;
  }
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
}
