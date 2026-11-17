// From the Drawcall market asset pac9-rifle.
// Geometry building blocks of the rifle. Every piece carries per-vertex colours (a colour multiplier
// with a little grain and optional bright edge wear) that the materials multiply their base colours by.
//
// Coordinate convention of the rifle: +X right, +Y up and the muzzle points towards -Z, so every "z" /
// "forward" argument below is a distance towards the muzzle and is applied as -z.
import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { roundedBox, type Rgb } from "./surface-kit"

type Point = [number, number]
type Rotation = [number, number, number]

/** Deterministic pseudo-random number in 0..1 from three coordinates. */
function hash3d(x: number, y: number, z: number) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453
  return n - Math.floor(n)
}

/** Colour multiplier of one vertex: a faint grain, and for `wear > 0` rare bright flecks that look like worn edges. */
function grain(position: THREE.Vector3Like, wear: number, isEdgeNormal: boolean) {
  let shade = 0.9 + 0.2 * hash3d(Math.round(position.x * 70), Math.round(position.y * 70), Math.round(position.z * 70))
  if (wear > 0 && isEdgeNormal) {
    const fleck = hash3d(Math.round(position.x * 300), Math.round(position.y * 300), Math.round(position.z * 300))
    const strength = Math.max(0, fleck - 0.84) / 0.16
    shade *= 1 + wear * 1.6 * strength * strength
  }
  return shade
}

/** Normals of a bevelled box: anything not facing along one axis is a bevel. */
const isBoxBevel = (nx: number, ny: number, nz: number) => Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz)) < 0.95
/** Normals of an extruded plate's bevel: mostly sideways, not the flat front/back faces. */
const isPlateBevel = (_nx: number, _ny: number, nz: number) => Math.abs(nz) > 0.15 && Math.abs(nz) < 0.95

/** Adds a `color` attribute: `color` scaled by the vertex grain; `wear` brightens flecks on the faces `isEdge` selects. */
export function paintVertexColors(
  geometry: THREE.BufferGeometry,
  color: Rgb,
  wear = 0,
  isEdge: ((nx: number, ny: number, nz: number) => boolean) | null = null,
) {
  const position = geometry.attributes.position
  const normal = geometry.attributes.normal
  const colors = new Float32Array(position.count * 3)
  const point = new THREE.Vector3()
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i)
    const edge = !!isEdge && isEdge(normal.getX(i), normal.getY(i), normal.getZ(i))
    const shade = grain(point, wear, edge)
    colors[i * 3] = color[0] * shade
    colors[i * 3 + 1] = color[1] * shade
    colors[i * 3 + 2] = color[2] * shade
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))
  return geometry
}

// ---------------------------------------------------------------------------------------------------------------
// Boxes
// ---------------------------------------------------------------------------------------------------------------

const boxRotation = new THREE.Matrix4()

/**
 * A rounded, bevelled box `width` (x) by `height` (y) by `length` (z), centred at (x, y) and `z` metres towards the
 * muzzle. An optional XYZ Euler `rotation` turns it about its own centre first.
 */
export function box(
  width: number,
  height: number,
  length: number,
  bevel: number,
  x: number,
  y: number,
  z: number,
  color: Rgb,
  wear = 0,
  rotation: Rotation | null = null,
) {
  const geometry = roundedBox(width, height, length, bevel)
  paintVertexColors(geometry, color, wear, isBoxBevel)
  if (rotation) geometry.applyMatrix4(boxRotation.makeRotationFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2])))
  return geometry.translate(x, y, -z)
}

// ---------------------------------------------------------------------------------------------------------------
// Extruded plates
// ---------------------------------------------------------------------------------------------------------------

/** Closed polygon outline with optional polygon holes. */
function shapeFromPoints(points: Point[], holes?: Point[][]) {
  const shape = new THREE.Shape()
  points.forEach((point, index) => (index ? shape.lineTo(point[0], point[1]) : shape.moveTo(point[0], point[1])))
  shape.closePath()
  if (holes) for (const hole of holes) shape.holes.push(new THREE.Path(hole.map((point) => new THREE.Vector2(point[0], point[1]))))
  return shape
}

