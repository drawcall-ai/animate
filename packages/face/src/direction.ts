// What a line asks of the face at each moment, from its prosody (loudness, pitch, pauses) and its phrases: the emotion, accents
// on stressed words, glances, phrase ends and reactions. Pure functions of time (s into the recording); the planner adds inertia.

import type { Speech, Word } from "@drawcall/speech"
import { MathUtils } from "three"
import { add, type Expression, weightsOf } from "./blendshapes"
import { blend, type Emotion, type HeadTurn, isEmotion, isReaction, MANNER, type Manner, REACTION, type Reaction } from "./emotion"

/** Direction for a phrase of a line, as an actor would get it. Word indices are into `Speech.words`, all of them within the phrase's. */
export interface Phrase {
  /** its first and last word */
  readonly words: readonly [number, number]
  /** held through the phrase (default the emotion the face is updated with) */
  readonly emotion?: Emotion
  /** how strongly (0…1, default 1) */
  readonly intensity?: number
  /** the head turned (rad, a few hundredths): `yaw` + to its left, `pitch` + chin down, `roll` + tipped toward its right shoulder */
  readonly head?: Readonly<Partial<HeadTurn>>
  /** a smile, a brow raise (− lowers) and a squint over the emotion (0…1) */
  readonly smile?: number
  readonly brows?: number
  readonly squint?: number
  /** it ends in a question: the head rises instead of settling */
  readonly question?: boolean
  /** its stressed words: nods, brow accents and the emotion's muscles fire on them */
  readonly emphasis?: readonly number[]
  /** words on which the eyes glance aside */
  readonly glance?: readonly number[]
  /** quick expressions on single words: a reaction, or an emotion's held expression, at `intensity` (0…1, default 1) */
  readonly react?: readonly { readonly word: number; readonly reaction: Reaction | Emotion; readonly intensity?: number }[]
}

/** a pulse at `t` rising smoothly to 1 at `peak` over `rise` and falling over `fall` (s) */
export const pulse = (t: number, peak: number, rise: number, fall: number) =>
  t < peak ? MathUtils.smoothstep(t, peak - rise, peak) : 1 - MathUtils.smoothstep(t, peak, peak + fall)
/** in at `a` over `rise` and out at `b` over `fall` (s): 0…1 */
const span = (t: number, a: number, rise: number, b: number, fall: number) =>
  Math.min(MathUtils.smoothstep(t, a, a + rise), 1 - MathUtils.smoothstep(t, b, b + fall))

/** `values` averaged over `r` neighbours each way */
const smooth = (values: readonly number[], r: number) =>
  values.map((_, i) => {
    const near = values.slice(Math.max(0, i - r), i + r + 1)
    return near.reduce((a, b) => a + b, 0) / near.length
  })

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
const unit = (v: unknown): v is number => typeof v === "number" && v >= 0 && v <= 1
const isObject = (v: unknown): v is object => typeof v === "object" && v !== null

/** Whether `value` (parsed JSON) is a list of `Phrase`. */
export function isPhrases(value: unknown): value is Phrase[] {
  return Array.isArray(value) && value.every((p) => misdirection(p) === undefined)
}

