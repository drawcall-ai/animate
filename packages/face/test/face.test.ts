import { Bone, BufferAttribute, BufferGeometry, Group, Mesh, Quaternion, Skeleton, SkinnedMesh, Vector3 } from "three"
import { expect, test } from "vitest"
import { Face } from "../src"
import { faced, shaped } from "./faced"

test("sets every ARKit shape on every mesh carrying it, 0 where left out, and leaves morph targets of other names alone", () => {
  const model = new Group()
  const face = shaped(["jawOpen", "mouthSmileLeft", "freckles"]),
    teeth = shaped(["jawOpen"])
  model.add(face, teeth)
  face.morphTargetInfluences?.fill(0.3)
  new Face(model).set({ jawOpen: 0.4 })
  expect(face.morphTargetInfluences).toEqual([0.4, 0, 0.3])
  expect(teeth.morphTargetInfluences).toEqual([0.4])
})

test("refuses a model without an ARKit face, a name that is no ARKit blendshape and a weight that is not finite", () => {
  expect(() => new Face(shaped(["freckles"]))).toThrow("no ARKit face")
  const face = new Face(shaped(["jawOpen"]))
  // @ts-expect-error: only ARKit's names
  expect(() => face.set({ freckles: 1 })).toThrow('"freckles" is no ARKit blendshape')
  expect(() => face.set({ jawOpen: NaN })).toThrow("jawOpen is given a weight of NaN")
})

test("turns its eye bones from however they rest to look at a point", () => {
  const rest = new Quaternion().setFromAxisAngle(new Vector3(1, 2, -0.5).normalize(), 1.1)
  const { face, looking } = faced({ eyeRest: rest }),
    at = new Vector3(0.4, 1.9, 1.2)
  face.set({}, face.lookAt(at))
  for (const name of ["LeftEye", "RightEye"] as const) {
    const { from, way } = looking(name)
    expect(way.angleTo(at.clone().sub(from)), name).toBeLessThan(1e-6)
  }
})

test("finds eye bones its skinned meshes hold elsewhere, as a humanoid that took the model's bones has them", () => {
  const model = new Group(),
    elsewhere = new Group()
  const eye = Object.assign(new Bone(), { name: "LeftEye" })
  elsewhere.add(eye)
  const mesh = new SkinnedMesh(shaped(["jawOpen"]).geometry)
  mesh.bind(new Skeleton([eye]))
  model.add(mesh)
  new Face(model).set({}, { left: { yaw: 0.3, pitch: 0 }, right: { yaw: 0, pitch: 0 } })
  expect(eye.quaternion.angleTo(new Quaternion())).toBeCloseTo(0.3)
})

test("reads blendshapes named with other separators and sides; turns an eye by its bone, and by its eyeLook shapes what the bone does not carry", () => {
  const model = new Group()
  const looks = ["eyeBlink_L", "eyeLookOut_L", "eyeLookIn_L", "eyeLookDown_L", "eyeLookUp_L"]
  const lids = shaped(looks),
    ball = shaped(looks)
  const eye = Object.assign(new Bone(), { name: "leftEye" })
  eye.add(ball)
  model.add(lids, eye)
  new Face(model).set({ eyeBlinkLeft: 0.5 }, { left: { yaw: 0.3, pitch: -0.25 }, right: { yaw: 0, pitch: 0 } })
  expect(lids.morphTargetInfluences).toEqual([0.5, 0.5, 0, 0, 0.5])
  expect(ball.morphTargetInfluences).toEqual([0.5, 0, 0, 0, 0])
  expect(eye.quaternion.angleTo(new Quaternion())).toBeGreaterThan(0.3)
})

test("lets the upper lid follow a bone eye whose eyeLook shapes are placeholders that move nothing", () => {
  const model = new Group()
  const lids = shaped(["eyeBlinkLeft", "eyeLookDownLeft"], { placeholder: true })
  model.add(lids, Object.assign(new Bone(), { name: "LeftEye" }))
  new Face(model).set({}, { left: { yaw: 0, pitch: 0.3 }, right: { yaw: 0, pitch: 0 } })
  expect(lids.morphTargetInfluences?.[0]).toBeGreaterThan(0.1)
})

test("turns a VRM eye bone where there are no eyeLook shapes, the lid following it down", () => {
  const model = new Group()
  const mesh = shaped(["eyeBlinkLeft"]),
    eye = Object.assign(new Bone(), { name: "leftEye" })
  model.add(mesh, eye)
  new Face(model).set({}, { left: { yaw: 0, pitch: 0.2 }, right: { yaw: 0, pitch: 0 } })
  expect(eye.quaternion.angleTo(new Quaternion())).toBeCloseTo(0.2)
  expect(mesh.morphTargetInfluences?.[0]).toBeGreaterThan(0.2)
})

test("looks at a point from the middle of what an eye's eyeLook shapes move, where the eye has no bone", () => {
  // two vertices of a left eye at x 0.03, one elsewhere; the eyeLook shapes move the eye's alone
  const geometry = new BufferGeometry().setAttribute("position", new BufferAttribute(new Float32Array([0.02, 1.6, 0.1, 0.04, 1.6, 0.1, 0, 1.3, 0]), 3))
  const moves = new Float32Array([0.001, 0, 0, 0.001, 0, 0, 0, 0, 0])
  geometry.morphAttributes.position = ["eyeLookOutLeft", "eyeLookInLeft", "eyeLookUpLeft", "eyeLookDownLeft"].map((name) =>
    Object.assign(new BufferAttribute(moves.slice(), 3), { name }),
  )
  geometry.morphTargetsRelative = true
  const mesh = new Mesh(geometry)
  mesh.updateMorphTargets()
  const eyes = new Face(mesh).lookAt(new Vector3(0.53, 1.6, 0.6))
  expect(eyes.left.yaw).toBeCloseTo(Math.PI / 4)
  expect(eyes.left.pitch).toBeCloseTo(0)
})
