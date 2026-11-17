// The stage needs a browser, but putting flesh on bones does not: it must not throw on a skeleton.
import { Bone, Mesh } from "three"
import { expect, test } from "vitest"
import { flesh } from "../src"

test("flesh hangs meshes on every bone of a skeleton", () => {
  const bone = (name: string, y: number, parent?: Bone) => {
    const b = Object.assign(new Bone(), { name })
    b.position.set(0, y, 0)
    parent?.add(b)
    return b
  }
  const pelvis = bone("pelvis", 1),
    chest = bone("chest", 0.3, pelvis),
    head = bone("head", 0.3, chest)
  bone("handR", -0.3, bone("forearmR", -0.3, chest))
  bone("footR", -0.4, bone("shinR", -0.4, pelvis))
  flesh(pelvis)
  let meshes = 0
  pelvis.traverse((o) => {
    if (o instanceof Mesh) meshes++
  })
  expect(meshes).toBeGreaterThanOrEqual(8)
  expect(head.children.length).toBe(2)
})
