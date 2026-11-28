// The head's part in acting a face: how it acts with the emotion and the line, and the posture that turns it part of the way to
// what the face looks at, the eyes turning the rest.

import type { Humanoid } from "@drawcall/humanoid"
import { type Goal, posture } from "@drawcall/ik"
import { MathUtils, type Vector3 } from "three"
import { type Delivery, pulse } from "./direction"
import type { HeadTurn, Manner } from "./emotion"
import type { Line } from "./line"
import { Spring } from "./spring"

/** how much of the way to what it looks at the head turns, and how far at most (rad) */
const TURN = { yaw: 0.6, pitch: 0.5, most: 1 }
/** how a head turn is shared between the neck and the head */
const NECK = 0.4

/** A face's head: its acting each frame, and the goal that turns a humanoid's head by it. */
export class Head {
  readonly #springs = {
    nod: new Spring(14),
    turn: new Spring(6),
    tilt: new Spring(6),
    tremble: new Spring(8),
    yaw: new Spring(6),
    pitch: new Spring(6),
  }
  #t = 0
  #sway = 0

  /** the head's acting: nods on accents, a phrase's end settling it, down for a statement and up for a question, the phrase's
   * delivery, drift, loudness and pitch, and a tremble */
  act(dt: number, manner: Manner, line: Line | undefined, delivery: Delivery): HeadTurn {
    const s = this.#springs
    const t = (this.#t += dt)
    let nod = 0
    if (line) {
      const { direction: d, t: heard } = line
      for (const a of d.accents) nod += 0.09 * manner.nod * a.strength * pulse(heard, a.t, 0.1, 0.4)
      for (const e of d.phraseEnds) nod += (e.question ? -0.07 : 0.06) * pulse(heard, e.t + 0.05, 0.15, 0.7)
      // louder, the chin lowers; higher, it rises a little
      nod += 0.03 * d.loudness(heard) - (0.01 * d.pitch(heard)) / 6
    }
    this.#sway += dt * manner.swaySpeed
    const tremble = s.tremble.step(manner.tremble, dt) * (Math.sin(t * 41) * 0.6 + Math.sin(t * 67 + 1) * 0.4)
    nod += delivery.head.pitch + manner.head.pitch + 0.012 * manner.sway * Math.sin(this.#sway * 0.9) + tremble
    const yaw = delivery.head.yaw + manner.head.yaw + 0.025 * manner.sway * Math.sin(this.#sway * 0.37) + tremble * 0.7
    const roll = delivery.head.roll + manner.head.roll + 0.015 * manner.sway * Math.sin(this.#sway * 0.53 + 1)
    s.nod.k = manner.stiffness
    s.turn.k = s.tilt.k = manner.stiffness * 0.45
    return { yaw: s.turn.step(yaw, dt), pitch: s.nod.step(nod, dt), roll: s.tilt.step(roll, dt) }
  }

  /** `body`'s head posture: turned part of the way to `lookAt`, from the chest, and `acting` on top; a posture listing only the
   * neck and the head, of weight 10, so that it outweighs a posture of the whole body */
  goal(dt: number, body: Humanoid, acting: HeadTurn, lookAt: Readonly<Vector3> | undefined): Goal {
    const s = this.#springs
    let yaw = 0,
      pitch = 0
    if (lookAt) {
      const d = lookAt
        .clone()
        .sub(body.positionOf(body.get("eyes")))
        .applyQuaternion(body.quaternionOf(body.get("chest")).invert())
      yaw = MathUtils.clamp(TURN.yaw * Math.atan2(d.x, d.z), -TURN.most, TURN.most)
      pitch = MathUtils.clamp(TURN.pitch * Math.atan2(-d.y, Math.hypot(d.x, d.z)), -TURN.most, TURN.most)
    }
    const turn = [s.pitch.step(pitch, dt) + acting.pitch, s.yaw.step(yaw, dt) + acting.yaw, acting.roll]
    const upright = body.uprightPose
    const angles = (name: "neck" | "head", k: number) => turn.map((v, i) => upright[name][i] + v * k)
    return posture(body, { neck: angles("neck", NECK), head: angles("head", 1 - NECK) }, 10, { unlistedWeight: 0 })
  }
}