/** what is wrong with `p` as a phrase of a line of `count` words, if anything */
function misdirection(p: unknown, count = Infinity): string | undefined {
  if (!isObject(p)) return `a phrase is ${JSON.stringify(p)}, not an object`
  const get = (key: keyof Phrase): unknown => Reflect.get(p, key)
  const words = get("words")
  if (!(Array.isArray(words) && words.length === 2 && words.every(Number.isInteger)))
    return `a phrase has words ${JSON.stringify(words)}; give its first and last word's indices`
  const [a, b] = words
  const name = `phrase [${a}, ${b}]`
  for (const w of words) if (w < 0 || w >= count) return `a phrase names word ${w}, the speech has ${count}`
  if (a > b) return `${name} runs backwards; give the first word, then the last`
  const emotion = get("emotion")
  if (emotion !== undefined && !(typeof emotion === "string" && isEmotion(emotion))) return `${name} has no emotion "${emotion}"`
  const question = get("question")
  if (question !== undefined && typeof question !== "boolean") return `${name} has a question of ${question}, not true or false`
  for (const key of ["smile", "squint", "intensity"] as const) {
    const v = get(key)
    if (v !== undefined && !unit(v)) return `${name} has a ${key} of ${v}, not within 0…1`
  }
  const brows = get("brows")
  if (brows !== undefined && !finite(brows)) return `${name} has a brows of ${brows}`
  const head = get("head")
  if (head !== undefined && !isObject(head)) return `${name} has a head of ${head}, not { yaw, pitch, roll }`
  for (const key of ["yaw", "pitch", "roll"]) {
    const v: unknown = head && Reflect.get(head, key)
    if (v !== undefined && !finite(v)) return `${name} has a head ${key} of ${v}`
  }
  const lists: Partial<Record<"emphasis" | "glance" | "react", unknown[]>> = {}
  for (const key of ["emphasis", "glance", "react"] as const) {
    const v = get(key)
    if (v !== undefined && !Array.isArray(v)) return `${name} has a ${key} of ${JSON.stringify(v)}, not a list`
    lists[key] = v
  }
  const { emphasis = [], glance = [], react = [] } = lists
  for (const r of react) {
    if (!isObject(r)) return `${name} reacts with ${JSON.stringify(r)}, not { word, reaction, intensity }`
    const reaction: unknown = Reflect.get(r, "reaction"),
      intensity: unknown = Reflect.get(r, "intensity")
    if (!(typeof reaction === "string" && (isReaction(reaction) || isEmotion(reaction)))) return `${name} reacts with "${reaction}", no reaction or emotion`
    if (intensity !== undefined && !unit(intensity)) return `${name} has a reaction's intensity of ${intensity}, not within 0…1`
  }
  for (const w of [...emphasis, ...glance, ...react.map((r) => isObject(r) && Reflect.get(r, "word"))])
    if (!Number.isInteger(w) || w < a || w > b) return `${name} names word ${w} outside it; indices are into speech.words`
}

/** what the phrases ask over the emotion: the head turned, and a smile, brows and squint */
export interface Delivery {
  head: HeadTurn
  smile: number
  brows: number
  squint: number
}

/** A line's direction, from its speech and phrases. */
export class Direction {
  /** stressed moments: the phrases' emphasis strongly, other loud words lightly */
  readonly accents: { t: number; strength: number }[]
  readonly pauses: number[]
  readonly glances: number[]
  readonly phraseEnds: { t: number; question: boolean }[]
  readonly #speech: Speech
  readonly #phrases: readonly Phrase[]
  /** loudness smoothed, 0…1 of its peak */
  readonly #loud: number[]
  /** pitch smoothed, in semitones from the voice's median, 0 where unvoiced */
  readonly #semis: number[]
  /** each change of emotion overshoots and settles */
  readonly #onsets: { t: number; k: number }[]
  readonly #reactions: { t: number; expression: Expression; k: number }[]

  /** Throws on words not timed in order within themselves, phrases that name words the speech has not, run backwards or name words
   * outside them, an unknown emotion or reaction, a value out of its range, and a silent recording (but none at all). */
  constructor(speech: Speech, phrases: readonly Phrase[]) {
    const { words } = speech
    for (const [i, w] of words.entries())
      if (!(Number.isFinite(w.start) && Number.isFinite(w.end) && w.start <= w.end))
        throw new Error(`speak: word ${i} ("${w.text}") spans ${w.start}…${w.end} s`)
    for (const p of phrases) check(p, words)
    this.#speech = speech
    this.#phrases = phrases
    const loud = smooth(speech.energy, 3),
      peak = loud.reduce((m, x) => Math.max(m, x), -Infinity)
    if (loud.length && !(peak > 0)) throw new Error("speak: the speech has no sound")
    this.#loud = loud.map((x) => x / peak)
    const voiced = speech.pitch.filter((p) => p > 0).sort((a, b) => a - b)
    const median = voiced[voiced.length >> 1] ?? 120
    this.#semis = smooth(
      speech.pitch.map((p, i) => {
        // a median window against octave jumps
        const window = speech.pitch
          .slice(Math.max(0, i - 4), i + 5)
          .filter((x) => x > 0)
          .sort((a, b) => a - b)
        return p > 0 && window.length ? Math.max(-6, Math.min(8, 12 * Math.log2(window[window.length >> 1] / median))) : 0
      }),
      4,
    )

