// BODY: a three.js bone hierarchy with hinge joints. The scene graph is the kinematic tree: a point on the
// body is any Object3D under a bone, an attached object is an Object3D parented to one. Attaching an object
// a second time closes a loop, which the solver enforces as a hard goal.

import { Bone, Object3D, Quaternion, Vector3 } from "three"
import { type Pose, Target } from "./goals"

/** One joint degree of freedom: a rotation about `axis` (in the bone's rest frame) within [min, max] rad. */
export interface Hinge {
  axis: Vector3
  min: number
  max: number
  /** Limits that depend on the pose: given the bone's own hinge angles, the [min, max] this hinge has now. They are read once per solve, at the pose it starts from. */
  range?: (own: number[]) => [number, number]
}

/** A bone that is a joint: its hinges in order, the angles of its neutral pose (0 where left out), its mass (kg) and center of mass (in its own frame). */
export class Joint extends Bone {
  constructor(
    readonly hinges: Hinge[],
    readonly neutral: number[] = [],
    readonly mass = 0,
    readonly centerOfMass = new Vector3(),
  ) {
    super()
  }
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
  bone: Joint
  first: number
  base: Quaternion
  chain: number[]
}

/**
 * The kinematic tree of the joints under a root: its angles, and the state planners read. The body stands where its
 * root stands when it is built, in the frame of the root's parent; that parent should stay still, since the body moves
 * by its angles (the root's slides among them), not by moving what it hangs in.
 */
export class Body {
  /**
   * The pose as one vector: the root's slides along its parent's x, y, z from where it was built (m), then one angle
   * per hinge (rad), bone by bone in tree order and each bone's hinges in order. The only state the solver reads and
   * writes; after changing it yourself, call `update`.
   */
  angles: number[] = []
  /** The total mass (kg) of everything on the body: valid after update(). */
  mass = 0
  /** The center of mass as a point: `soft(body.centerOfMass, support)` is a balance goal. It is moved by update(). */
  readonly centerOfMass: Object3D = Object.assign(new Object3D(), { name: "centerOfMass" })
  /** @internal The angles of the neutral pose the skeleton was built in. */
  neutral: number[] = []
  /** @internal */
  min: number[] = []
  /** @internal */
  max: number[] = []
  /** @internal Whether a degree of freedom slides (the root's position) instead of turning. */
  slide: boolean[] = []
  /** @internal World-space axis and pivot of each degree of freedom: valid after update(). */
  axis: Vector3[] = []
  /** @internal */
  origin: Vector3[] = []
  /** @internal The angles before the last solve and that solve's time step: what `velocityOf` differences against. */
  before: number[] = []
  /** @internal */
  dt = 0
  /** @internal Loops closed by a second attachment: the object's `seat` frame must coincide with the body's `point`. */
  loops: { object: Object3D; seat: Object3D; point: Object3D }[] = []
  readonly #joints: Jointed[] = []
  readonly #attached = new Set<Object3D>()
  readonly #home: Vector3

