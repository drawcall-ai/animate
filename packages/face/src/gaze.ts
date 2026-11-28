// Where a face's eyes look and how its lids move: exactly at the point, off it by saccades and the line's glances, blinking at
// the line's pauses, after its glances and idly, the upper lids following the eyes.

import { MathUtils, type Vector3 } from "three"
import type { Expression } from "./blendshapes"
import { pulse } from "./direction"
import type { Manner } from "./emotion"
import type { Eyes, Face, Look } from "./face"
import type { Line } from "./line"
import { Spring } from "./spring"

/** where the lids rest, of a blink: a little over the iris (an open stare reads as alarm) */
const LIDS = 0.1
/** the upper lid following an eye down (+) or up, by its pitch (× rad), at most so far each way (of a blink) */
const LID = { follow: 1.3, down: 0.35, up: 0.2 }
/** how far an eye turns (rad) */
const EYE = { side: 0.6, up: 0.4, down: 0.5 }
const AHEAD: Eyes = { left: { yaw: 0, pitch: 0 }, right: { yaw: 0, pitch: 0 } }

const clamp = MathUtils.clamp

/** A face's eyes and lids over time, drawing their timing from `random`. */
export class Gaze {
  readonly #face: Face
  readonly #random: () => number
  readonly #springs = { yaw: new Spring(30), pitch: new Spring(30), lids: new Spring(8) }
  readonly #saccade: Look = { yaw: 0, pitch: 0 }
  #t = 0
  #nextBlink: number
  #blinked = -10
  #nextSaccade: number

  constructor(face: Face, random: () => number) {
    this.#face = face
    this.#random = random
    this.#nextBlink = MathUtils.lerp(1, 4, random())
    this.#nextSaccade = MathUtils.lerp(0.3, 1, random())
  }

  /** a frame of `dt` (s): sets the lids in `w` and returns the eyes, looking at `lookAt` from where the emotion rests them */
  update(dt: number, w: Expression, manner: Manner, line: Line | undefined, lookAt: Vector3 | undefined): Eyes {
    this.#t += dt
    this.#blink(dt, w, manner, line)
    const off = this.#off(dt, manner, line)
    const at = lookAt ? this.#face.lookAt(lookAt) : AHEAD
    const eye = (look: Look, side: "Left" | "Right"): Look => {
      const turned = { yaw: clamp(look.yaw + off.yaw, -EYE.side, EYE.side), pitch: clamp(look.pitch + off.pitch, -EYE.up, EYE.down) }
      w[`eyeBlink${side}`] = clamp((w[`eyeBlink${side}`] ?? 0) + clamp(turned.pitch * LID.follow, -LID.up, LID.down), 0, 1)
      return turned
    }
    return { left: eye(at.left, "Left"), right: eye(at.right, "Right") }
  }

  /** the lids: where the emotion rests them, and blinks */
  #blink(dt: number, w: Expression, manner: Manner, line: Line | undefined) {
    const t = this.#t,
      slow = 1 / manner.blinkSpeed
    let blink = 0
    if (line)
      for (const at of [...line.direction.pauses, ...line.direction.glances]) blink = Math.max(blink, pulse(line.t, at + 0.05, 0.06 * slow, 0.12 * slow))
    if (t > this.#nextBlink) {
      this.#blinked = t
      this.#nextBlink = t + MathUtils.lerp(...manner.blinkEvery, this.#random())
    }
    blink = Math.max(blink, pulse(t, this.#blinked + 0.06, 0.06 * slow, 0.12 * slow))
    w.eyeBlinkLeft = w.eyeBlinkRight = LIDS + this.#springs.lids.step(manner.lid, dt) + 0.8 * blink
  }

  /** how far off what they look at the eyes are: where the emotion rests them, a saccade, and the line's glances */
  #off(dt: number, manner: Manner, line: Line | undefined): Look {
    const saccade = this.#saccade
    if (this.#t > this.#nextSaccade) {
      saccade.yaw = (this.#random() - 0.5) * 0.12 * manner.saccade
      saccade.pitch = (this.#random() - 0.5) * 0.06 * manner.saccade
      this.#nextSaccade = this.#t + MathUtils.lerp(...manner.saccadeEvery, this.#random())
    }
    let yaw = saccade.yaw + manner.rest[0],
      pitch = saccade.pitch + manner.rest[1]
    if (line)
      for (const g of line.direction.glances) {
        const k = pulse(line.t, g, 0.06, 0.6)
        yaw += manner.glance[0] * k
        pitch += manner.glance[1] * k
      }
    return { yaw: this.#springs.yaw.step(yaw, dt), pitch: this.#springs.pitch.step(pitch, dt) }
  }
}
