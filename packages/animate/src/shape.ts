import { Line3, type Matrix4, type Object3D, SkinnedMesh, Vector3 } from 'three'

/**
 * how far his surface is from a line up through a part of him, at rest (m): ahead, behind, to his left and to his
 * right
 */
export type Girth = Record<'front' | 'back' | 'left' | 'right', number>
/**
 * a band of the trunk as the bone it goes with has it at rest: from how far above that bone's joint it reaches to how
 * far, and how far its surface is from the line straight up through the joint. A bone with no skin has a band that
 * reaches nowhere
 */
export type Band = Girth & { low: number; high: number }
/**
 * what he is like about his bones: the trunk as bands from the hips up, one for each bone of it; how far the head is
 * round its middle, and where that is from its joint, upright; and how thick the thighs, the upper arms, the forearms
 * and the fingers are about their bones, as far as the skin tells (m)
 */
export type Shape = Readonly<{
  trunk: Band[]
  head: { middle: Vector3; round: number }
  thigh: number
  upperArm: number
  forearm: number
  finger?: number
}>

/**
 * how thick a rig with no skin to measure is taken to be: the trunk, about the line up the middle of it, and the head,
 * in shares of how far out from the middle a shoulder is; and a thigh, in shares of how far out a hip is. Its arms are
 * taken as lines, and its fingers as thick as its knuckles leave room for
 */
const BARE = 0.65

/**
 * what one pass over the skin counts of a bone: how many points, from its joint the least and the most of where they
 * lie, and their sum; the sum of their squares, and of the squares of how far each is from the line to its end
 */
type Tally = { n: number; least: Vector3; most: Vector3; sum: Vector3; squares: number; across: number }

/**
 * how far a place is inside a girth, from the line it is measured about so far to his left and ahead (m): how much
 * nearer that line it is than the surface is that way; below 0 outside
 */
export function deep(girth: Girth, x: number, z: number) {
  const far = Math.hypot(x, z)
  if (far === 0) return Math.min(girth.front, girth.back, girth.left, girth.right)
  return far / Math.hypot(x / (x > 0 ? girth.left : girth.right), z / (z > 0 ? girth.front : girth.back)) - far
}

/**
 * Measures a rig on the skin of its skinned meshes, in one pass: each point of the skin, where it lies at rest in the
 * frame of the body, is counted to the bone it moves with most, if that is one asked after. `bones` are those, each
 * with where its joint is in that frame and where its end is, and `size` what a rig with no skin is taken to be by.
 */
export function measure(
  rig: Object3D,
  frame: Matrix4,
  bones: Record<
    'trunk' | 'head' | 'thighs' | 'upperArms' | 'forearms' | 'fingers',
    { bone: Object3D; at: Vector3; end: Vector3 }[]
  >,
  { shoulder, hip }: { shoulder: number; hip: number },
): Shape {
  const tallies = new Map<Object3D, Tally & { at: Vector3; line: Line3 }>()
  for (const { bone, at, end } of Object.values(bones).flat()) {
    const [least, most] = [new Vector3(Infinity, Infinity, Infinity), new Vector3(-Infinity, -Infinity, -Infinity)]
    tallies.set(bone, { n: 0, least, most, sum: new Vector3(), squares: 0, across: 0, at, line: new Line3(at, end) })
  }
  const point = new Vector3()
  const near = new Vector3()
  rig.traverse((mesh) => {
    if (!(mesh instanceof SkinnedMesh)) return
    const [index, weight] = [mesh.geometry.getAttribute('skinIndex'), mesh.geometry.getAttribute('skinWeight')]
    for (let k = 0; k < index.count; k++) {
      let most = 0
      for (let j = 1; j < 4; j++) if (weight.getComponent(k, j) > weight.getComponent(k, most)) most = j
      const tally = tallies.get(mesh.skeleton.bones[index.getComponent(k, most)])
      if (!tally) continue
      mesh.getVertexPosition(k, point).applyMatrix4(mesh.matrixWorld).applyMatrix4(frame)
      tally.across += point.distanceToSquared(tally.line.closestPointToPoint(point, true, near))
      point.sub(tally.at)
      tally.n++
      tally.least.min(point)
      tally.most.max(point)
      tally.sum.add(point)
      tally.squares += point.lengthSq()
    }
  })
  const counted = (list: { bone: Object3D }[]) =>
    list.flatMap(({ bone }) => tallies.get(bone) ?? []).filter(({ n }) => n)
  // how thick parts are about their bones: the root of the mean of the squares of how far their skin is from them
  const thick = (list: { bone: Object3D }[]) => {
    const found = counted(list)
    const [n, across] = found.reduce(([n, across], each) => [n + each.n, across + each.across], [0, 0])
    return found.length ? Math.sqrt(across / n) : undefined
  }
  const trunk = bones.trunk.map(({ bone }) => {
    const { least, most } = tallies.get(bone) ?? { least: new Vector3(), most: new Vector3() }
    return { low: least.y, high: most.y, front: most.z, back: -least.z, left: most.x, right: -least.x }
  })
  // (a band reaches up to where the next begins: what lies between moves with neither bone the most, and is there)
  trunk.forEach((band, k) => {
    const next = trunk.slice(k + 1).findIndex(({ low, high }) => high >= low) + k + 1
    if (next > k && band.high >= band.low) {
      band.high = Math.max(band.high, trunk[next].low + bones.trunk[next].at.y - bones.trunk[k].at.y)
    }
  })
  // (bare, the trunk is as thick as it is from the hips up to below the shoulders, where the last of it ends, and goes
  // with that)
  const round = BARE * shoulder
  const [hips, top] = [bones.trunk[0].at, bones.trunk[bones.trunk.length - 1]]
  const bare = {
    low: hips.y - top.at.y,
    high: top.end.y - top.at.y - round,
    front: round,
    back: round,
    left: round,
    right: round,
  }
  // (a sphere's skin is as far from its middle, on the mean of the squares, as it is round)
  const [head] = counted(bones.head)
  const middle = head ? head.sum.clone().divideScalar(head.n) : new Vector3(0, round, 0)
  return {
    trunk: counted(bones.trunk).length ? trunk : [...trunk.slice(0, -1), bare],
    head: { middle, round: head ? Math.sqrt(head.squares / head.n - middle.lengthSq()) : round },
    thigh: thick(bones.thighs) ?? BARE * hip,
    upperArm: thick(bones.upperArms) ?? 0,
    forearm: thick(bones.forearms) ?? 0,
    finger: thick(bones.fingers),
  }
}
