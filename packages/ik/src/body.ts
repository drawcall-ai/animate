// BODY: a three.js bone hierarchy with hinge joints. The scene graph is the kinematic tree: a point on the
// body is any Object3D under a bone, an attached object is an Object3D parented to one. Attaching an object
// a second time closes a loop, which the solver enforces as a hard goal.

import { Matrix4, Object3D, Quaternion, Vector3 } from "three"

/** One joint degree of freedom: a rotation about `axis` (in the bone's rest frame) within [min, max] rad. */
export interface Hinge {
  axis: Vector3
  min: number
  max: number
  /** Limits that depend on the pose: given the bone's own hinge angles, the [min, max] this hinge has now. They are read once per solve, at the pose it starts from. */
  range?: (own: number[]) => [number, number]
}

/** Declare a bone's joint: its hinges in order, optionally the angles of its neutral pose, its mass (kg) and centre of mass. */
export function joint(bone: Object3D, hinges: Hinge[], neutral: number[] = [], mass = 0, com = new Vector3()): void {
  Object.assign(bone.userData, { hinges, neutral, mass, com })
}

/** A named point (a frame) on a bone or object: an empty Object3D child. */
export function mark(parent: Object3D, name: string, position = new Vector3(), quaternion = new Quaternion()): Object3D {
  const point = new Object3D()
  point.name = name
  point.position.copy(position)
  point.quaternion.copy(quaternion)
  parent.add(point)
  return point
}

/** True if `object` is `top` or hangs below it. */
export const under = (object: Object3D | null, top: Object3D): boolean => {
  for (; object; object = object.parent) if (object === top) return true
  return false
}

interface Jointed {
  bone: Object3D
  first: number
  hinges: Hinge[]
  base: Quaternion
  chain: number[]
}

export class Body {
  /** The pose: three slides of the root, then one angle per hinge. The only state the solver reads and writes. */
  q: number[] = []
  /** The neutral pose the skeleton was built in. Not a goal by itself: postures come with the goals (see posture). */
  neutral: number[] = []
  min: number[] = []
  max: number[] = []
  /** Whether a degree of freedom slides (the root's position) instead of turning. */
  slide: boolean[] = []
  // world-space axis and pivot of each degree of freedom, centre of mass and total mass: valid after update()
  axis: Vector3[] = []
  origin: Vector3[] = []
  com = new Vector3()
  mass = 0
  /** The centre of mass as a point: `soft(body.centre, support)` is a balance goal. It is moved by update(). */
  readonly centre = Object.assign(new Object3D(), { name: "centre" })
  /** The pose before the last solve and that solve's time step: what `velocityOf` differences against. */
  before: number[] = []
  dt = 0
  /** Loops closed by a second attachment: the object's `grip` frame must coincide with the body's `hold` frame. */
  closures: { object: Object3D; grip: Object3D; hold: Object3D }[] = []
  private joints: Jointed[] = []
  private home: Vector3

  /** `root` is the floating base: it slides freely along x, y, z from where it stands and turns by its own hinges. */
  constructor(readonly root: Object3D) {
    this.home = root.position.clone()
    for (const a of [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]) this.add({ axis: a, min: -1e9, max: 1e9 }, 0, true)
    root.traverse((bone) => {
      const { hinges, neutral } = bone.userData as { hinges?: Hinge[]; neutral?: number[] }
      if (!hinges) return
      const first = this.q.length
      hinges.forEach((h, i) => this.add(h, neutral?.[i] ?? 0, false))
      const above = this.joints.findLast((j) => under(bone, j.bone) && j.bone !== bone)
      const own = hinges.map((_, i) => first + i)
      this.joints.push({ bone, first, hinges, base: bone.quaternion.clone(), chain: [...(above ? above.chain : [0, 1, 2]), ...own] })
    })
    this.update()
  }

  private add(h: Hinge, neutral: number, slide: boolean) {
    this.q.push(neutral)
    this.neutral.push(neutral)
    this.min.push(h.min)
    this.max.push(h.max)
    this.slide.push(slide)
    this.axis.push(h.axis.clone())
    this.origin.push(new Vector3())
  }

  /** A bone, point or attached object by name. */
  get(name: string): Object3D {
    const found = this.root.getObjectByName(name)
    if (!found) throw new Error(`the body has no '${name}'`)
    return found
  }

  /** Indices of the degrees of freedom that move `object`: from the root down to its bone. */
  chain(object: Object3D): number[] {
    for (let o: Object3D | null = object; o; o = o.parent) {
      const j = this.joints.find((x) => x.bone === o)
      if (j) return j.chain
    }
    return []
  }

  /** Name of a degree of freedom, e.g. 'upperArmR.1'. */
  name(k: number): string {
    const j = this.joints.find((x) => k >= x.first && k < x.first + x.hinges.length)
    return j ? `${j.bone.name}.${k - j.first}` : `${this.root.name}.slide${k}`
  }

  /** A full joint vector: the neutral pose with the given bones' angles replaced, e.g. { forearmR: [-1.2, 0] }. */
  pose(angles: Record<string, number[]> = {}): number[] {
    const q = this.neutral.slice()
    for (const name in angles) {
      const j = this.joints.find((x) => x.bone.name === name)
      if (!j) throw new Error(`the body has no jointed bone '${name}'`)
      angles[name].forEach((v, i) => (q[j.first + i] = v))
    }
    return q
  }

