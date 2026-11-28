import type { Phone } from "@drawcall/speech"
import { describe, expect, test } from "vitest"
import { Articulation } from "../src/articulation"
import type { Expression } from "../src/blendshapes"

/** the mouth at `t`, and how shut the lips are */
function at(articulation: Articulation, t: number) {
  const shape: Expression = {}
  const shut = articulation.shape(shape, t, 1)
  return { shape, shut }
}

const phones = (...list: [p: string, stress: number, time: number, start: number, end: number][]): Phone[] =>
  list.map(([p, stress, time, start, end]) => ({ p, stress, time, start, end }))

describe("a line's mouth", () => {
  test("holds the lips shut through a long m, and opens a long vowel from the consonant before it without a dip", () => {
    const hum = new Articulation(phones(["AA", 1, 0.27, 0.1, 0.45], ["M", 0, 1.02, 0.45, 1.6]))
    for (let t = 0.46; t < 1.54; t += 0.01) expect(at(hum, t).shut, `${t}`).toBeGreaterThan(0.95)
    const ka = new Articulation(phones(["K", 0, 0.05, 0, 0.1], ["AA", 1, 0.65, 0.1, 1.2]))
    let dip = 0
    for (let t = 0.04, was = at(ka, 0.03).shape.jawOpen ?? 0; t < 0.6; t += 0.01) {
      const jaw = at(ka, t).shape.jawOpen ?? 0
      dip = Math.max(dip, was - jaw)
      was = jaw
    }
    expect(dip).toBeLessThan(1e-3)
  })

  test("never rests while a phone sounds, holds a long vowel open, and keeps mouthLowerDown out", () => {
    const line = phones(["K", 0, 0.05, 0, 0.1], ["AA", 1, 0.65, 0.1, 1.2], ["T", 0, 1.25, 1.2, 1.3], ["M", 0, 1.8, 1.4, 2.2], ["AW", 1, 2.6, 2.2, 3])
    const articulation = new Articulation(line)
    for (const ph of line)
      for (let t = ph.start + 0.03; t < ph.end - 0.03; t += 0.01) {
        const { shape, shut } = at(articulation, t)
        expect(
          Object.values(shape).reduce((sum, v) => sum + v, shut),
          `${ph.p} at ${t.toFixed(2)}`,
        ).toBeGreaterThan(0.01)
        expect(shape.mouthLowerDownLeft ?? 0).toBe(0)
      }
    for (let t = 0.25; t < 1.15; t += 0.01) expect(at(articulation, t).shape.jawOpen, `${t}`).toBeGreaterThan(0.8 * 0.42)
  })

  test("rounds the lips on a consonant ahead of a rounded vowel, and spreads them ahead of a spread one", () => {
    const pucker = (vowel: string) => at(new Articulation(phones(["S", 0, 0.15, 0.1, 0.2], [vowel, 1, 0.3, 0.2, 0.4])), 0.13).shape
    expect(pucker("UW").mouthPucker ?? 0).toBeGreaterThan(0.3)
    expect(pucker("UW").mouthStretchLeft ?? 0).toBeLessThan(0.1)
    expect(pucker("IY").mouthPucker ?? 0).toBe(0)
  })

  test("rests in a pause, not in a gap too short to hear", () => {
    const articulation = new Articulation(phones(["AA", 1, 0.2, 0.1, 0.3], ["AA", 1, 0.48, 0.38, 0.58], ["AA", 1, 0.98, 0.88, 1.08]))
    const jaw = (from: number, to: number) => {
      let least = Infinity
      for (let t = from; t <= to; t += 0.005) least = Math.min(least, at(articulation, t).shape.jawOpen ?? 0)
      return least
    }
    expect(jaw(0.3, 0.38)).toBeGreaterThan(0.15)
    expect(jaw(0.58, 0.88)).toBeLessThan(0.01)
  })
})
