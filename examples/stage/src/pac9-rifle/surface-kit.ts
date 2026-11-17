// From the Drawcall market asset pac9-rifle (its surface kit), the part the rifle uses.
import * as THREE from "three"

/** Linear 0..1 colour factors. */
export type Rgb = [number, number, number]

/**
 * Box with edges and corners rounded by one ring of radius `bevel` (a 3x3x3-segment BoxGeometry whose inner grid lines
 * move to `bevel` inside the faces). Not three's RoundedBoxGeometry.
 */
export function roundedBox(width: number, height: number, depth: number, bevel: number) {
  bevel = Math.min(bevel, width / 2 - 1e-4, height / 2 - 1e-4, depth / 2 - 1e-4)
  const geometry = new THREE.BoxGeometry(width, height, depth, 3, 3, 3)
  const position = geometry.attributes.position
  const normal = geometry.attributes.normal
  const halfX = width / 2
  const halfY = height / 2
  const halfZ = depth / 2
  const outward = new THREE.Vector3()
  // outer vertices stay on the box, the two middle grid lines move to `bevel` inside it
  const snap = (value: number, half: number) => {
    const sign = Math.sign(value)
    return Math.abs(value) > half - 1e-5 ? sign * half : sign * (half - bevel)
  }
  for (let i = 0; i < position.count; i++) {
    let x = snap(position.getX(i), halfX)
    let y = snap(position.getY(i), halfY)
    let z = snap(position.getZ(i), halfZ)
    const innerX = Math.max(-(halfX - bevel), Math.min(halfX - bevel, x))
    const innerY = Math.max(-(halfY - bevel), Math.min(halfY - bevel, y))
    const innerZ = Math.max(-(halfZ - bevel), Math.min(halfZ - bevel, z))
    outward.set(x - innerX, y - innerY, z - innerZ)
    if (outward.lengthSq() > 1e-10) {
      outward.normalize()
      const outerAxes = (Math.abs(x) > halfX - 1e-5 ? 1 : 0) + (Math.abs(y) > halfY - 1e-5 ? 1 : 0) + (Math.abs(z) > halfZ - 1e-5 ? 1 : 0)
      if (outerAxes >= 2) {
        // an edge or a corner: rounded off
        x = innerX + outward.x * bevel
        y = innerY + outward.y * bevel
        z = innerZ + outward.z * bevel
        normal.setXYZ(i, outward.x, outward.y, outward.z)
      }
    }
    position.setXYZ(i, x, y, z)
  }
  return geometry
}
