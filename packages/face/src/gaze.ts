// Where a face's eyes look and how its lids move: exactly at the point, off it by saccades, which jump, and the line's glances,
// which glide; blinking at the line's pauses, after its glances and idly.

import { MathUtils, type Vector3 } from "three"
import type { Expression } from "./blendshapes"
import { pulse } from "./direction"
import type { Manner } from "./emotion"
import type { Eyes, Face, Look } from "./face"
import type { Line } from "./line"
import { Spring } from "./spring"

/** where the lids rest, of a blink: a little over the iris (an open stare reads as alarm) */
const LIDS = 0.1
/** how far an eye turns (rad) */
const EYE = { side: 0.6, up: 0.4, down: 0.5 }
const AHEAD: Eyes = { left: { yaw: 0, pitch: 0 }, right: { yaw: 0, pitch: 0 } }

const clamp = MathUtils.clamp

/** A face's eyes and lids over time, drawing their timing from `random`. */
export class Gaze {
  readonly #face: Face
  readonly #random: () => number
  readonly #springs = { yaw: new Spring(30), pitch: new Spring(30), saccadeYaw: new Spring(150), saccadePitch: new Spring(150), lids: new Spring(8) }
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

  /** a frame of `dt` (s): sets the lids in `w` and returns the eyes, looking at `lookAt` from where the emotion rests them; the
   * face has their lids follow them */
  update(dt: number, w: Expression, manner: Manner, line: Line | undefined, lookAt: Readonly<Vector3> | undefined): Eyes {
    this.#t += dt
    this.#blink(dt, w, manner, line)
    const off = this.#off(dt, manner, line)
    const at = lookAt ? this.#face.lookAt(lookAt) : AHEAD
    const eye = (look: Look): Look => ({ yaw: clamp(look.yaw + off.yaw, -EYE.side, EYE.side), pitch: clamp(look.pitch + off.pitch, -EYE.up, EYE.down) })
    return { left: eye(at.left), right: eye(at.right) }
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
    const rest = clamp(LIDS + this.#springs.lids.step(manner.lid, dt), 0, 1)
    // a blink shuts the lids from wherever they rest
    w.eyeBlinkLeft = w.eyeBlinkRight = rest + (1 - rest) * blink
  }

  /** how far off what they look at the eyes are: a saccade, jumping there in some 30 ms, and where the emotion rests them and the
   * line's glances, gliding */
  #off(dt: number, manner: Manner, line: Line | undefined): Look {
    const s = this.#springs,
      saccade = this.#saccade
    if (this.#t > this.#nextSaccade) {
      saccade.yaw = (this.#random() - 0.5) * 0.12 * manner.saccade
      saccade.pitch = (this.#random() - 0.5) * 0.06 * manner.saccade
      this.#nextSaccade = this.#t + MathUtils.lerp(...manner.saccadeEvery, this.#random())
    }
    let yaw = manner.rest[0],
      pitch = manner.rest[1]
    if (line)
      for (const g of line.direction.glances) {
        const k = pulse(line.t, g, 0.06, 0.6)
        yaw += manner.glance[0] * k
        pitch += manner.glance[1] * k
      }
    return {
      yaw: s.saccadeYaw.step(saccade.yaw, dt) + s.yaw.step(yaw, dt),
      pitch: s.saccadePitch.step(saccade.pitch, dt) + s.pitch.step(pitch, dt),
    }
  }
}
