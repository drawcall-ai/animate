export type Triple = [x: number, y: number, z: number]

export type Side = 'left' | 'right'
export const SIDES: Side[] = ['left', 'right']
export type PartName = 'pelvis' | 'chest' | 'head' | `${Side}${'UpperArm' | 'Forearm' | 'Thigh' | 'Shin' | 'Foot'}`

/**
 * A body part standing at rest, facing +z with its left at +x: a capsule along y, or a box, around `center` (m).
 * `joint` ties it to its parent `at` a point; `strength` is the most torque its muscle gives (N m) and
 * `hinge` limits it to turning about x within these angles (rad).
 */
export type Bone = {
  center: Triple
  shape: { half: number; radius: number } | { box: Triple }
  kg: number
  joint?: { parent: PartName; at: Triple; strength: number; hinge?: [min: number, max: number] }
  /** inertia added about every axis (kg m²): the pelvis alone is too light for the muscles pulling on it to be stepped stably */
  ballast?: number
}

/** a leg: how far the hips are apart from the middle, and how high hip, knee and ankle are when standing (m) */
export const LEG = { aside: 0.09, hip: 0.95, knee: 0.51, ankle: 0.07 }
export const THIGH = LEG.hip - LEG.knee
export const SHIN = LEG.knee - LEG.ankle

const upperArm = (x: number): Bone => ({
  center: [x, 1.335, 0],
  shape: { half: 0.1, radius: 0.045 },
  kg: 2,
  joint: { parent: 'chest', at: [x, 1.48, 0], strength: 100 },
})
const forearm = (x: number, parent: PartName): Bone => ({
  center: [x, 1.03, 0],
  shape: { half: 0.12, radius: 0.04 },
  kg: 1.7,
  joint: { parent, at: [x, 1.19, 0], strength: 70, hinge: [-2.6, 0] },
})
const thigh = (x: number): Bone => ({
  center: [x, (LEG.hip + LEG.knee) / 2, 0],
  shape: { half: 0.15, radius: 0.07 },
  kg: 8,
  joint: { parent: 'pelvis', at: [x, LEG.hip, 0], strength: 300 },
})
const shin = (x: number, parent: PartName): Bone => ({
  center: [x, (LEG.knee + LEG.ankle) / 2, 0],
  shape: { half: 0.16, radius: 0.05 },
  kg: 3.5,
  joint: { parent, at: [x, LEG.knee, 0], strength: 200, hinge: [0, 2.6] },
})
const foot = (x: number, parent: PartName): Bone => ({
  center: [x, 0.035, 0.06],
  shape: { box: [0.045, 0.035, 0.12] },
  kg: 1,
  joint: { parent, at: [x, LEG.ankle, 0], strength: 120 },
})

/** a person of 1.78 m and 72 kg; every part is listed after its parent */
export const SKELETON: Record<PartName, Bone> = {
  pelvis: { center: [0, 1.02, 0], shape: { half: 0.02, radius: 0.11 }, kg: 11, ballast: 0.8 },
  chest: {
    center: [0, 1.32, 0],
    shape: { half: 0.12, radius: 0.13 },
    kg: 24,
    joint: { parent: 'pelvis', at: [0, 1.1, 0], strength: 400 },
  },
  head: {
    center: [0, 1.68, 0],
    shape: { half: 0.01, radius: 0.1 },
    kg: 5,
    joint: { parent: 'chest', at: [0, 1.55, 0], strength: 50 },
  },
  leftUpperArm: upperArm(0.2),
  leftForearm: forearm(0.2, 'leftUpperArm'),
  rightUpperArm: upperArm(-0.2),
  rightForearm: forearm(-0.2, 'rightUpperArm'),
  leftThigh: thigh(LEG.aside),
  leftShin: shin(LEG.aside, 'leftThigh'),
  leftFoot: foot(LEG.aside, 'leftShin'),
  rightThigh: thigh(-LEG.aside),
  rightShin: shin(-LEG.aside, 'rightThigh'),
  rightFoot: foot(-LEG.aside, 'rightShin'),
}

/** something for every part, made in the order of the skeleton */
export function eachPart<T>(make: (name: PartName) => T): Record<PartName, T> {
  return {
    pelvis: make('pelvis'),
    chest: make('chest'),
    head: make('head'),
    leftUpperArm: make('leftUpperArm'),
    leftForearm: make('leftForearm'),
    rightUpperArm: make('rightUpperArm'),
    rightForearm: make('rightForearm'),
    leftThigh: make('leftThigh'),
    leftShin: make('leftShin'),
    leftFoot: make('leftFoot'),
    rightThigh: make('rightThigh'),
    rightShin: make('rightShin'),
    rightFoot: make('rightFoot'),
  }
}

const hangsOn = (name: PartName, ancestor: PartName): boolean => {
  const parent = SKELETON[name].joint?.parent
  return name === ancestor || (parent !== undefined && hangsOn(parent, ancestor))
}

/**
 * What a muscle has to turn: the inertia of a part and all that hangs on it about the part's joint (kg m²), given
 * along the part's axes. About its length (y) a limb is far easier to turn than across it.
 */
export function inertia(name: PartName): Triple {
  const at = SKELETON[name].joint?.at ?? SKELETON[name].center
  let across = 0
  let along = 0
  eachPart((other) => {
    if (!hangsOn(other, name)) return
    const { center, shape, kg } = SKELETON[other]
    const [length, thick] = 'box' in shape ? [2 * Math.max(...shape.box), Math.min(...shape.box)] : [2 * (shape.half + shape.radius), shape.radius]
    const [x, y, z] = [center[0] - at[0], center[1] - at[1], center[2] - at[2]]
    across += kg * (x * x + y * y + z * z + length ** 2 / 12)
    along += kg * (x * x + z * z + thick ** 2 / 2)
  })
  return [across, along, across]
}
