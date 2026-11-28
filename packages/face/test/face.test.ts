import { Group, Quaternion, Vector3 } from "three"
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
  expect(() => face.set({ cheekBulgeLeft: 1 })).toThrow('"cheekBulgeLeft" is no ARKit blendshape')
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
