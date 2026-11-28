// The mouth from a line's phones: each phone has a target shape, and the mouth moves from one to the next. The jaw carries the
// opening; the lips only spread, round or protrude on top of it. `mouthLowerDown` takes no part: on a face whose jaw carries
// the lower lip it peels the lip off the teeth.

import { isArpabet, type Phone, VOWEL } from "@drawcall/speech"
import { add, type BlendShape, type Expression, weightsOf } from "./blendshapes"

/** a target of the mouth: its shape, and how shut the lips are (0…1), which the face holds against whatever else would part them */
type Target = { shape: Expression; shut: number }

const target = (shape: Expression, shut = 0): Target => ({ shape, shut })
/** the jaw opens the mouth, the lower lip riding up with the lower teeth */
const jaw = (open: number, extra: Expression = {}): Target => target({ jawOpen: open, mouthClose: 0.2 * open, mouthShrugLower: 0.5 * open, ...extra })
const spread = (open: number, k: number): Target => jaw(open, { mouthStretchLeft: k, mouthStretchRight: k, mouthSmileLeft: 0.4 * k, mouthSmileRight: 0.4 * k })
/** rounding pushes the lips forward; funnel and pucker also drop the lower lip, which `mouthClose` lifts back over the teeth */
const round = (open: number, funnel: number, pucker: number): Target =>
  jaw(open, { mouthFunnel: funnel, mouthPucker: pucker, mouthClose: 0.2 * open + 0.1 * (funnel + pucker) })
/** the lips shut, held through the phone's span: pressed and rolled a little in, which keeps them together under a frown */
const CLOSED = target({ mouthPressLeft: 0.3, mouthPressRight: 0.3, mouthRollLower: 0.3, mouthRollUpper: 0.2 }, 1)
/** the lower lip up under the upper teeth */
const LABIODENTAL = target({ jawOpen: 0.06, mouthShrugLower: 0.4, mouthClose: 0.3, mouthRollLower: 0.5, mouthUpperUpLeft: 0.45, mouthUpperUpRight: 0.45 })

/** targets per ARPAbet phone: the jaw opens most for a and o, little for ee and oo; the lips spread for ee and i, round for o, oo,
 * w and r, flare for sh. A diphthong glides through two. */
const TARGETS: Record<string, readonly Target[]> = {
  IY: [spread(0.06, 0.75)],
  IH: [spread(0.13, 0.45)],
  EY: [spread(0.17, 0.35), spread(0.07, 0.6)],
  EH: [spread(0.22, 0.35)],
  AE: [spread(0.34, 0.25)],
  AA: [round(0.42, 0.25, 0.1)],
  AH: [round(0.28, 0.1, 0.05)],
  AO: [round(0.34, 0.5, 0.25)],
  AY: [round(0.38, 0.15, 0.05), spread(0.08, 0.6)],
  AW: [round(0.38, 0.15, 0.05), round(0.08, 0.5, 0.8)],
  OY: [round(0.28, 0.5, 0.3), spread(0.08, 0.55)],
  OW: [round(0.24, 0.7, 0.4), round(0.1, 0.5, 0.8)],
  UW: [round(0.08, 0.5, 0.8)],
  UH: [round(0.13, 0.45, 0.5)],
  ER: [round(0.14, 0.5, 0.4)],
  W: [round(0.07, 0.5, 0.8)],
  R: [round(0.08, 0.4, 0.5)],
  SH: [round(0.1, 0.8, 0.3)],
  ZH: [round(0.1, 0.8, 0.3)],
  CH: [round(0.1, 0.7, 0.3)],
  JH: [round(0.1, 0.7, 0.3)],
  P: [CLOSED],
  B: [CLOSED],
  M: [CLOSED],
  F: [LABIODENTAL],
  V: [LABIODENTAL],
  S: [spread(0.04, 0.3)],
  Z: [spread(0.04, 0.3)],
  T: [jaw(0.05)],
  D: [jaw(0.05)],
  N: [jaw(0.05)],
  L: [jaw(0.1)],
  TH: [jaw(0.08, { tongueOut: 1 })],
  DH: [jaw(0.07, { tongueOut: 0.85 })],
  K: [jaw(0.06)],
  G: [jaw(0.06)],
  NG: [jaw(0.05)],
  HH: [jaw(0.12)],
  Y: [spread(0.06, 0.5)],
}

