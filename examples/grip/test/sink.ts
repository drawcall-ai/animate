// How deep the hand is sunk into a thing: measured from the scene alone (the bones where they stand, the thing's
// triangles), knowing nothing of how the grip was found.
import { type Finger, FINGERS, type Hand } from "@drawcall/animate"
import { Bone, Mesh, type Object3D, Triangle, Vector3 } from "three"

/** how far a point is from a thing's surface, negative inside one of its meshes (by the solid angle its faces fill) */
function distance(thing: Object3D) {
  const meshes: Triangle[][] = []
  thing.updateMatrixWorld(true)
  thing.traverse((mesh) => {
    if (!(mesh instanceof Mesh)) return
    const [position, index] = [mesh.geometry.getAttribute("position"), mesh.geometry.getIndex()]
    const corner = (i: number) => new Vector3().fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld)
    const faces: Triangle[] = []
    for (let i = 0; i + 2 < (index ?? position).count; i += 3) faces.push(new Triangle(corner(i), corner(i + 1), corner(i + 2)))
    meshes.push(faces)
  })
  const [a, b, c, near] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()]
  return (p: Vector3) => {
    let [least, inside] = [Infinity, false]
    for (const faces of meshes) {
      let angle = 0
      for (const t of faces) {
        least = Math.min(least, t.closestPointToPoint(p, near).distanceTo(p))
        ;(a.subVectors(t.a, p), b.subVectors(t.b, p), c.subVectors(t.c, p))
        const [la, lb, lc] = [a.length(), b.length(), c.length()]
        angle += 2 * Math.atan2(a.dot(near.crossVectors(b, c)), la * lb * lc + a.dot(b) * lc + b.dot(c) * la + c.dot(a) * lb)
      }
      inside ||= Math.abs(angle) > 2 * Math.PI
    }
    return inside ? -least : least
  }
}

/** a finger's half thickness as a grip takes it: half the least room between two neighbouring knuckles (m, in the world) */
export function thickness(hand: Hand) {
  hand.bone.updateWorldMatrix(true, true)
  const row = ["Index", "Middle", "Ring", "Little"].map((finger) => {
    const knuckle = hand.bone.getObjectByName(`${hand.side}${finger}Proximal`)
    if (!knuckle) throw new Error(`the hand has no ${finger.toLowerCase()}`)
    return knuckle.getWorldPosition(new Vector3())
  })
  return Math.min(...row.slice(1).map((at, k) => at.distanceTo(row[k]))) / 2
}

/** How deep (m) the skin of each finger, `radius` round its bones as they stand in the scene, is in the thing (0 where
 * it is clear), and the palm's (the wrist to each knuckle) */
export function sink(hand: Hand, thing: Object3D, radius: number) {
  const far = distance(thing)
  const at = (bone: Object3D) => bone.getWorldPosition(new Vector3())
  const deep = (from: Vector3, to: Vector3) => {
    const n = Math.max(1, Math.ceil(from.distanceTo(to) / 0.001))
    let worst = 0
    for (let i = 0; i <= n; i++) worst = Math.max(worst, radius - far(from.clone().lerp(to, i / n)))
    return worst
  }
  hand.bone.updateWorldMatrix(true, true)
  const knuckle = (finger: Finger) => {
    const bone = hand.bone.children.find((b) => b.name.toLowerCase().includes(finger))
    if (!bone) throw new Error(`the hand has no ${finger}`)
    return bone
  }
  const along = (finger: Finger) => {
    let [bone, worst] = [knuckle(finger), 0]
    for (let next; (next = bone.children.find((b) => b instanceof Bone)); bone = next) worst = Math.max(worst, deep(at(bone), at(next)))
    return worst
  }
  const palm = Math.max(...FINGERS.map((f) => deep(at(hand.bone), at(knuckle(f)))))
  return { palm, thumb: along("thumb"), index: along("index"), middle: along("middle"), ring: along("ring"), little: along("little") }
}
