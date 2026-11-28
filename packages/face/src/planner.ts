// FACE: a planner that acts a face over time. Each frame it is told the emotion to show and where to look, and from that, the
// line it says, if any, and its own life it sets the face's blendshapes and eyes and returns the goal that turns the head.
//  - what an emotion sets moves on springs, so a change of emotion never jumps; the lips stay quick and the cheeks trail them.
//  - the mouth comes from the line's phones (articulation.ts); its p, b and m shut the lips whatever the expression asks.
//  - the eyes and lids are gaze.ts's, the head's acting and turn head.ts's.

import type { Humanoid } from "@drawcall/humanoid"
import type { Goal } from "@drawcall/ik"
import type { Speech } from "@drawcall/speech"
import { MathUtils, type Vector3 } from "three"
import { add, type BlendShape, type Expression, weightsOf } from "./blendshapes"
import { type Delivery, type Phrase, pulse } from "./direction"
import { blend, type Emotion, isEmotion, MANNER, type Manner } from "./emotion"
import type { Face } from "./face"
import { Gaze } from "./gaze"
import { Head } from "./head"
import { Line } from "./line"
import { Spring, springOf } from "./spring"

/** How the face is to be this frame. */
export interface Demeanor {
  /** The emotion it shows. Default: neutral. */
  emotion?: Emotion
  /** How strongly, 0…1. Default: 1. */
  intensity?: number
  /** What it looks at (m, world). Default: ahead. */
  lookAt?: Vector3
}

/** How a line is said. */
export interface SpeakOptions {
  /** Its direction. Default: none, the face following the voice alone in the emotion it is updated with. */
  phrases?: readonly Phrase[]
  /**
   * The time into the recording heard as the frame is shown (s), read once an update: an audio clock less its output latency,
   * say. Default: the time the planner has been updated since `speak`, which keeps to a sound started with it only while frames
   * keep coming. The line is over only once this reaches its end, so a clock that stands still keeps it going.
   */
  heard?: () => number
}

/** how far each shape that parts the lips gives way to their shutting on a p, b or m, whatever else asks for it; a frown keeps half,
 * which the closure's roll of the lips holds shut */
const YIELDS: readonly (readonly [BlendShape, number])[] = [
  ["jawOpen", 1],
  ["mouthFunnel", 1],
  ["mouthShrugUpper", 1],
  ...(["Left", "Right"] as const).flatMap(
    (side) =>
      [
        [`mouthLowerDown${side}`, 1],
        [`mouthUpperUp${side}`, 1],
        [`mouthStretch${side}`, 1],
        [`mouthFrown${side}`, 0.5],
      ] as const,
  ),
]
/** the upper face may push past 1 (an accent on a held expression); the mouth stays within its shapes */
const UPPER = /^(brow|cheekSquint|eyeSquint)/
/** the delivery of no line */
const PLAIN: Delivery = { head: { yaw: 0, pitch: 0, roll: 0 }, smile: 0, brows: 0, squint: 0 }

let planners = 0

/**
 * A planner for a face (and, given a humanoid, its head): each frame `update` is told the emotion to show and where to look, sets
 * the face's blendshapes and eyes, and returns this frame's goals for the head, to solve with the frame's other goals. `speak`
 * has it say a line from then on. Its goal is a posture listing only the neck and the head, of weight 10: it outweighs a posture of the whole body.
 */
export class FacePlanner {
  readonly #face: Face
  readonly #body: Humanoid | undefined
  readonly #head = new Head()
  readonly #gaze: Gaze
  readonly #springs = { brows: new Spring(18), smile: new Spring(8), squint: new Spring(8) }
  /** the held expression, shape by shape */
  readonly #expression = new Map<BlendShape, Spring>()
  /** the cheeks, trailing the lips */
  readonly #cheeks = new Map<BlendShape, Spring>()
  #t = 0
  #line: Line | undefined

  /** The planner for `face`; given `body`, the humanoid whose head carries it, it also turns that head. */
  constructor(face: Face, body?: Humanoid) {
    this.#face = face
    this.#body = body
    this.#gaze = new Gaze(face, seeded(++planners))
  }

  /** Whether it is saying a line. */
  get speaking(): boolean {
    return !!this.#line
  }

  /** Says `speech` from now on, in place of any line it says, its sound to start now. Throws on malformed speech or phrases, naming what is wrong. */
  speak(speech: Speech, { phrases = [], heard }: SpeakOptions = {}): void {
    this.#line = new Line(speech, phrases, heard)
  }

