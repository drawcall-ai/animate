import { expect, test } from "vitest"
import { HandPose, mix } from "../src"

test("mix blends two body poses or two hand poses, and throws for one of each", () => {
  expect(mix({ spine: [0, 1] }, { spine: [1, 3], neck: [2] }, 0.5)).toEqual({ spine: [0.5, 2], neck: [2] })
  expect(mix(HandPose.relaxed, HandPose.fist, 0)).toEqual(HandPose.relaxed)
  // @ts-expect-error: the overloads take two of a kind
  expect(() => mix({ spine: [0] }, HandPose.relaxed, 0.5)).toThrow("not one of each")
})