/** where each gesture peaks against its phone's acoustic centre (s): stops and taps make contact before their release */
const OFFSET: Record<string, number> = {
  T: -0.06,
  D: -0.06,
  N: -0.03,
  L: -0.03,
  TH: -0.04,
  DH: -0.04,
  S: -0.02,
  Z: -0.02,
  SH: -0.03,
  CH: -0.06,
  JH: -0.06,
  W: -0.04,
  R: -0.02,
}
/** how far mouth shapes lead the sound (s) */
const LEAD = 0.02
/** how long after a phone, followed by a pause or by nothing, the mouth is back at rest (s) */
const REST = 0.1
/** the shortest gap between two phones' spans that the mouth rests in (s): a perceptible pause, not a stop's closure */
const PAUSE = 0.12
/** the least time between one phone's first key and the next's (s): whatever their anticipation, phones keep their order */
const APART = 0.02
/** a vowel with more room than this (s) holds its target, from `HOLD_IN` into its room until `HOLD_OUT` before its end */
const LONG = 0.2,
  HOLD_IN = 0.08,
  HOLD_OUT = 0.03

/** when a phone's gesture would peak by itself (s): the lips shut as its span begins, other gestures about its acoustic centre */
const anticipated = (ph: Phone) => (TARGETS[ph.p][0] === CLOSED ? ph.start : ph.time + (OFFSET[ph.p] ?? (VOWEL.test(ph.p) ? 0.01 : -0.02)))

const scaled = ({ shape, shut }: Target, k: number): Target => target(Object.fromEntries(weightsOf(shape).map(([n, v]) => [n, v * k])), shut)

/** A line's mouth over time (s into its recording). */
export class Articulation {
  /** when the mouth has come to rest after the last phone (s; −Infinity: there is none) */
  readonly rests: number
  /** the mouth's targets over time, in order */
  readonly #keys: { t: number; target: Target }[] = []

  /** Throws on a phone that is no ARPAbet, one with a stress outside 0…1, a span not finite or a `time` outside it, and phones out of time order. */
  constructor(phones: readonly Phone[]) {
    for (const [i, ph] of phones.entries()) {
      if (!isArpabet(ph.p)) throw new Error(`speak: unknown phone "${ph.p}"; ARPAbet expected, such as AA or B`)
      if (!(ph.stress >= 0 && ph.stress <= 1)) throw new Error(`speak: phone ${i} (${ph.p}) has a stress of ${ph.stress}, not within 0…1`)
      if (!Number.isFinite(ph.start) || !Number.isFinite(ph.end)) throw new Error(`speak: phone ${i} (${ph.p}) spans ${ph.start}…${ph.end} s`)
      if (!(ph.start <= ph.time && ph.time <= ph.end))
        throw new Error(`speak: phone ${i} (${ph.p}) at ${ph.time} s is outside its span ${ph.start}…${ph.end} s`)
      if (i > 0 && ph.time < phones[i - 1].time)
        throw new Error(`speak: phone ${i} (${ph.p}) at ${ph.time} s comes before the one before it, at ${phones[i - 1].time} s`)
    }
    const keys = this.#keys
    // each phone's room: its span, but for what its neighbours' centres take of it where spans overlap
    const room = phones.map((ph, i) => ({ from: Math.max(ph.start, phones[i - 1]?.time ?? -Infinity), to: Math.min(ph.end, phones[i + 1]?.time ?? Infinity) }))
    const long = phones.map((ph, i) => VOWEL.test(ph.p) && room[i].to - room[i].from > LONG)
    // each phone's first key within its span and after the one before's: its anticipation kept where there is room for it
    const first: number[] = []
    for (const [i, ph] of phones.entries()) {
      const own = long[i] ? room[i].from + HOLD_IN : Math.min(ph.end, Math.max(ph.start, anticipated(ph)))
      first.push(i === 0 ? own : Math.max(first[i - 1] + APART, own))
    }
    const rest = target({})
    // the mouth rests before the first phone and in pauses
    if (phones.length) keys.push({ t: phones[0].start - 0.1, target: rest })
    for (const [i, ph] of phones.entries()) {
      const targets = TARGETS[ph.p],
        k = VOWEL.test(ph.p) ? 0.55 + 0.45 * ph.stress : 1,
        t0 = first[i],
        next = phones[i + 1]
      const closed = targets[0] === CLOSED,
        start = closed ? CLOSED : scaled(targets[0], k)
      keys.push({ t: t0, target: start })
      // a later key, held or gliding to: before the next phone's first, else none
      const later = (t: number, to: Target) => {
        const at = Math.min(t, (first[i + 1] ?? Infinity) - APART)
        if (at > t0 + 0.01) keys.push({ t: at, target: to })
      }
      const end = targets[1] ? scaled(targets[1], k) : start
      // the lips held shut through the span, a long vowel held through its room, gliding to a diphthong's second target; a short
      // diphthong glides from its first target at the centre to its second near the end of its span
      if (closed) later(Math.max(ph.start + 0.02, ph.end - 0.01), CLOSED)
      else if (long[i]) later(room[i].to - HOLD_OUT, end)
      else if (targets[1]) later(t0 + 0.75 * (ph.end - t0), end)
      // at rest in a gap between spans, back before the next phone's gesture begins
      if (!next) keys.push({ t: Math.max(ph.end, t0) + REST, target: rest })
      else if (next.start - ph.end > PAUSE) {
        const at = Math.min(ph.end + REST, first[i + 1] - REST / 2)
        if (at > t0 + APART && at < first[i + 1] - APART) keys.push({ t: at, target: rest })
      }
    }
    this.rests = (keys[keys.length - 1]?.t ?? -Infinity) - LEAD
  }

