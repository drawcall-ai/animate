import type { SkeletonBone } from '@drawcall/rig'
import { Bone, Group, type Object3D, Vector3 } from 'three'

const BODY = [
  { name: 'hips', position: [0, 0.95, 0] },
  { name: 'spine', parent: 'hips', position: [0, 1.07, 0] },
  { name: 'chest', parent: 'spine', position: [0, 1.25, 0] },
  { name: 'neck', parent: 'chest', position: [0, 1.47, 0] },
  { name: 'head', parent: 'neck', position: [0, 1.53, 0] },
  { name: 'head_end', parent: 'head', position: [0, 1.7, 0] },
  { name: 'leftShoulder', parent: 'chest', position: [0.03, 1.42, 0] },
  { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.2, 1.42, 0] },
  { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.49, 1.42, 0] },
  { name: 'leftHand', parent: 'leftLowerArm', position: [0.81, 1.42, 0] },
  { name: 'leftHand_end', parent: 'leftHand', position: [0.9, 1.42, 0] },
  { name: 'rightShoulder', parent: 'chest', position: [-0.03, 1.42, 0] },
  { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.2, 1.42, 0] },
  { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.49, 1.42, 0] },
  { name: 'rightHand', parent: 'rightLowerArm', position: [-0.81, 1.42, 0] },
  { name: 'rightHand_end', parent: 'rightHand', position: [-0.9, 1.42, 0] },
  { name: 'leftUpperLeg', parent: 'hips', position: [0.09, 0.95, 0] },
  { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.09, 0.51, 0] },
  { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.09, 0.07, 0] },
  { name: 'leftToes', parent: 'leftFoot', position: [0.09, 0.02, 0.12] },
  { name: 'leftToes_end', parent: 'leftToes', position: [0.09, 0.02, 0.18] },
  { name: 'rightUpperLeg', parent: 'hips', position: [-0.09, 0.95, 0] },
  { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.09, 0.51, 0] },
  { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.09, 0.07, 0] },
  { name: 'rightToes', parent: 'rightFoot', position: [-0.09, 0.02, 0.12] },
  { name: 'rightToes_end', parent: 'rightToes', position: [-0.09, 0.02, 0.18] },
] as const

/** the fingers of his left hand, the palm down and the thumb ahead: where the joints of each are, out from the wrist and ahead of it (m), from the knuckle to the fingertip */
const HAND = {
  Thumb: [
    [0.02, 0.025],
    [0.05, 0.055],
    [0.073, 0.078],
    [0.091, 0.096],
  ],
  Index: [
    [0.09, 0.03],
    [0.13, 0.03],
    [0.154, 0.03],
    [0.174, 0.03],
  ],
  Middle: [
    [0.092, 0.01],
    [0.136, 0.01],
    [0.164, 0.01],
    [0.185, 0.01],
  ],
  Ring: [
    [0.088, -0.01],
    [0.128, -0.01],
    [0.154, -0.01],
    [0.175, -0.01],
  ],
  Little: [
    [0.08, -0.03],
    [0.112, -0.03],
    [0.131, -0.03],
    [0.149, -0.03],
  ],
} as const
const NAMES = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'] as const
const PARTS = {
  finger: ['Proximal', 'Intermediate', 'Distal', 'Distal_end'],
  thumb: ['Metacarpal', 'Proximal', 'Distal', 'Distal_end'],
} as const

/** the bones of the fingers of a hand, whose wrist is so far out along x: they turn with nothing skinned to them */
const fingers = <Side extends 'left' | 'right'>(side: Side, wrist: number) =>
  NAMES.flatMap((finger) => {
    const names = PARTS[finger === 'Thumb' ? 'thumb' : 'finger'].map((part) => `${side}${finger}${part}` as const)
    return HAND[finger].map(([out, ahead], k) => ({
      name: names[k],
      parent: k === 0 ? (`${side}Hand` as const) : names[k - 1],
      position: [wrist + Math.sign(wrist) * out, 1.42, ahead] as const,
      pieces: [],
    }))
  })

/** A man's skeleton as @drawcall/rig takes one, his bones named as a body asks: where each joint is (m), standing on y = 0 with his arms out and his palms down, facing +z, his left at +x. The examples skin a mannequin to it, and the tests stand a body on its bare bones. */
export const FINGERS = [...fingers('left', 0.81), ...fingers('right', -0.81)]
export const PERSON = [...BODY, ...FINGERS] satisfies readonly SkeletonBone[]

/** The person's bones with nothing skinned to them, each where his skeleton has its joint, or where `moved` puts it, on a person `scale` times as large: all a body needs of a rig. */
export function person(scale = 1, moved = (_name: string, at: Vector3) => at) {
  const sized = new Group()
  const bones = new Map<string, Object3D>()
  const skeleton: readonly SkeletonBone[] = PERSON
  for (const { name, parent, position } of skeleton) {
    const bone = new Bone()
    bone.name = name
    bone.position.copy(moved(name, new Vector3(...position)))
    const on = parent === undefined ? sized : bones.get(parent)
    if (!on) throw new Error(`the person's ${name} hangs from ${parent}, which is not listed before it`)
    on.attach(bone)
    bones.set(name, bone)
  }
  sized.scale.setScalar(scale)
  return new Group().add(sized)
}

const [X, Y, Z] = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
/** where the joints of a thumb lying along the index are, out from the wrist and ahead of it (m): a centimetre under the palm */
const ALONG = [
  [0.03, 0.025],
  [0.06, 0.035],
  [0.083, 0.04],
  [0.1, 0.043],
]

/**
 * A made-up man unlike the person, as a rig may come for the tests to stand a body on: his arms a quarter shorter, the
 * forearms reaching a little ahead and turned palm in, the hands bent back at the wrist, the fingers curled and the
 * thumb lying along the index, a little under the palm.
 */
export function other() {
  return person(1, (name, at) => {
    const arm = /^(left|right)(LowerArm|Hand|Thumb|Index|Middle|Ring|Little)(\w*)$/.exec(name)
    if (!arm) return at
    const [, side, part, joint] = arm
    const s = side === 'left' ? 1 : -1
    const [shoulder, elbow, wrist] = [0.2, 0.49, 0.81].map((out) => new Vector3(out * s, 1.42, 0))
    const turn = (axis: Vector3, angle: number, about: Vector3) => at.sub(about).applyAxisAngle(axis, angle).add(about)
    const digit = NAMES.find((finger) => finger === part)
    if (digit === 'Thumb') {
      const [out, ahead] = ALONG[PARTS.thumb.findIndex((name) => name === joint)]
      at.set(wrist.x + s * out, 1.41, ahead)
    } else if (digit && joint !== 'Proximal') {
      const [out, ahead] = HAND[digit][0]
      turn(Z, -0.4 * s, new Vector3(wrist.x + s * out, 1.42, ahead))
    }
    if (digit) {
      turn(Z, 0.35 * s, wrist)
      turn(X, 0.5 * s, wrist)
    }
    if (part !== 'LowerArm') turn(Y, -0.35 * s, elbow)
    return at.sub(shoulder).multiplyScalar(0.75).add(shoulder)
  })
}
