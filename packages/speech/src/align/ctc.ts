import type { Phone } from "../speech"

// The model-free half of CTC forced alignment: the most likely path through a recording's per-frame phone probabilities, and the
// spans of the phones it times.

/** `data`'s rows of `tokens` logits, one a frame, as log probabilities */
export function logSoftmax(data: Float32Array, frames: number, tokens: number): Float32Array {
  const out = new Float32Array(frames * tokens)
  for (let t = 0; t < frames; t++) {
    const row = data.subarray(t * tokens, (t + 1) * tokens)
    let max = -Infinity,
      sum = 0
    for (const v of row) max = Math.max(max, v)
    for (const v of row) sum += Math.exp(v - max)
    const norm = max + Math.log(sum)
    for (let v = 0; v < tokens; v++) out[t * tokens + v] = row[v] - norm
  }
  return out
}

/** The first and last frame of each target token on the most likely CTC path: the states alternate blank and target tokens, and a
 * path stays, steps to the next state, or skips a blank between two different tokens. `lp`: log probabilities, `tokens` a frame */
export function viterbi(lp: Float32Array, frames: number, tokens: number, target: number[], blank: number): [number, number][] {
  if (target.length === 0) throw new Error("Nothing to align: no tokens")
  const states = 2 * target.length + 1
  const tokenOf = (s: number) => (s % 2 ? target[(s - 1) / 2] : blank)
  const score = new Float32Array(frames * states).fill(-Infinity),
    back = new Int8Array(frames * states)
  score[0] = lp[blank]
  score[1] = lp[target[0]]
  for (let t = 1; t < frames; t++)
    for (let s = 0; s < states; s++) {
      const at = (d: number) => score[(t - 1) * states + s - d]
      let best = at(0),
        from = 0
      if (s > 0 && at(1) > best) [best, from] = [at(1), 1]
      if (s > 1 && s % 2 && tokenOf(s) !== tokenOf(s - 2) && at(2) > best) [best, from] = [at(2), 2]
      score[t * states + s] = best + lp[t * tokens + tokenOf(s)]
      back[t * states + s] = from
    }
  const end = (frames - 1) * states
  if (Math.max(score[end + states - 1], score[end + states - 2]) === -Infinity) throw new Error("The recording is too short for its text")
  let s = score[end + states - 1] > score[end + states - 2] ? states - 1 : states - 2
  const spans: [number, number][] = target.map(() => [-1, -1])
  for (let t = frames - 1; t >= 0; t--) {
    if (s % 2) {
      const span = spans[(s - 1) / 2]
      if (span[1] < 0) span[1] = t
      span[0] = t
    }
    s -= back[t * states + s]
  }
  return spans
}

/** Phones timed at their spikes (`time`, s) given spans: each halfway to its neighbours' spikes, at most 0.15 s from its own */
export function spanned(timed: readonly Omit<Phone, "start" | "end">[]): Phone[] {
  return timed.map((ph, k) => {
    const prev = timed[k - 1],
      next = timed[k + 1]
    return {
      ...ph,
      start: Math.max(ph.time - 0.15, prev ? (prev.time + ph.time) / 2 : ph.time - 0.08),
      end: Math.min(ph.time + 0.15, next ? (ph.time + next.time) / 2 : ph.time + 0.1),
    }
  })
}
