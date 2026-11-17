// A body of its own: a two-bone arm on a sliding base, the smallest body the solver poses.
import { Object3D, Vector3 } from "three"
import { expect, test } from "vitest"
import { Body, hard, Joint, mark, solve, Target } from "../src"

const X = new Vector3(1, 0, 0),
  Z = new Vector3(0, 0, 1)

/** a base turning about z, an upper arm and a forearm each bending about x, and a hand mark at the end */
function arm() {
  const base = Object.assign(new Joint([{ axis: Z, min: -3, max: 3 }], [], 1), { name: "base" })
  const upper = Object.assign(new Joint([{ axis: X, min: -2, max: 2 }], [], 1), { name: "upper" })
  const fore = Object.assign(new Joint([{ axis: X, min: 0, max: 2.5 }], [0.3], 1), { name: "fore" })
  upper.position.set(0, 0.5, 0)
  fore.position.set(0, 0.4, 0)
  base.add(upper)
  upper.add(fore)
  mark(fore, "hand", new Vector3(0, 0.4, 0))
  const scene = new Object3D()
  scene.add(base)
  return { body: new Body(base), scene }
}

test("a pose lists at most as many angles for a bone as it has hinges", () => {
  const { body } = arm()
  expect(body.anglesOf({ fore: [1] })).toEqual([0, 0, 0, 0, 0, 1])
  expect(() => body.anglesOf({ fore: [1, 2] })).toThrow("'fore' has 1 hinge, not the 2 angles given")
})

test("an object hung on the body by a mark of its own goes into the hand that takes it; a second hold closes a loop", () => {
  const { body, scene } = arm()
  const box = new Object3D()
  mark(body.get("upper"), "sling").add(box)
  body.attach(box, body.get("hand"))
  expect(box.parent).toBe(body.get("hand"))
  const result = solve(body, [hard(body.get("hand"), new Target().set({ position: new Vector3(0.2, 0.9, 0.3) }))])
  expect(result.loopsMissedBy).toBe(0)
  body.attach(box, body.get("fore"), mark(box, "seat", new Vector3(0, -0.4, 0)))
  expect(solve(body, []).loopsMissedBy).toBeLessThan(1e-9)
  body.detach(box)
  expect(box.parent).toBe(scene)
})

test("two hard goals on one point throw, naming even an unnamed point by where it is", () => {
  const { body } = arm()
  const point = mark(body.get("fore"), "")
  const goals = [hard(point, new Target().set({ position: new Vector3(0, 1, 0) })), hard(point, new Target().set({ position: new Vector3(0, 1.1, 0) }))]
  expect(() => solve(body, goals)).toThrow(/two hard goals on the same point, an unnamed Object3D on 'fore' at \(/)
})