  /** Reads the limits that depend on the pose (`Hinge.range`) at the pose the body is in. The solver does this once, before it starts. */
  limits() {
    for (const j of this.joints) {
      const own = j.hinges.map((_, i) => this.q[j.first + i])
      j.hinges.forEach((h, i) => h.range && ([this.min[j.first + i], this.max[j.first + i]] = h.range(own)))
    }
  }

  /** Forward kinematics: writes the pose into the bones, updates world matrices, joint axes and the centre of mass. */
  update() {
    const turn = new Quaternion(),
      frame = new Quaternion()
    this.root.position.copy(this.home).add(new Vector3(this.q[0], this.q[1], this.q[2]))
    for (const j of this.joints) {
      j.bone.quaternion.copy(j.base)
      j.hinges.forEach((h, i) => j.bone.quaternion.multiply(turn.setFromAxisAngle(h.axis, this.q[j.first + i])))
    }
    this.root.updateWorldMatrix(true, true)
    const above = this.root.parent ? this.root.parent.getWorldQuaternion(new Quaternion()) : new Quaternion()
    for (let k = 0; k < 3; k++) this.axis[k].set(+(k === 0), +(k === 1), +(k === 2)).applyQuaternion(above)
    for (const j of this.joints) {
      if (j.bone.parent) j.bone.parent.getWorldQuaternion(frame)
      else frame.identity()
      frame.multiply(j.base)
      const at = new Vector3().setFromMatrixPosition(j.bone.matrixWorld)
      j.hinges.forEach((h, i) => {
        const k = j.first + i
        this.axis[k].copy(h.axis).applyQuaternion(frame)
        this.origin[k] = at
        frame.multiply(turn.setFromAxisAngle(h.axis, this.q[k]))
      })
    }
    this.mass = 0
    this.com.set(0, 0, 0)
    for (const [object, mass, at] of this.masses()) {
      this.mass += mass
      this.com.addScaledVector(at, mass)
      void object
    }
    if (this.mass) this.com.divideScalar(this.mass)
    this.centre.position.copy(this.com)
    this.centre.updateMatrixWorld()
  }

  // State queries for planners, at the current pose.
  positionOf(point: Object3D): Vector3 {
    return point === this.centre ? this.com.clone() : point.getWorldPosition(new Vector3())
  }
  rotationOf(point: Object3D): Quaternion {
    return point.getWorldQuaternion(new Quaternion())
  }
  /** World velocity of a point: how far the last solve moved it, over that solve's time step. A point off the body has the velocity it carries. */
  velocityOf(point: Object3D): Vector3 {
    if (point !== this.centre && !under(point, this.root)) return (point.userData.given?.velocity as Vector3 | undefined)?.clone() ?? new Vector3()
    if (!this.dt || this.before.length !== this.q.length) return new Vector3()
    const now = this.positionOf(point),
      pose = this.q.slice()
    this.before.forEach((v, k) => (this.q[k] = v))
    this.update()
    const was = this.positionOf(point)
    pose.forEach((v, k) => (this.q[k] = v))
    this.update()
    return now.sub(was).divideScalar(this.dt)
  }

  /** Everything with mass on the body: [object, mass, world centre of mass]. */
  masses(): [Object3D, number, Vector3][] {
    const out: [Object3D, number, Vector3][] = []
    this.root.traverse((o) => {
      const { mass, com } = o.userData as { mass?: number; com?: Vector3 }
      if (mass) out.push([o, mass, o.localToWorld((com ?? new Vector3()).clone())])
    })
    return out
  }

  /**
   * Rigidly attach `object` so that its `grip` frame (the object itself, or an Object3D inside it) coincides with
   * `hold`, a point on the body. The first attachment parents the object to that point; every further attachment
   * of the same object closes a kinematic loop.
   */
  attach(object: Object3D, hold: Object3D, grip: Object3D = object) {
    if (under(object, this.root)) this.closures.push({ object, grip, hold })
    else this.seat(object, hold, grip)
    this.update()
  }

  /**
   * Let go of `object` with the bone (or point) `from`, or altogether if omitted. An object no hand holds any more
   * leaves the body where it is in the world: from then on it is the caller's business. If the hold that carries it
   * is released while another remains, that one carries it from then on.
   */
  detach(object: Object3D, from?: Object3D) {
    const held = (hold: Object3D) => !from || under(hold, from)
    const carried = held(object.parent!)
    this.closures = this.closures.filter((c) => c.object !== object || !held(c.hold))
    if (!carried) return this.update()
    const next = this.closures.findIndex((c) => c.object === object)
    if (next >= 0) {
      const [{ grip, hold }] = this.closures.splice(next, 1)
      this.seat(object, hold, grip)
    } else {
      this.root.updateWorldMatrix(true, true)
      const world = object.matrixWorld.clone(),
        to = this.root.parent
      object.removeFromParent()
      object.userData.attached = false
      if (to) {
        to.updateWorldMatrix(true, false)
        world.premultiply(to.matrixWorld.clone().invert())
        to.add(object)
      }
      world.decompose(object.position, object.quaternion, object.scale)
    }
    this.update()
  }

  private seat(object: Object3D, hold: Object3D, grip: Object3D) {
    object.removeFromParent()
    object.position.set(0, 0, 0)
    object.quaternion.identity()
    object.updateWorldMatrix(false, true)
    const local = grip === object ? new Matrix4() : object.matrixWorld.clone().invert().multiply(grip.matrixWorld)
    local.invert().decompose(object.position, object.quaternion, new Vector3())
    object.userData.attached = true
    hold.add(object)
  }
}