  /** Adds the mouth at `t` into `expression`, the jaw's opening scaled by `gain`, and returns how shut the lips are then (0…1), so that what is layered on top does not part them. */
  shape(expression: Expression, t: number, gain: number): number {
    const { shape, shut } = this.#at(t + LEAD)
    for (const [n, v] of weightsOf(shape)) add(expression, n, n === "jawOpen" ? v * gain : v)
    return Math.min(1, Math.max(0, shut))
  }

  /** the keys joined by a monotone cubic per channel: the mouth keeps moving through each phone and comes to rest only at a
   * channel's peaks and holds, never overshooting a target */
  #at(t: number): Target {
    const keys = this.#keys
    const i = keys.findIndex((k) => k.t > t)
    if (i <= 0) return target({})
    const [a, b] = [keys[i - 1], keys[i]]
    const h = Math.max(0.01, b.t - a.t),
      u = Math.min(1, (t - a.t) / h)
    const curve = (get: (target: Target) => number) => {
      const slope = (j: number) => (get(keys[j].target) - get(keys[j - 1].target)) / Math.max(0.01, keys[j].t - keys[j - 1].t)
      // the tangent at key j: the harmonic mean of the slopes beside it, flat at extrema and at the ends
      const tangent = (j: number) => {
        if (j <= 0 || j >= keys.length - 1) return 0
        const d0 = slope(j),
          d1 = slope(j + 1)
        return d0 * d1 <= 0 ? 0 : (2 * d0 * d1) / (d0 + d1)
      }
      const [y0, y1] = [get(a.target), get(b.target)]
      return (
        (2 * u ** 3 - 3 * u ** 2 + 1) * y0 +
        (u ** 3 - 2 * u ** 2 + u) * h * tangent(i - 1) +
        (-2 * u ** 3 + 3 * u ** 2) * y1 +
        (u ** 3 - u ** 2) * h * tangent(i)
      )
    }
    const shape: Expression = {}
    const names = new Set<BlendShape>([...weightsOf(a.target.shape), ...weightsOf(b.target.shape)].map(([n]) => n))
    for (const n of names) shape[n] = curve((target) => target.shape[n] ?? 0)
    return target(
      shape,
      curve((target) => target.shut),
    )
  }
}