    const emphasized = new Set(phrases.flatMap((p) => p.emphasis ?? []))
    const glanced = new Set(phrases.flatMap((p) => p.glance ?? []))
    // a word's stressed moment: its loudest frame
    const peakOf = (w: Word) => {
      let best = w.start,
        most = -1
      for (let t = w.start; t < w.end; t += 0.01) if (this.loudness(t) > most) [most, best] = [this.loudness(t), t]
      return best
    }
    this.accents = words
      .map((w, i) => ({ t: peakOf(w), strength: emphasized.has(i) ? 1 : this.loudness(peakOf(w)) > 0.6 ? 0.35 : 0 }))
      .filter((a) => a.strength > 0)
    this.pauses = words.slice(1).flatMap((w, i) => (w.start - words[i].end > 0.22 ? [words[i].end] : []))
    this.glances = words.flatMap((w, i) => (glanced.has(i) ? [w.start] : []))
    this.phraseEnds = phrases.map((p) => ({ t: words[p.words[1]].end, question: !!p.question }))
    this.#onsets = phrases.flatMap((p, i) => {
      if (!p.emotion) return []
      const previous = phrases
        .slice(0, i)
        .reverse()
        .find((x) => x.emotion)?.emotion
      const k = (p.intensity ?? 1) * (p.emotion === previous ? 0.35 : previous ? 1 : 0.8)
      return [{ t: words[p.words[0]].start - 0.05, k }]
    })
    this.#reactions = phrases.flatMap((p) =>
      (p.react ?? []).map((r) => ({
        t: words[r.word].start - 0.06,
        expression: isReaction(r.reaction) ? REACTION[r.reaction] : MANNER[r.reaction].expression,
        k: r.intensity ?? 1,
      })),
    )
  }

  /** loudness at `t`, 0…1 of the line's peak; even, for a line without its recording */
  loudness(t: number): number {
    return this.#loud.length ? at(this.#loud, t) : EVEN
  }

  /** pitch at `t`, in semitones from the voice's median, 0 where unvoiced */
  pitch(t: number): number {
    return at(this.#semis, t)
  }

  /** the manner at `t` over `base` (the face's own): each phrase's emotion eased in and out over its words, the first held before the line, the last after */
  manner(t: number, base: Manner): Manner {
    const words = this.#speech.words,
      phrases = this.#phrases
    const first = phrases.findIndex((p) => p.emotion)
    const last = phrases.findLastIndex((p) => p.emotion)
    const parts: [Manner, number][] = []
    phrases.forEach((p, i) => {
      if (!p.emotion) return
      const a = words[p.words[0]].start - 0.3,
        b = words[p.words[1]].end + 0.4
      const k = (i === first && t < a) || (i === last && t > b) ? 1 : span(t, a, 0.35, b, 0.5)
      if (k > 0) parts.push([MANNER[p.emotion], k * (p.intensity ?? 1)])
    })
    return blend(parts, base)
  }

  /** the phrases' head and expression at `t`, eased in and out at their words */
  delivery(t: number): Delivery {
    const out: Delivery = { head: { yaw: 0, pitch: 0, roll: 0 }, smile: 0, brows: 0, squint: 0 }
    for (const p of this.#phrases) {
      const a = this.#speech.words[p.words[0]].start - 0.25,
        b = this.#speech.words[p.words[1]].end + 0.35
      const k = span(t, a, 0.3, b, 0.4)
      if (k <= 0) continue
      for (const key of ["yaw", "pitch", "roll"] as const) out.head[key] += (p.head?.[key] ?? 0) * k
      for (const key of ["smile", "brows", "squint"] as const) out[key] += (p[key] ?? 0) * k
    }
    return out
  }

  /** how strongly the latest change of emotion surges at `t` (0…1) */
  surge(t: number): number {
    let s = 0
    for (const o of this.#onsets) s = Math.max(s, o.k * pulse(t, o.t + 0.25, 0.3, 1.2))
    return s
  }

  /** Adds the reactions' expression at `t` into `expression`. */
  react(expression: Expression, t: number): void {
    for (const r of this.#reactions) {
      const k = r.k * Math.min(1, pulse(t, r.t + 0.12, 0.12, 0.7) * 1.5)
      if (k > 0) for (const [n, v] of weightsOf(r.expression)) add(expression, n, v * k)
    }
  }
}

/** how loud a line without its recording is taken to be, of its peak */
const EVEN = 0.5
/** a track's value at `t` (s), at 100 frames a second */
const at = (track: readonly number[], t: number) => track[Math.max(0, Math.min(track.length - 1, Math.round(t * 100)))] ?? 0

/** Throws on a phrase that misdirects `words`, naming it and what is wrong. */
function check(p: Phrase, words: readonly Word[]) {
  const problem = misdirection(p, words.length)
  if (problem) throw new Error(`speak: ${problem}`)
}
