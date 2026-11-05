import { Matrix4, Ray, Triangle, Vector3, type BufferGeometry } from 'three';

/** A geometry and the matrix that takes its positions into the frame its triangles are gathered in. */
export interface PlacedGeometry {
  geometry: BufferGeometry;
  matrix: Matrix4;
}

/**
 * The triangles of `meshes` within `radius` of `centre` (all in one frame: each geometry's positions taken through its matrix), gathered
 * once, for many rays cast near there: a hand closing on a handle tests a few hundred, not the whole thing's thousands.
 */
export class Triangles {
  private readonly corners: Float32Array;
  /** each triangle's bounds (least x, y, z, then most), so a short ray skips those it cannot meet */
  private readonly bounds: Float32Array;
  /** all of theirs, as far as a ray from inside them goes to leave them */
  private readonly extent = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);

  constructor(meshes: readonly PlacedGeometry[], centre: Readonly<Vector3>, radius: number) {
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
    this.bounds = new Float32Array((kept.length / 9) * 6);
    for (let k = 0, t = 0; k < kept.length; k += 9, t += 6) for (let axis = 0; axis < 3; axis++) {
      this.bounds[t + axis] = Math.min(kept[k + axis], kept[k + 3 + axis], kept[k + 6 + axis]);
      this.bounds[t + 3 + axis] = Math.max(kept[k + axis], kept[k + 3 + axis], kept[k + 6 + axis]);
      this.extent[axis] = Math.min(this.extent[axis], this.bounds[t + axis]);
      this.extent[3 + axis] = Math.max(this.extent[3 + axis], this.bounds[t + 3 + axis]);
    }
  }

  /** how far along `ray` it first meets a triangle, either face, within `far` (none: it meets none) */
  first(ray: Readonly<Ray>, far: number): number | null {
    const [k, distance] = this.met(ray, far);
    return k < 0 ? null : distance;
  }

  /**
   * whether `ray` starts inside the meshes: the first triangle it meets is met from behind, its corners wound clockwise as seen from the
   * ray (a closed mesh's faces wound outward, as three.js builds them); meeting none, outside
   */
  inside(ray: Readonly<Ray>): boolean {
    // (as far as the triangles' furthest bounds from where it starts)
    const e = this.extent, o = ray.origin;
    const far = Math.hypot(Math.max(Math.abs(o.x - e[0]), Math.abs(o.x - e[3])), Math.max(Math.abs(o.y - e[1]), Math.abs(o.y - e[4])), Math.max(Math.abs(o.z - e[2]), Math.abs(o.z - e[5])));
    const [k] = this.met(ray, far), c = this.corners;
    if (k < 0) return false;
    _a.set(c[k], c[k + 1], c[k + 2]); _b.set(c[k + 3], c[k + 4], c[k + 5]); _c.set(c[k + 6], c[k + 7], c[k + 8]);
    return _normal.crossVectors(_b.sub(_a), _c.sub(_a)).dot(ray.direction) > 0;
  }

  /** the first triangle `ray` meets within `far`, by its first corner's index (-1: none), and how far along it */
  private met(ray: Readonly<Ray>, far: number): [number, number] {
    let nearest = far, first = -1;
    const c = this.corners, b = this.bounds, from = ray.origin, to = ray.at(far, _end);
    const least = [Math.min(from.x, to.x), Math.min(from.y, to.y), Math.min(from.z, to.z)];
    const most = [Math.max(from.x, to.x), Math.max(from.y, to.y), Math.max(from.z, to.z)];
    for (let k = 0, t = 0; k < c.length; k += 9, t += 6) {
      if (b[t] > most[0] || b[t + 1] > most[1] || b[t + 2] > most[2] || b[t + 3] < least[0] || b[t + 4] < least[1] || b[t + 5] < least[2]) continue;
      _a.set(c[k], c[k + 1], c[k + 2]); _b.set(c[k + 3], c[k + 4], c[k + 5]); _c.set(c[k + 6], c[k + 7], c[k + 8]);
      if (!ray.intersectTriangle(_a, _b, _c, false, _hit)) continue;
      const distance = _hit.distanceTo(from);
      if (distance <= nearest) [nearest, first] = [distance, k];
    }
    return [first, nearest];
  }
}

const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _hit = new Vector3(), _end = new Vector3(), _normal = new Vector3();
