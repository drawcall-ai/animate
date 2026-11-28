import type { Speech } from "@drawcall/speech"
import { Articulation } from "./articulation"
import { Direction, type Phrase } from "./direction"

/** A line a face says: its direction and mouth, and how far into its recording the listener is. */
export class Line {
  readonly direction: Direction
  readonly articulation: Articulation
  /** when it has been spoken (s into the recording): its last word over and the mouth come to rest */
  readonly ends: number
  /** the time into the recording heard (s) */
  t = 0
  readonly #heard: (() => number) | undefined

  /** Throws on phrases that misdirect `speech`, an unknown phone or a silent recording. `heard`: the time into the recording heard as a frame is shown (s); without it, the time the line has been updated. */
  constructor(speech: Speech, phrases: readonly Phrase[], heard: (() => number) | undefined) {
    this.articulation = new Articulation(speech.phones)
    this.direction = new Direction(speech, phrases)
    this.ends = Math.max(this.articulation.rests, speech.words[speech.words.length - 1]?.end ?? 0)
    this.#heard = heard
  }

  /** heard to its end */
  get spoken(): boolean {
    return this.t >= this.ends
  }

  /** Moves on by a frame of `dt` (s), reading the clock it hears once. */
  advance(dt: number): void {
    if (!this.#heard) {
      this.t += dt
      return
    }
    const t = this.#heard()
    if (!Number.isFinite(t)) throw new Error(`speak: heard gave ${t}`)
    this.t = t
  }
}
