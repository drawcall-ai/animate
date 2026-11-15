import type { SkeletonBone } from '@drawcall/rig'

type Vec3 = readonly [number, number, number]
type Finger = 'index' | 'middle' | 'ring' | 'little'

/**
 * Where a humanoid model's joints are, measured on its mesh (m): standing on y = 0, facing +z, his left at +x. Each
 * point lies inside the solid, in the middle of the limb's cross-section. The trunk's points are on x = 0; the limbs'
 * are his left side's, mirrored for his right unless `right` gives its own.
 */
export type Landmarks = {
  /** the root, between the hip joints; the lower and upper back; the base of the neck; the base of the skull; the crown */
  hips: Vec3
  spine: Vec3
  chest: Vec3
  neck: Vec3
  head: Vec3
  crown: Vec3
  left: Limbs
  right?: Limbs
}
export type Limbs = {
  /** the inner end of the collarbone, the ball of the shoulder, the elbow, the wrist */
  shoulder: Vec3
  arm: Vec3
  elbow: Vec3
  wrist: Vec3
  /** the root of the thumb, by the wrist, and the five fingertips, just inside their ends */
  thumb: Vec3
  tips: Record<Finger | 'thumb', Vec3>
  /** the hip joint, the knee, the ankle, the ball of the foot, the tip of the toes */
  hip: Vec3
  knee: Vec3
  ankle: Vec3
  ball: Vec3
  toe: Vec3
}

/** how far out from the wrist to its fingertip each knuckle is, a hand's palm being about half its length */
const PALM: Record<Finger, number> = { index: 0.55, middle: 0.55, ring: 0.55, little: 0.52 }
/** how far each joint of a finger is from its knuckle to its fingertip, and of the thumb from its root to its tip */
const PHALANX = { finger: [0, 0.47, 0.77, 1], thumb: [0, 0.42, 0.74, 1] }
const PARTS = {
  finger: ['Proximal', 'Intermediate', 'Distal', 'Distal_end'],
  thumb: ['Metacarpal', 'Proximal', 'Distal', 'Distal_end'],
}

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const mm = (v: Vec3): [number, number, number] => [v[0], v[1], v[2]].map((n) => Math.round(n * 1000) / 1000 + 0) as [number, number, number]
const mirror = (v: Vec3): Vec3 => [-v[0], v[1], v[2]]

function side(name: 'left' | 'right', at: Limbs): SkeletonBone[] {
  const bone = (part: string, parent: string, position: Vec3) => ({ name: name + part, parent, position: mm(position) })
  const digit = (finger: string, from: Vec3, to: Vec3, kind: 'finger' | 'thumb') =>
    PARTS[kind].map((part, k) =>
      bone(finger + part, k === 0 ? `${name}Hand` : name + finger + PARTS[kind][k - 1], lerp(from, to, PHALANX[kind][k])),
    )
  const finger = (finger: Finger) => {
    const title = finger[0].toUpperCase() + finger.slice(1)
    return digit(title, lerp(at.wrist, at.tips[finger], PALM[finger]), at.tips[finger], 'finger')
  }
  return [
    // (the middle finger first: the first child ends its parent's segment, so the hand's runs to the middle knuckle)
    bone('Shoulder', 'chest', at.shoulder),
    bone('UpperArm', `${name}Shoulder`, at.arm),
    bone('LowerArm', `${name}UpperArm`, at.elbow),
    bone('Hand', `${name}LowerArm`, at.wrist),
    ...finger('middle'),
    ...finger('index'),
    ...finger('ring'),
    ...finger('little'),
    ...digit('Thumb', at.thumb, at.tips.thumb, 'thumb'),
    bone('UpperLeg', 'hips', at.hip),
    bone('LowerLeg', `${name}UpperLeg`, at.knee),
    bone('Foot', `${name}LowerLeg`, at.ankle),
    bone('Toes', `${name}Foot`, at.ball),
    bone('Toes_end', `${name}Toes`, at.toe),
  ]
}

const mirrored = (at: Limbs): Limbs => ({
  ...(Object.fromEntries(Object.entries(at).map(([key, v]) => [key, key === 'tips' ? v : mirror(v as Vec3)])) as Limbs),
  tips: Object.fromEntries(Object.entries(at.tips).map(([key, v]) => [key, mirror(v)])) as Limbs['tips'],
})

/**
 * The whole skeleton of a humanoid as @drawcall/rig takes one and @drawcall/animate drives it, its bones named as a
 * body asks, from the landmarks measured on its model: the trunk, collarbones, arms, legs and feet where they were
 * measured, and the joints of the fingers laid along each from its knuckle, which is found out along the line from the
 * wrist to its fingertip. The vitecache plugin reads a rig load only as it is written, so print this and write it out
 * in the load with `written`.
 */
export function humanoid(at: Landmarks): SkeletonBone[] {
  const trunk = (name: string, parent: string | undefined, position: Vec3) => ({ name, parent, position: mm(position) })
  return [
    trunk('hips', undefined, at.hips),
    trunk('spine', 'hips', at.spine),
    trunk('chest', 'spine', at.chest),
    trunk('neck', 'chest', at.neck),
    trunk('head', 'neck', at.head),
    trunk('head_end', 'head', at.crown),
    ...side('left', at.left),
    ...side('right', at.right ?? mirrored(at.left)),
  ].map(({ parent, ...bone }) => (parent === undefined ? bone : { ...bone, parent }))
}

/** a skeleton written out as the entries of a load's `skeleton`, one bone a line */
export const written = (skeleton: readonly SkeletonBone[]) =>
  skeleton
    .map(({ name, parent, position }) => {
      const on = parent === undefined ? '' : ` parent: '${parent}',`
      return `{ name: '${name}',${on} position: [${position.join(', ')}] },`
    })
    .join('\n')
