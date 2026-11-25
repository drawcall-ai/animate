// GOAL: a point should match a target, for this frame. There is no time in a goal: whoever plans rebuilds the list
// every frame. Both are three.js Object3Ds in the scene graph: markers on bones or on attached objects, or world
// points a planner moves each frame. The solver knows which nodes are joints; everything else is fixed during the
// solve, so a goal between two points of the body (a box at a marker on the chest) is differentiated exactly.

import { Object3D, Quaternion, Vector3 } from "three"
import { type Body } from "./body"

/** What a target carries, and so what a goal on it matches. A plain Object3D carries its position and quaternion; a `Target` carries what it was given. */
export interface Given {
  position?: boolean
  quaternion?: boolean
  /** World velocity (m/s) the matched point should have: met as a backward difference against the pose before the solve. */
  velocity?: Vector3
  /** Per-world-axis weights of the position and velocity rows, e.g. (1, 0, 1) = horizontal only. */
  axisWeights?: Vector3
}

/** A world point for a planner to move each frame. It carries exactly what the last `set` gave it. */
export class Target extends Object3D {
  /** What it carries: until the first `set`, like any Object3D, its position and quaternion. */
  given: Given = { position: true, quaternion: true }

  /** What it carries from now on: a position (m, world), a quaternion, a velocity (m/s, world), and weights for the position and velocity per world axis, 1 for each axis by default ((1, 0, 1): horizontal only). */
  set(given: { position?: Vector3; quaternion?: Quaternion; velocity?: Vector3; axisWeights?: Vector3 }): this {
    if (given.position) this.position.copy(given.position)
    if (given.quaternion) this.quaternion.copy(given.quaternion)
    this.given = { position: !!given.position, quaternion: !!given.quaternion, velocity: given.velocity?.clone(), axisWeights: given.axisWeights }
    this.updateMatrixWorld()
    return this
  }
}

/**
 * A goal for one solve: `point` matches `target` (see `hard`, `soft`), `point` keeps out of a capsule (see `clear`),
 * or the angles are pulled softly towards `angles`, each by `weight * weights[k]` (see `posture`, `stay`). A goal has
 * no time, no window and no owner: one that should fade is a soft goal whose weight the planner changes, one that
 * should stop is left out of the next frame's list.
 */
export type Goal =
  | { point: Object3D; target: Object3D; hard: boolean; weight: number }
  | { point: Object3D; from: Object3D; to: Object3D; radius: number; hard: false; weight: number }
  | { angles: ArrayLike<number>; weights: ArrayLike<number>; weight: number }

/** `point` must match `target`: exactly, or as close as can be reached. Two hard goals on one point in a solve throw. */
export const hard = (point: Object3D, target: Object3D): Goal => ({ point, target, hard: true, weight: 1 })
/** `point` should match `target` as well as the hard goals and the other soft goals allow, pulled by `weight`. */
export const soft = (point: Object3D, target: Object3D, weight = 1): Goal => ({ point, target, hard: false, weight })

/**
 * `point` should stay at least `radius` (m) from the segment between `from` and `to`: out of a capsule, such as a trunk
 * between a mark on the pelvis and one on the chest. While the point is inside, it is pushed straight out like a soft
 * goal of `weight`, the push growing to that strength over the first centimetre in; while it is clear, the goal does
 * nothing. Either end may be on the body or fixed in the world. Its result's `missedBy` is how deep the point still is
 * inside.
 */
export const clear = (point: Object3D, from: Object3D, to: Object3D, radius: number, weight = 1): Goal => ({ point, from, to, radius, hard: false, weight })

/** Joint angles per bone name, e.g. { spine: [0, 0, 0], forearmR: [-1.4, 0] }, each bone's in the order of its hinges. Bones may be left out. */
export type Pose = Record<string, number[]>

const TIE = 0.03 // pull on the bones a pose leaves out, relative to the ones it lists (weaker and the solver stalls on what nothing decides)

/**
 * Soft posture goal: pull the bones a pose lists towards their angles. There is no built-in idea of comfort;
 * whoever plans says what posture the activity has this frame. A pose may leave bones out: those are free to do
 * what the other goals need, so "trunk and legs upright, arms not listed" makes the arms do the reaching before the
 * trunk gives way. Left-out bones get a very weak pull towards neutral, only so that what no goal decides (an
 * elbow's swing, say) still has one answer; `unlistedWeight` sets that pull, relative to the listed bones' (1). The bones named
 * in `skip` get no pull at all: someone else has them.
 */
export function posture(body: Body, pose: Pose, weight = 0.1, { unlistedWeight = TIE, skip = [] }: { unlistedWeight?: number; skip?: string[] } = {}): Goal {
  const angles = body.anglesOf(pose),
    weights = angles.map(() => unlistedWeight)
  body.anglesOf(Object.fromEntries(Object.entries(pose).map(([name, a]) => [name, a.map(() => NaN)]))).forEach((v, k) => {
    if (Number.isNaN(v)) weights[k] = 1
  })
  for (const name of skip) for (const k of body.dofs(body.get(name))) weights[k] = 0
  return { angles, weights, weight }
}

/**
 * Soft goal to stay near the pose the body is in: the bones named (all of them by default) are pulled towards their
 * angles now, so that no joint turns far in a frame without need, or what a planner lets go of eases out rather than
 * snapping. Build it every frame, from the pose the last solve left.
 */
export function stay(body: Body, weight = 1, bones?: string[]): Goal {
  const weights = body.angles.map(() => (bones ? 0 : 1))
  for (const name of bones ?? []) for (const k of body.dofs(body.get(name))) weights[k] = 1
  return { angles: body.angles.slice(), weights, weight }
}