  /**
   * The body of the joints in the tree under `root`. `root` is the floating base: it slides freely along x, y, z
   * from where it stands and turns by its own hinges.
   */
  constructor(readonly root: Object3D) {
    this.#home = root.position.clone()
    for (const a of [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]) this.#add({ axis: a, min: -1e9, max: 1e9 }, 0, true)
    root.traverse((bone) => {
      if (!(bone instanceof Joint)) return
      const first = this.angles.length
      bone.hinges.forEach((h, i) => this.#add(h, bone.neutral[i] ?? 0, false))
      const above = this.#joints.findLast((j) => under(bone, j.bone) && j.bone !== bone)
      const own = bone.hinges.map((_, i) => first + i)
      this.#joints.push({ bone, first, base: bone.quaternion.clone(), chain: [...(above ? above.chain : [0, 1, 2]), ...own] })
    })
    this.update()
  }

  #add(h: Hinge, neutral: number, slide: boolean) {
    this.angles.push(neutral)
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

  /** @internal Indices of the degrees of freedom that move `object`: from the root down to its bone. */
  chain(object: Object3D): number[] {
    for (let o: Object3D | null = object; o; o = o.parent) {
      const j = this.#joints.find((x) => x.bone === o)
      if (j) return j.chain
    }
    return []
  }

  /** @internal Indices of the degrees of freedom of the joint at `bone` itself: the end of its chain. */
  dofs(bone: Object3D): number[] {
    const j = this.#joints.find((x) => x.bone === bone)
    if (!j) throw new Error(`'${bone.name}' is not a joint of the body`)
    return j.bone.hinges.map((_, i) => j.first + i)
  }

  /** The name of an entry of `angles`: the bone and which of its hinges, e.g. 'upperArmR.1', or the root's slide. */
  angleName(k: number): string {
    const j = this.#joints.find((x) => k >= x.first && k < x.first + x.bone.hinges.length)
    return j ? `${j.bone.name}.${k - j.first}` : `${this.root.name}.slide${k}`
  }

  /**
   * A whole `angles` vector: the neutral pose with the angles a pose lists put in, e.g. { forearmR: [-1.2, 0] }.
   * Throws for a bone that is not a joint, or more angles than the bone has hinges.
   */
  anglesOf(pose: Pose = {}): number[] {
    const angles = this.neutral.slice()
    for (const name in pose) {
      const j = this.#joints.find((x) => x.bone.name === name)
      if (!j) throw new Error(`the body has no jointed bone '${name}'`)
      const { length } = j.bone.hinges
      if (pose[name].length > length) throw new Error(`'${name}' has ${length} hinge${length === 1 ? "" : "s"}, not the ${pose[name].length} angles given`)
      pose[name].forEach((v, i) => (angles[j.first + i] = v))
    }
    return angles
  }

  /** @internal Reads the limits that depend on the pose (`Hinge.range`) at the pose the body is in. The solver does this once, before it starts. */
  limits() {
    for (const j of this.#joints) {
      const own = j.bone.hinges.map((_, i) => this.angles[j.first + i])
      j.bone.hinges.forEach((h, i) => h.range && ([this.min[j.first + i], this.max[j.first + i]] = h.range(own)))
    }
  }

  /** Forward kinematics: writes `angles` into the bones, updates world matrices, joint axes and the center of mass. */
  update() {
    const turn = new Quaternion(),
      frame = new Quaternion()
    this.root.position.copy(this.#home).add(new Vector3(this.angles[0], this.angles[1], this.angles[2]))
    for (const j of this.#joints) {
      j.bone.quaternion.copy(j.base)
      j.bone.hinges.forEach((h, i) => j.bone.quaternion.multiply(turn.setFromAxisAngle(h.axis, this.angles[j.first + i])))
    }
    this.root.updateWorldMatrix(true, true)
    const above = this.root.parent ? this.root.parent.getWorldQuaternion(new Quaternion()) : new Quaternion()
    for (let k = 0; k < 3; k++) this.axis[k].set(+(k === 0), +(k === 1), +(k === 2)).applyQuaternion(above)
    for (const j of this.#joints) {
      if (j.bone.parent) j.bone.parent.getWorldQuaternion(frame)
      else frame.identity()
      frame.multiply(j.base)
      const at = new Vector3().setFromMatrixPosition(j.bone.matrixWorld)
      j.bone.hinges.forEach((h, i) => {
        const k = j.first + i
        this.axis[k].copy(h.axis).applyQuaternion(frame)
        this.origin[k] = at
        frame.multiply(turn.setFromAxisAngle(h.axis, this.angles[k]))
      })
    }
    this.mass = 0
    const center = this.centerOfMass.position.set(0, 0, 0)
    for (const [, mass, at] of this.masses()) {
      this.mass += mass
      center.addScaledVector(at, mass)
    }
    if (this.mass) center.divideScalar(this.mass)
    this.centerOfMass.updateMatrixWorld()
  }

  /** World position of a point (any Object3D, the center of mass included) at the pose the last solve left. */
  positionOf(point: Object3D): Vector3 {
    return point === this.centerOfMass ? this.centerOfMass.position.clone() : point.getWorldPosition(new Vector3())
  }
  /** World rotation of a point at the pose the last solve left. */
  quaternionOf(point: Object3D): Quaternion {
    return point.getWorldQuaternion(new Quaternion())
  }
  /** World velocity of a point: how far the last solve moved it, over that solve's time step. A point off the body has the velocity it carries. */
  velocityOf(point: Object3D): Vector3 {
    if (point !== this.centerOfMass && !under(point, this.root))
      return point instanceof Target && point.given.velocity ? point.given.velocity.clone() : new Vector3()
    if (!this.dt || this.before.length !== this.angles.length) return new Vector3()
    const now = this.positionOf(point),
      pose = this.angles.slice()
    this.before.forEach((v, k) => (this.angles[k] = v))
    this.update()
    const was = this.positionOf(point)
    pose.forEach((v, k) => (this.angles[k] = v))
    this.update()
    return now.sub(was).divideScalar(this.dt)
  }

  /**
   * @internal Everything with mass on the body: [object, mass, world center of mass]. A joint has its own mass; any
   * other object under the root (an attached racket, say) weighs its `userData.mass` (kg), centred at its origin.
   */
  masses(): [Object3D, number, Vector3][] {
    const out: [Object3D, number, Vector3][] = []
    this.root.traverse((o) => {
      const mass: unknown = o instanceof Joint ? o.mass : o.userData.mass
      if (typeof mass === "number" && mass) out.push([o, mass, o.localToWorld(o instanceof Joint ? o.centerOfMass.clone() : new Vector3())])
    })
    return out
  }

  /**
   * Rigidly attach `object` so that its `seat` frame (the object itself, or an Object3D inside it) coincides with
   * `point`, a point on the body (a hand bone, or a mark on one). The first attachment carries the object at that
   * point, wherever it hung before, on the body (a sling's mark) or off it; every further attachment of the same object
   * closes a kinematic loop.
   */
  attach(object: Object3D, point: Object3D, seat: Object3D = object) {
    if (this.#attached.has(object)) this.loops.push({ object, seat, point })
    else this.#hang(object, point, seat)
    this.#attached.add(object)
    this.update()
  }

  /**
   * Let go of `object` with the bone (or point) `from`, or altogether if omitted. An object nothing holds any more
   * leaves the body where it is in the world: from then on it is the caller's business. If the point that carries it
   * lets go while another holds on, that one carries it from then on.
   */
  detach(object: Object3D, from?: Object3D) {
    const held = (point: Object3D | null) => !from || under(point, from)
    const carried = held(object.parent)
    this.loops = this.loops.filter((c) => c.object !== object || !held(c.point))
    if (!carried) return this.update()
    const next = this.loops.findIndex((c) => c.object === object)
    if (next >= 0) {
      const [{ seat, point }] = this.loops.splice(next, 1)
      this.#hang(object, point, seat)
    } else {
      this.#attached.delete(object)
      object.updateWorldMatrix(true, false)
      if (this.root.parent) this.root.parent.attach(object)
      else object.removeFromParent().matrixWorld.decompose(object.position, object.quaternion, object.scale)
    }
    this.update()
  }

  #hang(object: Object3D, point: Object3D, seat: Object3D) {
    object.removeFromParent()
    object.position.set(0, 0, 0)
    object.quaternion.identity()
    object.updateWorldMatrix(false, true)
    // The seat in the object's frame as the object's own scale sizes it: turning and moving the object by the inverse
    // of that puts the seat on the point, at whatever scale the object has.
    seat.matrixWorld.decompose(object.position, object.quaternion, new Vector3())
    object.quaternion.invert()
    object.position.applyQuaternion(object.quaternion).negate()
    point.add(object)
  }
}
