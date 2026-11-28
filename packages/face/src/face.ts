import { Mesh, type Object3D, Quaternion, SkinnedMesh, Vector3 } from "three"
import { type BlendShape, blendShapeOf, type Expression, isBlendShape } from "./blendshapes"

/** Where an eye looks from its rest (rad): `yaw` + toward the character's left, `pitch` + down. */
export interface Look {
  yaw: number
  pitch: number
}

/** Where each eye looks; `left` is the character's own. */
export interface Eyes {
  left: Look
  right: Look
}

/** the names an eye bone goes by: the ARKit rigs' and VRM's */
const EYE_BONES = { left: ["LeftEye", "leftEye"], right: ["RightEye", "rightEye"] } as const
/** how far an eye looks (rad) at a weight of 1 of its `eyeLook` shapes: sideways, and up or down */
const LOOK_RANGE = { side: 0.6, vertical: 0.5 } as const
/** the upper lid following an eye its bone turns, as `eyeLook` shapes move it: down (+) or up by the eye's pitch (× rad), at most so far each way (of a blink) */
const FOLLOW = { pitch: 1.3, down: 0.35, up: 0.2 }

type Side = "left" | "right"
/** where an eye looks from: a point and a frame (+Z forward, +Y up, +X the character's left) in `anchor`'s, which carries them */
type Seat = { anchor: Object3D; origin: Vector3; frame: Quaternion }
/** an eye: its bone, if any, and that bone's rest turn; whether shapes turn it; and, shapes turning it without a bone, its seat */
type Eye = { bone: Object3D | undefined; rest: Quaternion | undefined; shaped: boolean; seat: Seat | undefined }

/**
 * A model's face as the ARKit standard has it: the 52 blendshapes as morph targets, on whichever meshes carry them (a face,
 * teeth, a tongue, each with the shapes that move it), named as Apple does (`eyeBlinkLeft`) or with another case, separators
 * or sides (`eyeBlink_L`). It drives the shapes it finds and no others: a model with only some of the 52 moves only by those,
 * and morph targets of other names are left alone.
 *
 * An eye turns by its `eyeLook` shapes where the model has them, else by its bone, `LeftEye` or `RightEye` (VRM: `leftEye`,
 * `rightEye`), resting in the face's frame (+Z forward, +Y up, +X the character's left) and turned from that rest about its own Y
 * and X, the upper lid following it as the shapes would move it. Eye bones are found in the skinned meshes' skeletons,
 * wherever a `Humanoid` has moved them, else in the model. Where it looks from is its bone's or, without one, the middle of
 * what its `eyeLook` shapes move, in the model's frame (+Z forward) as it rests, carried by the bone that skins most of that or
 * else by the mesh. Read the face at rest, before its eyes are turned, as their turn then is their rest.
 */
export class Face {
  readonly #meshes: { mesh: Mesh; shapes: [index: number, name: BlendShape][] }[] = []
  readonly #eyes: Record<Side, Eye>