/** Extrusion of `points` that is `length` deep in total, with a one-segment bevel of size `bevel` on both faces. */
function extrudeBevelled(points: Point[], length: number, bevel: number, holes?: Point[][]) {
  return new THREE.ExtrudeGeometry(shapeFromPoints(points, holes), {
    depth: Math.max(1e-4, length - 2 * bevel),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 1,
    steps: 1,
    curveSegments: 6,
  })
}

/** The bevel of an extrusion normally gets smoothed by the extruder; make it a flat chamfer: faces on the front/back
 *  planes keep an axial normal, everything else a purely radial one. */
function flattenExtrusionNormals(geometry: THREE.ExtrudeGeometry) {
  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  if (!box) throw new Error("extrusion has no bounding box")
  const position = geometry.attributes.position
  const normal = geometry.attributes.normal
  for (let i = 0; i < position.count; i++) {
    const nz = normal.getZ(i)
    const absNz = Math.abs(nz)
    if (absNz < 0.15 || absNz > 0.95) continue
    const z = position.getZ(i)
    if (Math.abs(z - box.min.z) < 1e-6 || Math.abs(z - box.max.z) < 1e-6) normal.setXYZ(i, 0, 0, Math.sign(nz))
    else {
      const radial = Math.hypot(normal.getX(i), normal.getY(i)) || 1
      normal.setXYZ(i, normal.getX(i) / radial, normal.getY(i) / radial, 0)
    }
  }
  return geometry
}

/**
 * A side-view plate: `profile` is drawn in the side view (x runs towards the muzzle, y is up) and extruded across the
 * rifle from lateral position `x0` to `x1`.
 */
export function extrudeSide(profile: Point[], x0: number, x1: number, bevel: number, color: Rgb, wear = 0, holes?: Point[][]) {
  const geometry = extrudeBevelled(profile, x1 - x0, bevel, holes)
  paintVertexColors(geometry, color, wear, isPlateBevel)
  flattenExtrusionNormals(geometry)
  geometry.translate(0, 0, x0 + bevel)
  geometry.rotateY(Math.PI / 2)
  return geometry
}

/**
 * A cross-section extruded along the barrel: `profile` is drawn from the front (x right, y up) and runs from `z0` to
 * `z1` metres towards the muzzle.
 */
export function extrudeSection(profile: Point[], z0: number, z1: number, bevel: number, color: Rgb, wear = 0, holes?: Point[][]) {
  const geometry = extrudeBevelled(profile, z1 - z0, bevel, holes)
  paintVertexColors(geometry, color, wear, isPlateBevel)
  flattenExtrusionNormals(geometry)
  return geometry.translate(0, 0, -z1 + bevel)
}

// ---------------------------------------------------------------------------------------------------------------
// Revolved parts
// ---------------------------------------------------------------------------------------------------------------

/**
 * Revolves `profile`, a polyline of [radius, distance towards the muzzle] points, around the barrel axis through
 * (centerX, centerY). Each profile segment gets its own ring pair so edges stay hard. `colorOf` can recolour a
 * point of the profile.
 */