  /** A frame of `dt` (s): sets the face and returns the head's goals. Throws on an unknown emotion or an intensity outside 0…1. */
  update(dt: number, { emotion = "neutral", intensity = 1, lookAt }: Demeanor = {}): Goal[] {
    if (!isEmotion(emotion)) throw new Error(`no emotion "${emotion}": one of ${Object.keys(MANNER).join(", ")}`)
    if (!(intensity >= 0 && intensity <= 1)) throw new Error(`an intensity of ${intensity}, not within 0…1`)
    this.#t += dt
    const line = this.#line
    line?.advance(dt)
    if (line?.spoken) this.#line = undefined
    const saying = this.#line
    const base = blend([[MANNER[emotion], intensity]])
    const manner = saying ? saying.direction.manner(saying.t, base) : base
    const delivery = saying ? saying.direction.delivery(saying.t) : PLAIN
    const expression: Expression = {}
    // louder speech opens the jaw wider
    const shut = saying ? saying.articulation.shape(expression, saying.t, manner.articulation * (0.6 + 0.8 * saying.direction.loudness(saying.t))) : 0
    const acting = this.#head.act(dt, manner, saying, delivery)
    this.#brows(dt, expression, manner, saying, delivery)
    this.#express(dt, expression, manner, saying, delivery)
    this.#settle(dt, expression, shut)
    const eyes = this.#gaze.update(dt, expression, manner, saying, lookAt)
    this.#face.set(expression, eyes)
    return this.#body ? [this.#head.goal(dt, this.#body, acting, lookAt)] : []
  }

  /** the brows: the phrase's level, flicks on accents, raised by a higher pitch */
  #brows(dt: number, w: Expression, manner: Manner, line: Line | undefined, delivery: Delivery) {
    let brows = delivery.brows
    if (line) {
      const { direction: d, t } = line
      for (const a of d.accents) brows += 0.45 * manner.browAccent * a.strength * pulse(t, a.t - 0.05, 0.08, 0.3)
      brows += ((Math.max(0, manner.browAccent) * Math.max(0, d.pitch(t))) / 8) * 0.35
    }
    const b = this.#springs.brows.step(brows, dt),
      up = Math.max(0, b),
      down = Math.max(0, -b)
    add(w, "browInnerUp", up * 0.8)
    add(w, "browOuterUpLeft", up)
    add(w, "browOuterUpRight", up * 0.9)
    add(w, "browDownLeft", down * 0.8)
    add(w, "browDownRight", down * 0.8)
  }

  /** the held expression: stronger for emotions that rise with the voice, surging as the emotion changes, drifting, its muscles
   * firing on stressed words, and the line's reactions; and the phrase's smile and squint */
  #express(dt: number, w: Expression, manner: Manner, line: Line | undefined, delivery: Delivery) {
    const t = this.#t,
      d = line?.direction,
      heard = line?.t ?? 0
    const drift = 0.1 * Math.sin(t * 0.71) * Math.sin(t * 1.37 + 2)
    const intensity = (1 + manner.loudness * ((d ? d.loudness(heard) : 0) - 0.4)) * (1 + 0.35 * (d ? d.surge(heard) : 0))
    let accent = 0
    if (d) for (const a of d.accents) accent += a.strength * pulse(heard, a.t - 0.06, 0.09, 0.4)
    const aims: Expression = {}
    for (const [k, v] of weightsOf(manner.expression)) aims[k] = v * intensity
    for (const [k, v] of weightsOf(manner.accent)) add(aims, k, v * Math.min(1.2, accent))
    d?.react(aims, heard)
    // the drift on what the expression has come to, so that a held expression comes to rest on its aim
    for (const k of new Set([...weightsOf(aims).map(([k]) => k), ...this.#expression.keys()]))
      add(w, k, springOf(this.#expression, k, 11).step(aims[k] ?? 0, dt) * (1 + drift))
    const s = this.#springs
    const smile = s.smile.step(delivery.smile, dt),
      squint = s.squint.step(delivery.squint, dt)
    add(w, "mouthSmileLeft", smile)
    add(w, "mouthSmileRight", smile * 0.92)
    add(w, "cheekSquintLeft", smile * 0.5)
    add(w, "cheekSquintRight", smile * 0.45)
    add(w, "eyeSquintLeft", squint)
    add(w, "eyeSquintRight", squint)
  }

  /** the cheeks raised with the smile and trailing the lips; then the lips shut by `shut` whatever else asks, and every shape kept within its range */
  #settle(dt: number, w: Expression, shut: number) {
    add(w, "cheekSquintLeft", 0.35 * (w.mouthSmileLeft ?? 0))
    add(w, "cheekSquintRight", 0.35 * (w.mouthSmileRight ?? 0))
    for (const k of ["cheekSquintLeft", "cheekSquintRight", "cheekPuff"] as const) w[k] = springOf(this.#cheeks, k, 9).step(within(k, w[k] ?? 0), dt)
    for (const [k, yields] of YIELDS) if (w[k] !== undefined) w[k] *= 1 - yields * shut
    for (const [k, v] of weightsOf(w)) w[k] = within(k, v)
    // `mouthClose` closes the lips against the jaw's opening: more pushes them through each other
    if (w.mouthClose !== undefined) w.mouthClose = Math.min(w.mouthClose, w.jawOpen ?? 0)
  }
}

/** `value` of the shape `name` kept within its range */
const within = (name: BlendShape, value: number) => MathUtils.clamp(value, 0, UPPER.test(name) ? 1.3 : 1)

/** a seeded uniform [0, 1) (mulberry32): the same seed, the same numbers */
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