  /** Throws for a model with neither an ARKit blendshape nor an eye bone. */
  constructor(model: Object3D) {
    const bones: Object3D[] = []
    const carried = new Set<BlendShape>()
    model.traverse((node) => {
      if (node instanceof SkinnedMesh) bones.push(...node.skeleton.bones)
      if (!(node instanceof Mesh) || !node.morphTargetDictionary) return
      const shapes = Object.entries(node.morphTargetDictionary).flatMap(([name, index]): [number, BlendShape][] => {
        const shape = blendShapeOf(name)
        return shape ? [[index, shape]] : []
      })
      for (const [, shape] of shapes) carried.add(shape)
      if (shapes.length) this.#meshes.push({ mesh: node, shapes })
    })
    const eye = (side: Side): Eye => {
      const named = (name: string) => bones.find((b) => b.name === name) ?? model.getObjectByName(name)
      const bone = EYE_BONES[side].map(named).find((b) => b !== undefined)
      const sided = side === "left" ? "Left" : "Right"
      const looks = (["In", "Out", "Up", "Down"] as const).map((way) => `eyeLook${way}${sided}` as const)
      const shaped = looks.some((name) => carried.has(name))
      return { bone, rest: bone?.quaternion.clone(), shaped, seat: shaped && !bone ? this.#seat(model, looks) : undefined }
    }
    this.#eyes = { left: eye("left"), right: eye("right") }
    if (!this.#meshes.length && !this.#eyes.left.bone && !this.#eyes.right.bone)
      throw new Error("the model has no ARKit face: no morph target named as an ARKit blendshape, and no LeftEye or RightEye bone")
  }

  /** where an eye looks from that `looks` turn: the middle of what they move, on the first mesh they move anything of */
  #seat(model: Object3D, looks: readonly BlendShape[]): Seat | undefined {
    model.updateWorldMatrix(true, true)
    for (const { mesh, shapes } of this.#meshes) {
      const targets = shapes.filter(([, name]) => looks.includes(name)).map(([index]) => mesh.geometry.morphAttributes.position?.[index])
      const base = mesh.geometry.getAttribute("position")
      const moved: number[] = []
      for (let i = 0; i < base.count; i++)
        if (
          targets.some(
            (t) =>
              t &&
              _d
                .fromBufferAttribute(t, i)
                .sub(mesh.geometry.morphTargetsRelative ? _p.set(0, 0, 0) : _p.fromBufferAttribute(base, i))
                .lengthSq() > 1e-12,
          )
        )
          moved.push(i)
      if (!moved.length) continue
      const middle = moved.reduce((sum, i) => sum.add(_d.fromBufferAttribute(base, i)), new Vector3()).divideScalar(moved.length)
      // a skinned mesh's eye goes with the bone skinning the vertex nearest the middle most
      let anchor: Object3D = mesh
      if (mesh instanceof SkinnedMesh) {
        const nearest = moved.reduce((a, i) =>
          _d.fromBufferAttribute(base, i).distanceToSquared(middle) < _p.fromBufferAttribute(base, a).distanceToSquared(middle) ? i : a,
        )
        const weights = [0, 1, 2, 3].map((k) => mesh.geometry.getAttribute("skinWeight").getComponent(nearest, k))
        anchor = mesh.skeleton.bones[mesh.geometry.getAttribute("skinIndex").getComponent(nearest, weights.indexOf(Math.max(...weights)))] ?? mesh
      }
      const origin = anchor.worldToLocal(mesh.localToWorld(middle))
      const frame = anchor.getWorldQuaternion(new Quaternion()).invert().multiply(model.getWorldQuaternion(_q))
      return { anchor, origin, frame }
    }
  }

  /**
   * Sets every blendshape the model carries to its weight in `expression` (0 where left out), and turns the eyes by `eyes` from
   * their rest (default: at rest): by their `eyeLook` shapes, added to the expression's, a weight of 1 looking 0.6 rad sideways or 0.5 rad up or down; else by
   * their bones, the upper lids following. Throws on a name that is no ARKit blendshape or a weight that is not finite.
   */
  set(expression: Readonly<Expression>, eyes?: Readonly<Eyes>): void {
    for (const [name, weight] of Object.entries(expression)) {
      if (!isBlendShape(name)) throw new Error(`"${name}" is no ARKit blendshape`)
      if (!Number.isFinite(weight)) throw new Error(`the blendshape ${name} is given a weight of ${weight}`)
    }
    const w: Expression = { ...expression }
    for (const side of ["left", "right"] as const) this.#look(w, side, eyes?.[side] ?? { yaw: 0, pitch: 0 })
    for (const { mesh, shapes } of this.#meshes) {
      const influences = mesh.morphTargetInfluences
      if (!influences) throw new Error(`the mesh "${mesh.name}" has morph targets but no influences`)
      for (const [index, name] of shapes) influences[index] = w[name] ?? 0
    }
  }

  /** How each eye would turn from its rest to look at `point` (world), from where it is now. An eye with neither a bone nor `eyeLook` shapes looks ahead. */
  lookAt(point: Readonly<Vector3>): Eyes {
    const look = ({ bone, rest, seat }: Eye): Look => {
      if (bone?.parent && rest) {
        bone.getWorldPosition(_p)
        bone.parent.getWorldQuaternion(_q).multiply(rest)
      } else if (seat) {
        seat.anchor.localToWorld(_p.copy(seat.origin))
        seat.anchor.getWorldQuaternion(_q).multiply(seat.frame)
      } else return { yaw: 0, pitch: 0 }
      const d = _d.subVectors(point, _p).applyQuaternion(_q.invert())
      return { yaw: Math.atan2(d.x, d.z), pitch: Math.atan2(-d.y, Math.hypot(d.x, d.z)) }
    }
    return { left: look(this.#eyes.left), right: look(this.#eyes.right) }
  }

  /** the eye on `side` looking `look`: by its shapes into `w`, else by its bone, the lid following into `w` */
  #look(w: Expression, side: Side, { yaw, pitch }: Look) {
    const { bone, rest, shaped } = this.#eyes[side]
    const sided = side === "left" ? "Left" : "Right"
    if (shaped) {
      // toward the character's left the left eye looks out and the right one in
      const [toLeft, toRight] = side === "left" ? (["Out", "In"] as const) : (["In", "Out"] as const)
      const look = (way: "In" | "Out" | "Up" | "Down", angle: number, range: number) => {
        const name = `eyeLook${way}${sided}` as const
        w[name] = clamp((w[name] ?? 0) + Math.max(0, angle) / range, 0, 1)
      }
      look(toLeft, yaw, LOOK_RANGE.side)
      look(toRight, -yaw, LOOK_RANGE.side)
      look("Down", pitch, LOOK_RANGE.vertical)
      look("Up", -pitch, LOOK_RANGE.vertical)
      return
    }
    if (!bone || !rest) return
    bone.quaternion.copy(rest).multiply(_q.setFromAxisAngle(Y, yaw)).multiply(_q.setFromAxisAngle(X, pitch))
    // the lid follows less as it closes, so that a blink still shuts it
    const blink = `eyeBlink${sided}` as const,
      lid = clamp(w[blink] ?? 0, 0, 1)
    w[blink] = clamp(lid + clamp(pitch * FOLLOW.pitch, -FOLLOW.up, FOLLOW.down) * (1 - lid), 0, 1)
  }
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const X = new Vector3(1, 0, 0),
  Y = new Vector3(0, 1, 0)
const _q = new Quaternion(),
  _d = new Vector3(),
  _p = new Vector3()
