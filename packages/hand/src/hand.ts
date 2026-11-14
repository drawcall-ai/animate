import { Bone, Matrix4, type Object3D, Quaternion, Vector3 } from 'three'

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'little'] as const
export type Finger = (typeof FINGERS)[number]
/** what of a hand can take part in a grip */
export type Element = 'palm' | Finger
export const ELEMENTS: readonly Element[] = ['palm', ...FINGERS]

/**
 * How a hand is held, finger by finger (rad): `spread` turns a finger at its knuckle toward the thumb's side, `bend`
 * folds its three joints toward the palm. The thumb's first bend lifts it to stand in front of the palm, its other two
 * fold it toward the fingers. A left and a right hand in one pose mirror each other.
 */
export type Pose = Record<Finger, { spread: number; bend: [number, number, number] }>

/** a bone of the hand as a rod of the hand's thickness, in the hand bone's frame; the palm is five, wrist to knuckle */
export type Segment = { element: Element; bone: number; a: Vector3; b: Vector3; radius: number }

/** how far a person's joints turn, as a pose's angles are listed: spread, then the bends from the knuckle out (rad); a
 * finger's knuckle stops short of a right angle, past which its spread and bend could no longer be told apart */
const LIMITS = {
  thumb: { low: [-0.4, -0.2, -0.2, -0.3], high: [0.5, 1.5, 1.0, 1.4] },
  finger: { low: [-0.35, -0.35, 0, -0.1], high: [0.35, 1.55, 1.9, 1.4] },
}
const NAMES = ['spread', 'bend[0]', 'bend[1]', 'bend[2]']
export const limits = (finger: Finger) => {
  const { low, high } = LIMITS[finger === 'thumb' ? 'thumb' : 'finger']
  return low.map((l, k) => [l, high[k]])
}
/** a finger's angles in one list, as `LIMITS` has them */
export const angles = ({ spread, bend }: Pose[Finger]) => [spread, ...bend]
/** a finger's part of a pose from its angles in one list */
export const part = (values: number[]): Pose[Finger] => ({ spread: values[0], bend: [values[1], values[2], values[3]] })
/** angles a share of the way from some to others */
export const lerp = (from: number[], to: number[], share: number) => from.map((v, i) => v + (to[i] - v) * share)

/** throws if a pose turns a joint past what a person's turns, naming the finger, the joint and by how much */
export function check(pose: Pose) {
  for (const finger of FINGERS)
    angles(pose[finger]).forEach((angle, k) => {
      const [low, high] = limits(finger)[k]
      const past = ((Math.max(low - angle, angle - high) * 180) / Math.PI).toFixed(1)
      if (!(+past <= 0)) throw new Error(`the ${finger}'s ${NAMES[k]} is turned ${past}° past what a person's turns`)
    })
}

export const each = <T>(make: (finger: Finger) => T): Record<Finger, T> => {
  const [thumb, index, middle, ring, little] = FINGERS.map(make)
  return { thumb, index, middle, ring, little }
}

/** something for each element, the palm and each finger */
export const all = <T>(make: (e: Element) => T): Record<Element, T> => ({ palm: make('palm'), ...each(make) })

export const flat: Pose = each(() => ({ spread: 0, bend: [0, 0, 0] }))
export const relaxed: Pose = {
  thumb: { spread: -0.35, bend: [0.15, 0, 0.4] },
  index: { spread: 0.04, bend: [0.2, 0.3, 0.15] },
  middle: { spread: 0, bend: [0.28, 0.4, 0.2] },
  ring: { spread: -0.04, bend: [0.36, 0.5, 0.25] },
  little: { spread: -0.08, bend: [0.44, 0.6, 0.3] },
}
// the fingers converge as they fold, which is what keeps them from crossing in a fist; a grip's fingers close at its
// spread and end there when they close on nothing
export const fist: Pose = {
  thumb: { spread: -0.4, bend: [0.8, 0.15, 1.2] },
  index: { spread: -0.06, bend: [1.45, 1.75, 0.75] },
  middle: { spread: 0, bend: [1.45, 1.75, 0.75] },
  ring: { spread: 0.05, bend: [1.45, 1.7, 0.7] },
  little: { spread: 0.1, bend: [1.4, 1.55, 0.6] },
}
export const point: Pose = { ...fist, index: flat.index }

