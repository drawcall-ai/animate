import { Quaternion, Vector3 } from "three"
import { expect, test } from "vitest"
import { isPhrases, type Phrase } from "../src"
import { AH_MA, faced } from "./faced"

const DT = 1 / 60

test("speaks a line: the jaw opens on its vowels and the lips shut on m, mouthClose never past the jaw, until the line is over", () => {
  const { planner, frame, weight } = faced()
  planner.speak(AH_MA)
  const jaw: number[] = []
  let frames = 0
  while (planner.speaking) {
    frame(DT)
    jaw.push(weight("jawOpen"))
    expect(weight("mouthClose")).toBeLessThanOrEqual(weight("jawOpen"))
    frames++
  }
  expect(Math.max(jaw[14], jaw[15])).toBeGreaterThan(0.2)
  // the m spans 0.45…0.55 s, the lips parting for the next vowel only from 0.52 s
  expect(Math.max(...jaw.slice(27, 31))).toBeLessThan(0.02)
  expect(frames * DT).toBeGreaterThan(0.8)
  expect(frames * DT).toBeLessThan(1)
  // a shape of another name is the app's
  expect(weight("freckles")).toBe(0)
})

test("shuts the lips on m whatever the emotion and the line's reactions ask", () => {
  const { planner, frame, weight } = faced()
  planner.speak(AH_MA, { phrases: [{ words: [0, 1], emotion: "surprised", react: [{ word: 1, reaction: "gasp" }] }] })
  let open = 0
  for (let t = DT; t < 0.6; t += DT) {
    frame(DT, { emotion: "scared" })
    if (t > 0.46 && t < 0.52) open = Math.max(open, weight("jawOpen"), weight("mouthFunnel"))
  }
  expect(open).toBeLessThan(0.02)
})

test("speaks a line made without its recording, evenly", () => {
  const { planner, frame, weight } = faced()
  planner.speak({ ...AH_MA, energy: [], pitch: [] })
  let jaw = 0
  while (planner.speaking) {
    frame(DT)
    jaw = Math.max(jaw, weight("jawOpen"))
  }
  expect(jaw).toBeGreaterThan(0.2)
})

test("keeps to the clock it hears, and is over only once that clock reaches the line's end", () => {
  const { planner, frame, weight } = faced()
  let clock = 0
  planner.speak(AH_MA, { heard: () => clock })
  for (let i = 0; i < 90; i++) frame(DT)
  expect(weight("jawOpen")).toBeLessThan(0.03)
  expect(planner.speaking).toBe(true)
  clock = 0.25
  frame(DT)
  expect(weight("jawOpen")).toBeGreaterThan(0.2)
  clock = 2
  frame(DT)
  expect(planner.speaking).toBe(false)
})

test("blends from one emotion into another without a jump, as strongly as its intensity", () => {
  const { frame, weight } = faced()
  const settle = (emotion: "neutral" | "surprised", intensity = 1) => {
    let step = 0
    for (let i = 0; i < 90; i++) {
      const was = weight("browInnerUp")
      frame(DT, { emotion, intensity })
      step = Math.max(step, Math.abs(weight("browInnerUp") - was))
    }
    return step
  }
  settle("neutral")
  expect(weight("browInnerUp")).toBeLessThan(0.05)
  expect(settle("surprised")).toBeLessThan(0.1)
  const full = weight("browInnerUp")
  expect(full).toBeGreaterThan(0.7)
  settle("surprised", 0.5)
  expect(weight("browInnerUp") / full).toBeGreaterThan(0.4)
  expect(weight("browInnerUp") / full).toBeLessThan(0.65)
  // @ts-expect-error: one of EMOTIONS
  expect(() => frame(DT, { emotion: "smug" })).toThrow('no emotion "smug"')
  expect(() => frame(DT, { intensity: 2 })).toThrow("an intensity of 2")
})

test("looks at a point: the eyes on it, the head turned toward it by less, and nodding on a stressed word", () => {
  const { planner, frame, head, looking } = faced(),
    at = new Vector3(0.8, 1.4, 1.2)
  for (let i = 0; i < 120; i++) frame(DT, { lookAt: at })
  const forward = new Vector3(0, 0, 1).applyQuaternion(head.getWorldQuaternion(new Quaternion()))
  for (const name of ["LeftEye", "RightEye"] as const) {
    const { from, way } = looking(name),
      to = at.clone().sub(from)
    expect(way.angleTo(to), name).toBeLessThan(0.15)
    expect(forward.angleTo(to), name).toBeGreaterThan(0.15)
  }
  const still = head.getWorldQuaternion(new Quaternion())
  planner.speak(AH_MA, { phrases: [{ words: [0, 1], emphasis: [1] }] })
  let most = 0
  while (planner.speaking) {
    frame(DT, { lookAt: at })
    most = Math.max(most, still.angleTo(head.getWorldQuaternion(new Quaternion())))
  }
  expect(most).toBeGreaterThan(0.02)
})

test("refuses a line it cannot say, naming what is wrong", () => {
  const { planner } = faced()
  const phrases = (p: Phrase) => () => planner.speak(AH_MA, { phrases: [p] })
  expect(phrases({ words: [0, 2] })).toThrow("a phrase names word 2, the speech has 2")
  expect(phrases({ words: [1, 0] })).toThrow("phrase [1, 0] runs backwards")
  expect(phrases({ words: [0, 0], emphasis: [1] })).toThrow("phrase [0, 0] names word 1 outside it")
  expect(phrases({ words: [0, 1], smile: 2 })).toThrow("phrase [0, 1] has a smile of 2")
  expect(() => planner.speak({ ...AH_MA, phones: [{ p: "XX", stress: 0, time: 0.2, start: 0.1, end: 0.3 }] })).toThrow('unknown phone "XX"')
  expect(() => planner.speak({ ...AH_MA, energy: Array(100).fill(0) })).toThrow("the speech has no sound")
  expect(planner.speaking).toBe(false)
  // phrases written `as const`, or loaded as JSON and checked
  planner.speak(AH_MA, { phrases: [{ words: [0, 1], emphasis: [1], react: [{ word: 0, reaction: "smirk" }] }] as const })
  expect(isPhrases([{ words: [0, 1], emotion: "happy", react: [{ word: 1, reaction: "smirk" }] }])).toBe(true)
  expect(isPhrases([{ words: [0, 1], emotion: "glee" }])).toBe(false)
  expect(isPhrases([{ words: [0, 1], react: [{ word: 1, reaction: "smirk", intensity: -0.5 }] }])).toBe(false)
})
