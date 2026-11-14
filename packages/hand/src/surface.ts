import { Mesh, type Object3D, Plane, Ray, Sphere, Triangle, Vector3 } from 'three'

/** directions no face of a modelled thing lies along, to count crossings by */
const ODD = [new Vector3(0.54, 0.62, 0.57), new Vector3(-0.31, 0.82, -0.48), new Vector3(0.12, -0.23, 0.96)]

/** how far off a face, as a share of its size, a point may lie by rounding alone */
const ROUNDING = 1e-9

export type Surface = ReturnType<typeof surface>

/** a target's triangles in the world, each with the sphere round it, to ask how near a point or a ray comes */
export function surface(target: Object3D) {
  const faces: { t: Triangle; s: Sphere }[] = []
  target.traverse((mesh) => {
    if (!(mesh instanceof Mesh)) return
    const [position, index] = [mesh.geometry.getAttribute('position'), mesh.geometry.getIndex()]
    const corner = (i: number) =>
      new Vector3().fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld)
    for (let i = 0; i + 2 < (index ?? position).count; i += 3) {
      const t = new Triangle(corner(i), corner(i + 1), corner(i + 2))
      faces.push({ t, s: new Sphere().setFromPoints([t.a, t.b, t.c]) })
    }
  })
  if (!faces.length) throw new Error(`${target.name || 'the target'} has no mesh to grip`)
  const [ray, hit, plane] = [new Ray(), new Vector3(), new Plane()]
  /** the nearest point of the surface to a point, how far it is and which way its face faces */
  const nearest = (point: Vector3) => {
    const best = { distance: Infinity, normal: new Vector3(), at: new Vector3() }
    for (const { t, s } of faces) {
      if (point.distanceTo(s.center) - s.radius >= best.distance) continue
      const at = t.closestPointToPoint(point, new Vector3())
      const distance = at.distanceTo(point)
      if (distance < best.distance) Object.assign(best, { distance, at, normal: t.getNormal(new Vector3()) })
    }
    return best
  }
  /** how far along a ray it crosses each face, from either side: where the ray meets a face's plane within rounding of
   * the face, as one through a corner the faces share would slip between them were each asked if it holds it */
  const hits = (origin: Vector3, way: Vector3) => {
    ray.set(origin, way)
    const near = faces.filter(({ s }) => ray.distanceSqToPoint(s.center) <= s.radius ** 2)
    return near.flatMap(({ t, s }) => {
      const along = ray.distanceToPlane(t.getPlane(plane))
      if (along === null) return []
      const at = ray.at(along, hit)
      return t.closestPointToPoint(at, new Vector3()).distanceTo(at) <= ROUNDING * s.radius ? [along] : []
    })
  }
  const area = faces.reduce((sum, { t }) => sum + t.getArea(), 0)
  return {
    nearest,
    /** how far along a ray it first meets a face: Infinity if it meets none */
    cast: (origin: Vector3, way: Vector3) => Math.min(...hits(origin, way)),
    /** how far a point is from it, negative inside: by the nearest face's side, or where that is unclear, by ray parity */
    depth(point: Vector3, close = nearest(point)) {
      const side = point.clone().sub(close.at).dot(close.normal)
      if (Math.abs(side) > close.distance / 2) return Math.sign(side) * close.distance
      return ODD.filter((way) => hits(point, way).length % 2).length > 1 ? -close.distance : close.distance
    },
    /** the middle of the surface, each part weighed by its area: where the target's bulk lies */
    centroid: faces.reduce((sum, { t }) => sum.addScaledVector(t.getMidpoint(hit), t.getArea() / area), new Vector3()),
    bounds: new Sphere().setFromPoints(faces.flatMap(({ t }) => [t.a, t.b, t.c])),
  }
}
