// What a humanoid is as it is built: where it stands, how many angles each bone takes, and whether it has hands.
import { Bone, Group, Vector3 } from "three"
import { expect, test } from "vitest"
import { Humanoid } from "../src"

/** A bare rig as a humanoid takes one, standing on y = 0 facing +z in a T-pose; `fingers` adds finger bones without the bones at their tips. */
function rig(fingers: boolean) {
  const joints: [string, string | undefined, number, number, number][] = [
    ["hips", undefined, 0, 0.95, 0],
    ["spine", "hips", 0, 1.07, 0],
    ["chest", "spine", 0, 1.25, 0],
    ["neck", "chest", 0, 1.47, 0],
    ["head", "neck", 0, 1.53, 0],
  ]
  for (const [side, s] of [
    ["left", 1],
    ["right", -1],
  ] as const) {
    joints.push(
      [`${side}Shoulder`, "chest", 0.03 * s, 1.42, 0],
      [`${side}UpperArm`, `${side}Shoulder`, 0.2 * s, 1.42, 0],
      [`${side}LowerArm`, `${side}UpperArm`, 0.49 * s, 1.42, 0],
      [`${side}Hand`, `${side}LowerArm`, 0.81 * s, 1.42, 0],
      [`${side}UpperLeg`, "hips", 0.09 * s, 0.95, 0],
      [`${side}LowerLeg`, `${side}UpperLeg`, 0.09 * s, 0.51, 0],
      [`${side}Foot`, `${side}LowerLeg`, 0.09 * s, 0.07, 0],
    )
    if (fingers)
      for (const [k, finger] of ["Thumb", "Index", "Middle", "Ring", "Little"].entries()) {
        const parts = finger === "Thumb" ? ["Metacarpal", "Proximal", "Distal"] : ["Proximal", "Intermediate", "Distal"]
        parts.forEach((part, i) =>
          joints.push([`${side}${finger}${part}`, i ? `${side}${finger}${parts[i - 1]}` : `${side}Hand`, (0.9 + 0.03 * i) * s, 1.42, 0.03 - 0.015 * k]),
        )
      }
  }
  const root = new Group()
  for (const [name, parent, x, y, z] of joints) {
    const bone = Object.assign(new Bone(), { name })
    bone.position.set(x, y, z)
    ;(parent ? root.getObjectByName(parent) : root)?.attach(bone)
  }
  return root
}

test("it stands where it is built, facing the way it is told", () => {
  const body = new Humanoid({ position: new Vector3(2, 0, -3), yaw: Math.PI / 2 })
  const pelvis = body.positionOf(body.root)
  expect([pelvis.x, pelvis.z]).toEqual([2, -3])
  expect(new Vector3(0, 0, 1).applyQuaternion(body.quaternionOf(body.root)).x).toBeCloseTo(1)
})

test("a pose with more angles than a bone has hinges throws, naming the bone", () => {
  expect(() => new Humanoid().anglesOf({ shinL: [0.5, 0.1] })).toThrow("'shinL' has 1 hinge, not the 2 angles given")
})

test("hands: none on the procedural humanoid, none on a rig without finger bones, and read only when asked for", () => {
  expect(() => new Humanoid().hands).toThrow("the procedural humanoid has no hands")
  expect(() => new Humanoid({ rig: rig(false) }).hands).toThrow("its rig has no finger bones")
  const tipless = new Humanoid({ rig: rig(true) }) // built fine: the hands are never asked for
  expect(() => tipless.hands).toThrow("not the one at the fingertip")
})