export function revolve(
  profile: Point[],
  segments: number,
  color: Rgb,
  wear = 0,
  centerX = 0,
  centerY = 0,
  colorOf: ((radius: number, distance: number, color: Rgb) => Rgb) | null = null,
) {
  const positions: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  let vertexCount = 0

  for (let segment = 0; segment < profile.length - 1; segment++) {
    const [radius0, distance0] = profile[segment]
    const [radius1, distance1] = profile[segment + 1]
    const dr = radius1 - radius0
    const dd = distance1 - distance0
    const length = Math.hypot(dr, dd)
    if (length < 1e-7) continue
    // outward normal of the segment in the (radius, distance) plane; only slanted segments pick up edge wear
    const normalRadial = dd / length
    const normalAxial = -dr / length
    const slanted = Math.abs(normalRadial) > 0.25 && Math.abs(normalAxial) > 0.25

    for (let step = 0; step <= segments; step++) {
      const angle = (step / segments) * Math.PI * 2
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      for (let end = 0; end < 2; end++) {
        const radius = end ? radius1 : radius0
        const distance = end ? distance1 : distance0
        positions.push(centerX + radius * cos, centerY + radius * sin, -distance)
        normals.push(normalRadial * cos, normalRadial * sin, -normalAxial)
        let shade = 0.9 + 0.2 * hash3d(Math.round(distance * 150), Math.round(angle * 3), segment)
        if (slanted && wear > 0) {
          const fleck = hash3d(step * 7.1, segment * 3.3, distance * 100)
          const strength = Math.max(0, fleck - 0.84) / 0.16
          shade *= 1 + wear * 1.6 * strength * strength
        }
        const base = colorOf ? colorOf(radius, distance, color) : color
        colors.push(base[0] * shade, base[1] * shade, base[2] * shade)
      }
    }
    for (let step = 0; step < segments; step++) {
      const a = vertexCount + step * 2
      const b = a + 2
      const c = a + 1
      const d = a + 3
      indices.push(a, c, b, b, c, d)
    }
    vertexCount += (segments + 1) * 2
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3))
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2))
  geometry.setIndex(indices)
  return geometry
}

/** A short chamfered cylinder lying along X (a pin, screw head or rivet) at (x, y), `z` metres towards the muzzle. */
export function pin(radius: number, length: number, x: number, y: number, z: number, color: Rgb, segments = 12, wear = 0) {
  const chamfer = Math.min(radius * 0.25, length * 0.25)
  const half = length / 2
  const geometry = revolve(
    [
      [0, -half],
      [radius - chamfer, -half],
      [radius, -half + chamfer],
      [radius, half - chamfer],
      [radius - chamfer, half],
      [0, half],
    ],
    segments,
    color,
    wear,
  )
  geometry.rotateY(Math.PI / 2)
  return geometry.translate(x, y, -z)
}

/** Outline of a stadium (rounded slot) of `width` by `height` centred at (x, y). */
export function slotOutline(x: number, y: number, width: number, height: number, arcSteps = 4): Point[] {
  const outline: Point[] = []
  const radius = height / 2
  const straight = width / 2 - radius
  for (let i = 0; i <= arcSteps; i++) {
    const angle = -Math.PI / 2 + (i / arcSteps) * Math.PI
    outline.push([x + straight + Math.cos(angle) * radius, y + Math.sin(angle) * radius])
  }
  for (let i = 0; i <= arcSteps; i++) {
    const angle = Math.PI / 2 + (i / arcSteps) * Math.PI
    outline.push([x - straight + Math.cos(angle) * radius, y + Math.sin(angle) * radius])
  }
  return outline
}

/** Outline of the rectangle (x0, y0)-(x1, y1) with chamfered corners. */
export function chamferedRectangle(x0: number, y0: number, x1: number, y1: number, chamfer: number): Point[] {
  return [
    [x0 + chamfer, y0],
    [x1 - chamfer, y0],
    [x1, y0 + chamfer],
    [x1, y1 - chamfer],
    [x1 - chamfer, y1],
    [x0 + chamfer, y1],
    [x0, y1 - chamfer],
    [x0, y0 + chamfer],
  ]
}

// ---------------------------------------------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------------------------------------------

/** Merges parts that share position / normal / uv / color attributes into one geometry (mixed indexing is flattened). */
export function mergeParts(parts: THREE.BufferGeometry[]) {
  const allIndexed = parts.every((part) => part.index)
  const noneIndexed = parts.every((part) => !part.index)
  const compatible = allIndexed || noneIndexed ? parts : parts.map((part) => (part.index ? part.toNonIndexed() : part))
  const merged = mergeGeometries(compatible, false)
  if (!merged) throw new Error("parts have different attributes")
  return merged
}
