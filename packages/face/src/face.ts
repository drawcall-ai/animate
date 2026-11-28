import { Mesh, type Object3D, Quaternion, SkinnedMesh, Vector3 } from "three"
import { type BlendShape, type Expression, isBlendShape } from "./blendshapes"

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

const EYE_BONES = { left: "LeftEye", right: "RightEye" } as const

/** an eye bone and its rest turn, in whose frame it looks along +Z, +Y up and +X to the character's left */
type Eye = { bone: Object3D; rest: Quaternion }

/**
 * A model's face as the ARKit standard has it: the 52 blendshapes as morph targets, on whichever meshes carry them (a face,
 * teeth, a tongue, each with the shapes that move it), and the eyes as the bones `LeftEye` and `RightEye`, each resting in the
 * face's frame (+Z forward, +Y up, +X the character's left) and turned from that rest about its own Y and X. Morph targets of
 * other names are left alone. The eye bones are found in the model or, once a `Humanoid` has taken the model's bones out from
 * under it, in its skinned meshes' skeletons; read it before its eyes are turned, as their turn then is their rest. A face
 * without eye bones looks ahead.
 */
export class Face {
  readonly #meshes: { mesh: Mesh; shapes: [index: number, name: BlendShape][] }[] = []
  readonly #eyes: { left: Eye | undefined; right: Eye | undefined }

  /** Throws for a model with neither a blendshape nor an eye bone. */
  constructor(model: Object3D) {
    const bones: Object3D[] = []
    model.traverse((node) => {
      if (node instanceof SkinnedMesh) bones.push(...node.skeleton.bones)
      if (!(node instanceof Mesh) || !node.morphTargetDictionary) return
      const shapes = Object.entries(node.morphTargetDictionary).flatMap(([name, index]): [number, BlendShape][] => (isBlendShape(name) ? [[index, name]] : []))
      if (shapes.length) this.#meshes.push({ mesh: node, shapes })
    })
    const eye = (name: string): Eye | undefined => {
      const bone = model.getObjectByName(name) ?? bones.find((b) => b.name === name)
      return bone && { bone, rest: bone.quaternion.clone() }
    }
    this.#eyes = { left: eye(EYE_BONES.left), right: eye(EYE_BONES.right) }
    if (!this.#meshes.length && !this.#eyes.left && !this.#eyes.right)
      throw new Error("the model has no ARKit face: no morph target named as an ARKit blendshape, and no LeftEye or RightEye bone")
  }

  /** Sets every blendshape the model carries to its weight in `expression` (0 where left out), and turns the eyes by `eyes` from their rest (default: at rest). Throws on a name that is no ARKit blendshape or a weight that is not finite. */
  set(expression: Readonly<Expression>, eyes?: Readonly<Eyes>): void {
    for (const [name, weight] of Object.entries(expression)) {
      if (!isBlendShape(name)) throw new Error(`"${name}" is no ARKit blendshape`)
      if (!Number.isFinite(weight)) throw new Error(`the blendshape ${name} is given a weight of ${weight}`)
    }
    for (const { mesh, shapes } of this.#meshes) {
      const influences = mesh.morphTargetInfluences
      if (!influences) throw new Error(`the mesh "${mesh.name}" has morph targets but no influences`)
      for (const [index, name] of shapes) influences[index] = expression[name] ?? 0
    }
    for (const side of ["left", "right"] as const) {
      const eye = this.#eyes[side]
      if (!eye) continue
      const { yaw, pitch } = eyes?.[side] ?? { yaw: 0, pitch: 0 }
      eye.bone.quaternion.copy(eye.rest).multiply(_q.setFromAxisAngle(Y, yaw)).multiply(_q.setFromAxisAngle(X, pitch))
    }
  }

  /** How each eye would turn from its rest to look at `point` (world), from where it is now. An eye without its bone looks ahead. */
  lookAt(point: Readonly<Vector3>): Eyes {
    const look = (eye: Eye | undefined): Look => {
      if (!eye?.bone.parent) return { yaw: 0, pitch: 0 }
      const rest = eye.bone.parent.getWorldQuaternion(_q).multiply(eye.rest)
      const d = _d.subVectors(point, eye.bone.getWorldPosition(_p)).applyQuaternion(rest.invert())
      return { yaw: Math.atan2(d.x, d.z), pitch: Math.atan2(-d.y, Math.hypot(d.x, d.z)) }
    }
    return { left: look(this.#eyes.left), right: look(this.#eyes.right) }
  }
}

const X = new Vector3(1, 0, 0),
  Y = new Vector3(0, 1, 0)
const _q = new Quaternion(),
  _d = new Vector3(),
  _p = new Vector3()
