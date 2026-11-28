import { expect, test } from "vitest"
import { spanned, viterbi } from "../src/align/ctc"

/** log probabilities of frames each of which hears one token (`.`: the blank, 0) clearly, of tokens `.ab` */
function heard(frames: string): Float32Array {
  const tokens = ".ab",
    lp = new Float32Array(frames.length * tokens.length)
  for (const [t, c] of [...frames].entries()) for (let v = 0; v < tokens.length; v++) lp[t * tokens.length + v] = Math.log(tokens[v] === c ? 0.9 : 0.05)
  return lp
}

test("times the same token twice across a word boundary only with a blank between, and a token heard for one frame", () => {
  // "a" ending one word and starting the next: two spans, the blank frame between them
  expect(viterbi(heard("aa.aa"), 5, 3, [1, 1], 0)).toEqual([
    [0, 1],
    [3, 4],
  ])
  // heard as one run, the path must still pass a blank: the spans do not meet
  const [first, second] = viterbi(heard("aaaa"), 4, 3, [1, 1], 0)
  expect(second[0]).toBeGreaterThan(first[1] + 1)
  // a b heard for a single frame between two a's, which need no blank about a different token
  expect(viterbi(heard(".aab.a"), 6, 3, [1, 2, 1], 0)).toEqual([
    [1, 2],
    [3, 3],
    [5, 5],
  ])
  expect(() => viterbi(heard("a"), 1, 3, [1, 2], 0)).toThrow("too short")
  expect(() => viterbi(heard("aa"), 2, 3, [], 0)).toThrow("Nothing to align")
})

test("spans each phone halfway to its neighbours, at most 0.15 s from its spike", () => {
  const [a, b, c] = spanned([
    { p: "AA", stress: 1, time: 0.2 },
    { p: "T", stress: 0, time: 0.26 },
    { p: "AA", stress: 1, time: 0.9 },
  ])
  // the first and last to a fixed 0.08 s before and 0.1 s after where nothing neighbours them
  for (const [got, want] of [
    [a.start, 0.12],
    [a.end, 0.23],
    [b.start, 0.23],
    [b.end, 0.41],
    [c.start, 0.75],
    [c.end, 1],
  ])
    expect(got).toBeCloseTo(want)
})
