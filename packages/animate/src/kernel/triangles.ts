import { Matrix4, Ray, Triangle, Vector3, type BufferGeometry } from 'three';

/** A geometry and the matrix that takes its positions into the frame its triangles are gathered in. */
export interface Placed {
  geometry: BufferGeometry;
  matrix: Matrix4;
}

/**
 * The triangles of `meshes` within `radius` of `centre` (all in one frame: each geometry's positions taken through its matrix), gathered
 * once, for many rays cast near there: a hand closing on a handle tests a few hundred, not the whole thing's thousands.
 */
export class Triangles {
  private readonly corners: Float32Array;

  constructor(meshes: readonly Placed[], centre: Readonly<Vector3>, radius: number) {
    const kept: number[] = [], a = new Vector3(), b = new Vector3(), c = new Vector3(), triangle = new Triangle(), nearest = new Vector3();
    for (const { geometry, matrix } of meshes) {
      const position = geometry.getAttribute('position'), index = geometry.index, count = index ? index.count : position.count;
      const at = (k: number, out: Vector3) => out.fromBufferAttribute(position, index ? index.getX(k) : k).applyMatrix4(matrix);
      for (let k = 0; k < count; k += 3) {
        at(k, a); at(k + 1, b); at(k + 2, c);
        // (by its nearest point, not its corners: a stile's long side has its corners metres away)
        if (triangle.set(a, b, c).closestPointToPoint(centre, nearest).distanceTo(centre) > radius) continue;
        kept.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      }
    }
    this.corners = new Float32Array(kept);
  }

  /** how far along `ray` it first meets a triangle, either face, within `far` (none: it meets none) */
  first(ray: Readonly<Ray>, far: number): number | null {
    let nearest = far, met = false;
    const c = this.corners;
    for (let k = 0; k < c.length; k += 9) {
      _a.set(c[k], c[k + 1], c[k + 2]); _b.set(c[k + 3], c[k + 4], c[k + 5]); _c.set(c[k + 6], c[k + 7], c[k + 8]);
      if (!ray.intersectTriangle(_a, _b, _c, false, _hit)) continue;
      const distance = _hit.distanceTo(ray.origin);
      if (distance <= nearest) [nearest, met] = [distance, true];
    }
    return met ? nearest : null;
  }
}

const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _hit = new Vector3();
