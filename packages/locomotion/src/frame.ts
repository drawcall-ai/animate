// What the planner and its feet share: the motion it is told, its reading of one frame of it, the body's measures for
// stepping, and the small geometry they all use.

import type { Humanoid } from "@drawcall/humanoid"
import { MathUtils, Vector3 } from "three"

export const { smoothstep } = MathUtils

export const SWING = 0.4 // s a foot is in the air in a walk; a run takes up to 0.1 s longer
export const TURN = 10 // rad/s the body turns to face where it goes

/** Parts of the body someone else can take: the planner then emits no goals for them. */
export type BodyPart = "armL" | "armR" | "head" | "trunk"

/** What the body should follow this frame. Only the position and velocity are needed. */
export interface Motion {
  /** The point on the ground under the body (the feet of a capsule), in the world (m). */
  position: Vector3
  /** How the body moves (m/s, world). */
  velocity: Vector3
  /** The velocity the input asks for (m/s, world): the planner predicts that the velocity turns into it. Default: the velocity. */
  desiredVelocity?: Vector3
  /** False while the body is in the air. Default: true. */
  grounded?: boolean
  /** How far down it crouches, from 0 standing (the default) to 1 fully crouched: lower pelvis, shorter steps. */
  crouch?: number
  /** Yaw to face (rad about +Y, 0 facing +Z). Default: where it goes. */
  facing?: number
  /** How high the ground is under a point (m, world; a ray cast down): each foot stands on what is under it. Default: level with the position. */
  groundHeight?: (at: Vector3) => number
  /** Parts someone else has this frame (a rifle has the arms): the planner emits nothing for them. */
  taken?: BodyPart[]
}

/** One step's reading of the motion: what every part of the step works from. */
export interface Frame {
  dt: number
  t: number
  motion: Motion
  /** The motion believed for predicting: the desired velocity, unless the body is held back from it. */
  believed: Motion
  p: Vector3
  /** The velocity, horizontal. */
  v: Vector3
  speed: number
  /** Its direction, when it moves. */
  going: Vector3 | undefined
  crouch: number
  grounded: boolean
  /** The yaw asked for, the yaw faced a frame ago, and the yaw faced now. */
  aim: number
  faced: number
  facing: number
  pace: number
  /** 0 walking, 1 running. */
  run: number
  /** How long a foot is in the air in a step. */
  airtime: number
  /** A jump being wound up: how far down it has gone (0..1), then how far it has stretched up again (0..1). */
  down: number
  pushed: number
}

// Lengths in metres, for a body whose pelvis stands 0.98 m over its soles.
const HEIGHT = 0.94 // pelvis above the ground when standing
const HIP = 0.09 // m, a foot's place beside the middle
const REACH = 0.3 // m a foot lands ahead of the pelvis in a walk at 1 m/s and above (less when slower, crouched or running)
const LIMIT = 0.48 // m behind the pelvis at which a leg is at its end, up on the ball of the foot: it leaves the ground even with the other in the air

/** A body's measures for stepping: the lengths above, in proportion to how high its pelvis stands over its soles. */
export function measure(body: Humanoid) {
  const size = (body.positionOf(body.root).y - body.positionOf(body.get("soleL")).y) / 0.98
  const [heel, ball] = [body.get("heelL"), body.get("ballL")]
  const reachAhead = REACH * size
  return {
    size,
    height: HEIGHT * size,
    hip: HIP * size,
    reachAhead,
    limit: LIMIT * size,
    /** From the heel to the ball. */
    length: ball.position.z - heel.position.z,
    /** How far ahead of the pelvis a foot lands at `speed`: a runner lands nearly under himself and takes longer strides through the air. */
    reach: (frame: Frame, speed: number) => reachAhead * (1 - 0.4 * frame.crouch) * Math.min(1, speed) * (1 - 0.45 * frame.run),
  }
}
export type Measures = ReturnType<typeof measure>

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
export const wrap = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI))
export const flat = (v: Vector3) => new Vector3(v.x, 0, v.z)
export const forward = (yaw: number) => new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
export const leftOf = (yaw: number) => new Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
/** The smoothing share of a frame of `dt` towards a value followed with time constant `tau`. */
export const follow = (dt: number, tau: number) => 1 - Math.exp(-dt / tau)

/** Where the body will be `s` seconds from now if the velocity turns into the desired one at `acceleration` (m/s²). */
export function predict(m: Motion, s: number, acceleration: number) {
  const v = flat(m.velocity),
    change = flat(m.desiredVelocity ?? m.velocity).sub(v),
    s1 = Math.min(s, change.length() / acceleration)
  const velocity = v.clone().add(change.setLength(acceleration * s1))
  return {
    position: m.position
      .clone()
      .addScaledVector(v.add(velocity), s1 / 2)
      .addScaledVector(velocity, s - s1),
    velocity,
  }
}
