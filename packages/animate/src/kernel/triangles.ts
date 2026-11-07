import { Matrix4, Ray, Triangle, Vector3, type BufferGeometry } from 'three';

/** A geometry and the matrix that takes its positions into the frame its triangles are gathered in. */
export interface PlacedGeometry {
  geometry: BufferGeometry;
  matrix: Matrix4;
}

/**
 * The triangles of `meshes` within `radius` of `centre` (all in one frame: each geometry's positions taken through its matrix), gathered
 * once, for many rays cast near there: a hand closing on a handle tests a few hundred, not the whole thing's thousands. Hand-rolled
 * rather than three-mesh-bvh: its BufferGeometry augmentation broke type narrowing, and this is ~120 lines with no dependency.
 */
export class Triangles {
  private readonly corners: Float32Array;
  /** each triangle's bounds (least x, y, z, then most), so a short ray skips those it cannot meet */
  private readonly bounds: Float32Array;
  /** all of theirs, as far as a ray from inside them goes to leave them */
  private readonly extent = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  /** its triangles by the cells of a grid over their extent (`gridded`, built for the first `depth`), and when each was last looked at */
  private grid: { size: number[]; cells: number[][] } | null = null;
  private seen = new Uint32Array(0);
  private stamp = 0;

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
   * ray (a closed mesh's faces wound outward, as three.js builds them); meeting none, outside — looked for as far as the triangles'
   * furthest bounds from where it starts, or `within` (m) if that is nearer (a part no thicker than that)
   */
  inside(ray: Readonly<Ray>, within = Infinity): boolean {
    const e = this.extent, o = ray.origin;
    const far = Math.min(within, Math.hypot(Math.max(Math.abs(o.x - e[0]), Math.abs(o.x - e[3])), Math.max(Math.abs(o.y - e[1]), Math.abs(o.y - e[4])), Math.max(Math.abs(o.z - e[2]), Math.abs(o.z - e[5]))));
    const [k] = this.met(ray, far), c = this.corners;
    if (k < 0) return false;
    _a.set(c[k], c[k + 1], c[k + 2]); _b.set(c[k + 3], c[k + 4], c[k + 5]); _c.set(c[k + 6], c[k + 7], c[k + 8]);
    return _normal.crossVectors(_b.sub(_a), _c.sub(_a)).dot(ray.direction) > 0;
  }

  /**
   * How far a ball of `radius` at `point` sinks into the meshes (m; 0 or less: clear of them by as much): its radius less how far the
   * nearest surface is, or its radius more where the point is inside — on the inner side of the nearest triangle (a closed mesh's faces
   * wound outward; of triangles as near as each other, at an edge or a corner, the one the point lies most squarely off). Only triangles
   * within `within` (m) of the point are looked at: a point further than that from every surface reads as clear, inside or not.
   */
  depth(point: Readonly<Vector3>, radius: number, within: number): number {
    const c = this.corners, b = this.bounds, grid = (this.grid ??= this.gridded()), e = this.extent, stamp = ++this.stamp;
    const cell = (value: number, axis: number) => Math.min(grid.size[axis] - 1, Math.max(0, Math.floor((value - e[axis]) / CELL)));
    const p = [point.x, point.y, point.z], from = p.map((v, axis) => cell(v - within, axis)), to = p.map((v, axis) => cell(v + within, axis));
    let nearest = within, off = 0;
    for (let x = from[0]; x <= to[0]; x++) for (let y = from[1]; y <= to[1]; y++) for (let z = from[2]; z <= to[2]; z++) {
      for (const triangle of grid.cells[(x * grid.size[1] + y) * grid.size[2] + z] ?? []) {
        if (this.seen[triangle] === stamp) continue;
        this.seen[triangle] = stamp;
        const k = triangle * 9, t = triangle * 6;
        const dx = Math.max(b[t] - point.x, 0, point.x - b[t + 3]), dy = Math.max(b[t + 1] - point.y, 0, point.y - b[t + 4]), dz = Math.max(b[t + 2] - point.z, 0, point.z - b[t + 5]);
        if (dx * dx + dy * dy + dz * dz > nearest * nearest + 1e-12) continue;
        _a.set(c[k], c[k + 1], c[k + 2]); _b.set(c[k + 3], c[k + 4], c[k + 5]); _c.set(c[k + 6], c[k + 7], c[k + 8]);
        const distance = _triangle.set(_a, _b, _c).closestPointToPoint(point, _hit).distanceTo(point);
        if (distance > nearest + 1e-6) continue;
        // (which side: the way off the surface against the triangle's outward normal, the squarest of those as near)
        const square = distance > 1e-9 ? _triangle.getNormal(_normal).dot(_end.subVectors(point, _hit)) / distance : 0;
        if (distance < nearest - 1e-6 || Math.abs(square) > Math.abs(off)) off = square;
        nearest = Math.min(nearest, distance);
      }
    }
    return off < 0 ? radius + nearest : radius - nearest;
  }

  /** each triangle by the `CELL`-wide cells of their extent its bounds reach into, for `depth` to look only about its point */
  private gridded(): { size: number[]; cells: number[][] } {
    const e = this.extent, b = this.bounds, size = [0, 1, 2].map((axis) => Math.max(1, Math.ceil((e[3 + axis] - e[axis]) / CELL)));
    const cells: number[][] = [], cell = (value: number, axis: number) => Math.min(size[axis] - 1, Math.max(0, Math.floor((value - e[axis]) / CELL)));
    for (let triangle = 0, t = 0; t < b.length; triangle++, t += 6) {
      for (let x = cell(b[t], 0); x <= cell(b[t + 3], 0); x++) for (let y = cell(b[t + 1], 1); y <= cell(b[t + 4], 1); y++) for (let z = cell(b[t + 2], 2); z <= cell(b[t + 5], 2); z++) {
        (cells[(x * size[1] + y) * size[2] + z] ??= []).push(triangle);
      }
    }
    this.seen = new Uint32Array(b.length / 6);
    return { size, cells };
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

/** how wide a cell of the grid `depth` looks through is (m) */
const CELL = 0.02;
const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _hit = new Vector3(), _end = new Vector3(), _normal = new Vector3(), _triangle = new Triangle();
