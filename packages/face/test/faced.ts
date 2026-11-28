import { Humanoid } from "@drawcall/humanoid"
import { posture, solve } from "@drawcall/ik"
import type { Speech } from "@drawcall/speech"
import { Bone, BufferAttribute, BufferGeometry, Mesh, Quaternion, Vector3 } from "three"
import { type BlendShape, type Demeanor, Face, FacePlanner } from "../src"

/** a mesh with a morph target of each name (the shapes themselves are nothing: what is tested is their weights) */
/** A mesh whose morph targets each move its vertices, or with `placeholder`, move nothing, as exporters pad a face to the 52. */
export function shaped(names: readonly string[], { placeholder = false } = {}): Mesh {
  const geometry = new BufferGeometry().setAttribute("position", new BufferAttribute(new Float32Array(9), 3))
  geometry.morphAttributes.position = names.map((name) =>
    Object.assign(new BufferAttribute(new Float32Array(9).fill(placeholder ? 0 : 0.01), 3), { name }),
  )
  const mesh = new Mesh(geometry)
  mesh.updateMorphTargets()
  return mesh
}

const SHAPES = [
  "jawOpen",
  "mouthClose",
  "mouthPressLeft",
  "mouthSmileLeft",
  "mouthFunnel",
  "eyeBlinkLeft",
  "browInnerUp",
  "cheekSquintLeft",
  "eyeWideLeft",
] as const

/** The procedural humanoid with a face on its head: a mesh with some ARKit shapes and one of another name, and eye bones resting turned by `eyeRest`. */
export function faced({ eyeRest = new Quaternion() } = {}) {
  const body = new Humanoid()
  const head = body.get("head")
  for (const [name, x] of [
    ["LeftEye", 0.032],
    ["RightEye", -0.032],
  ] as const) {
    const eye = Object.assign(new Bone(), { name })
    eye.position.set(x, 0.1, 0.08)
    eye.quaternion.copy(eyeRest)
    head.add(eye)
  }
  const mesh = shaped([...SHAPES, "freckles"])
  head.add(mesh)
  body.root.updateMatrixWorld(true)
  const face = new Face(body.root)
  const planner = new FacePlanner(face, body)
  const weight = (name: BlendShape | "freckles") => {
    const index = mesh.morphTargetDictionary?.[name]
    if (index === undefined || !mesh.morphTargetInfluences) throw new Error(`no shape ${name}`)
    return mesh.morphTargetInfluences[index]
  }
  /** where an eye looks (world): along its bone's +Z */
  const looking = (name: "LeftEye" | "RightEye") => {
    const eye = head.getObjectByName(name)
    if (!eye) throw new Error(`no ${name}`)
    return { from: eye.getWorldPosition(new Vector3()), way: new Vector3(0, 0, 1).applyQuaternion(eye.getWorldQuaternion(new Quaternion())) }
  }
  /** a frame: the planner's goals solved with the body standing upright */
  const frame = (dt: number, demeanor?: Demeanor) => solve(body, [posture(body, body.uprightPose), ...planner.update(dt, demeanor)], dt)
  return { body, head, face, planner, mesh, weight, looking, frame }
}

/** "ah, ma": an open vowel, the lips shut on m, and another */
export const AH_MA: Speech = {
  words: [
    { text: "ah", start: 0.1, end: 0.4 },
    { text: "ma", start: 0.45, end: 0.8 },
  ],
  phones: [
    { p: "AA", stress: 1, time: 0.25, start: 0.1, end: 0.4 },
    { p: "M", stress: 0, time: 0.5, start: 0.45, end: 0.55 },
    { p: "AA", stress: 1, time: 0.675, start: 0.55, end: 0.8 },
  ],
  energy: Array(100).fill(0.1),
  pitch: Array(100).fill(120),
}