/**
 * a joint of a finger: its bone, its rest turn, its rest turn in the hand's frame, what it turns about there, and what
 * turns its bone from its rest to where the pose counts from
 */
type Joint = { bone: Object3D; rest: Quaternion; frame: Quaternion; axes: Vector3[]; straight: Quaternion }
/** a finger as the hand's bones have it: its joints, and where they and the fingertip lie at rest in the hand's frame */
type Digit = { joints: Joint[]; points: Vector3[] }

/** `v` made square to the unit direction `to`, as a unit */
export const square = (v: Vector3, to: Vector3) => v.clone().addScaledVector(to, -v.dot(to)).normalize()

/**
 * A humanoid hand read from a rig's bones. All it measures is in the hand bone's frame: the wrist at its origin,
 * `along` toward the middle knuckle, `thumbward` across the knuckles, and `normal` out of the palm.
 */
export class Hand {
  readonly bone: Object3D
  readonly side: 'left' | 'right'
  readonly thumbward: Vector3
  readonly normal: Vector3
  /** how thick a finger is, half the least room between two knuckles: the hand's skin is this far off its bones */
  readonly radius: number
  readonly #digits: Record<Finger, Digit>

  constructor(rig: Object3D, side: 'left' | 'right') {
    this.side = side
    const find = (name: string, parent?: Object3D) => {
      const bone = rig.getObjectByName(name)
      if (!bone) throw new Error(`the rig has no ${name}`)
      if (parent && bone.parent !== parent)
        throw new Error(`the ${name} hangs from ${bone.parent?.name}, not ${parent.name}`)
      return bone
    }
    const hand = (this.bone = find(`${side}Hand`))
    rig.updateMatrixWorld(true)
    this.size()
    const at = (bone: Object3D) => hand.worldToLocal(bone.getWorldPosition(new Vector3()))
    const world = (bone: Object3D) => bone.getWorldQuaternion(new Quaternion())
    const chains = each((finger) => {
      const name = finger[0].toUpperCase() + finger.slice(1)
      const parts = finger === 'thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal']
      const bones: Object3D[] = []
      for (const part of parts) bones.push(find(`${side}${name}${part}`, bones.at(-1) ?? hand))
      // meshes may hang from the last bone too; the fingertip is the one bone that does
      const tips = bones[2].children.filter((child) => child instanceof Bone)
      if (tips.length !== 1)
        throw new Error(`the ${bones[2].name} has ${tips.length} child bones, not the one at the fingertip`)
      return [...bones, tips[0]]
    })
    const knuckle = (finger: Finger) => at(chains[finger][0])
    const along = knuckle('middle').normalize()
    const thumbward = (this.thumbward = square(knuckle('index').sub(knuckle('little')), along))
    const handed = side === 'right' ? -1 : 1
    const normal = (this.normal = new Vector3().crossVectors(along, thumbward).multiplyScalar(handed))
    const row = FINGERS.slice(1).map(knuckle)
    this.radius = Math.min(...row.slice(1).map((at, k) => at.distanceTo(row[k]))) / 2
    const fromHand = world(hand).invert()
    const digit = (finger: Finger): Digit => {
      const bones = chains[finger]
      const points = bones.map(at)
      // a pose counts a finger's angles from it straight in the palm's plane, pointing there as the rig points its first
      // bone: whatever else the rest bends, the thumb lifted in front of the palm or a finger curled, is taken out
      const steps = points.slice(1).map((p, k) => p.clone().sub(points[k]).normalize())
      const way = square(steps[0], normal)
      // a spread turns a finger thumbward within the palm, and the thumb, lying out to the side, away from the fingertips
      const outward = square(thumbward.clone().sub(along), way)
      const spread = new Vector3().crossVectors(way, outward)
      // a knuckle lifts its finger out of the palm; the thumb's other joints fold it within the palm toward the fingers
      const lift = new Vector3().crossVectors(way, normal)
      const fold = finger === 'thumb' ? new Vector3().crossVectors(outward, way) : lift
      const axes = [[spread, lift], [fold], [fold]]
      const joints = axes.map((axes, k) => {
        const bone = bones[k]
        const straight = new Quaternion().setFromUnitVectors(steps[k], way)
        return { bone, rest: bone.quaternion.clone(), frame: fromHand.clone().multiply(world(bone)), axes, straight }
      })
      return { joints, points }
    }
    this.#digits = each(digit)
  }

  /** how many times its rig's size the hand is in the world: throws if it is scaled unevenly, which bends its bones */
  size() {
    const { x, y, z } = this.bone.getWorldScale(new Vector3())
    const scales = [x, y, z].map((v) => +v.toFixed(3))
    if (Math.max(x, y, z) - Math.min(x, y, z) > 1e-6 * Math.max(x, y, z))
      throw new Error(`the ${this.bone.name} is scaled unevenly (${scales}): scale it alike`)
    return x
  }

  /** how each joint of a finger turns from its rest for its part of a pose, about its axes in the hand's frame */
  #turns(finger: Finger, held: Pose[Finger]) {
    const [spread, ...bend] = angles(held)
    const values = [[spread, bend[0]], [bend[1]], [bend[2]]]
    const { joints } = this.#digits[finger]
    return joints.map(({ axes, straight }, k) => {
      const so = k ? joints[k - 1].straight.clone().invert() : new Quaternion()
      axes.forEach((axis, i) => so.multiply(new Quaternion().setFromAxisAngle(axis, values[k][i])))
      return so.multiply(straight)
    })
  }

  /**
   * the hand in a pose as rods, in the hand bone's frame or placed by `place`: the palm's five from the wrist to each
   * finger's knuckle and the thumb's root, then each finger's bones from the knuckle out
   */
  segments(pose: Pose, place = new Matrix4()): Segment[] {
    const radius = this.radius * place.getMaxScaleOnAxis()
    const rod = (element: Element, bone: number, a: Vector3, b: Vector3) => {
      return { element, bone, a: a.clone().applyMatrix4(place), b: b.clone().applyMatrix4(place), radius }
    }
    // (the palm's flesh reaches the thumb's root, which a rig may have in front of the knuckles' plane)
    const roots = [...FINGERS.slice(1), 'thumb' as const]
    const palm = roots.map((f, bone) => rod('palm', bone, new Vector3(), this.#digits[f].points[0]))
    const fingers = FINGERS.flatMap((finger) => {
      const { points } = this.#digits[finger]
      const at = [points[0]]
      const turned = new Quaternion()
      return this.#turns(finger, pose[finger]).map((so, bone) => {
        turned.multiply(so)
        at.push(points[bone + 1].clone().sub(points[bone]).applyQuaternion(turned).add(at[bone]))
        return rod(finger, bone, at[bone], at[bone + 1])
      })
    })
    return [...palm, ...fingers]
  }

  /** turns the fingers' bones to hold a pose, from their rest: throws if it is past a person's range */
  pose(pose: Pose) {
    check(pose)
    for (const finger of FINGERS) {
      const turns = this.#turns(finger, pose[finger])
      this.#digits[finger].joints.forEach(({ bone, rest, frame }, k) =>
        bone.quaternion.copy(rest).multiply(frame.clone().invert().multiply(turns[k]).multiply(frame)),
      )
    }
  }
}
