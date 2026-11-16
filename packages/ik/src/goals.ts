// GOAL: point a should match point b, for this frame. There is no time in a goal: whoever plans rebuilds the list
// every frame. Both points are three.js Object3Ds in the scene graph: markers on bones or on attached objects, or
// world points a planner moves each frame. The solver knows which nodes are joints; everything else is fixed during
// the solve, so a goal between two points of the body (a box at a marker on the chest) is differentiated exactly.

import { Object3D, Quaternion, Vector3 } from "three"
import { type Body } from "./body"

/** What a target point carries. A plain Object3D carries its position and rotation; a `Target` carries what it was given. */
export interface Given {
  position?: boolean
  rotation?: boolean
  /** World velocity (m/s) the matched point should have: met as a backward difference against the pose before the solve. */
  velocity?: Vector3
  /** Per-world-axis weights of the position and velocity rows, e.g. (1, 0, 1) = horizontal only. */
  axes?: Vector3
}

/** A world point for a planner to move each frame. It carries exactly what the last `set` gave it. */
export class Target extends Object3D {
  set(given: { position?: Vector3; quaternion?: Quaternion; velocity?: Vector3; axes?: Vector3 }): this {
    if (given.position) this.position.copy(given.position)
    if (given.quaternion) this.quaternion.copy(given.quaternion)
    const carried: Given = { position: !!given.position, rotation: !!given.quaternion, velocity: given.velocity?.clone(), axes: given.axes }
    this.userData.given = carried
    this.updateMatrixWorld()
    return this
  }
}

export type Goal = { a: Object3D; b: Object3D; hard: boolean; weight: number } | { joints: ArrayLike<number>; weights: ArrayLike<number>; weight: number }

/** Point a must match point b: exactly, or as close as can be reached. Two hard goals on one point in a solve throw. */
export const hard = (a: Object3D, b: Object3D): Goal => ({ a, b, hard: true, weight: 1 })
/** Point a should match point b as well as the hard goals and the other soft goals allow. */
export const soft = (a: Object3D, b: Object3D, weight = 1): Goal => ({ a, b, hard: false, weight })

/** Joint angles per bone name, e.g. { spine: [0, 0, 0], forearmR: [-1.4, 0] }. Bones may be left out. */
export type Pose = Record<string, number[]>

const TIE = 0.03 // pull on the bones a pose leaves out, relative to the ones it lists (weaker and the solver stalls on what nothing decides)

/**
 * Soft posture goal: pull the bones a pose lists towards their angles. There is no built-in idea of comfort;
 * whoever plans says what posture the activity has this frame. A pose may leave bones out: those are free to do
 * what the other goals need, so "trunk and legs upright, arms not listed" makes the arms do the reaching before the
 * trunk gives way. Left-out bones get a very weak pull towards neutral, only so that what no goal decides (an
 * elbow's swing, say) still has one answer.
 */
export function posture(body: Body, pose: Pose, weight = 0.1): Goal {
  const joints = body.pose(pose),
    weights = joints.map(() => TIE)
  body.pose(Object.fromEntries(Object.entries(pose).map(([name, a]) => [name, a.map(() => NaN)]))).forEach((v, k) => {
    if (Number.isNaN(v)) weights[k] = 1
  })
  return { joints, weights, weight }
}
