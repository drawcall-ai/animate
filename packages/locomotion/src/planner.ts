// LOCOMOTION: one planner for a humanoid on its feet. Each frame it is told where the body should be and how it
// moves (a physics capsule, say) and returns this frame's goals for the solver. There are no gaits in here:
//  - the feet step by one rule about when a foot must leave and where it lands (feet.ts).
//  - the pelvis is a strong SOFT goal on the given position, so where the legs cannot reach it gives, not the feet.
//    It carries the weight of the gait: over the standing leg in a walk, down into the stance and up through the
//    flight in a run, leaning with speed and into every acceleration.
//  - the rest is posture read off the feet: the chest turns and tilts against the pelvis, the arms swing against
//    the legs.
//  - the pelvis turns to face where it goes, but no further from a planted foot than the hip allows (TWIST): a turn
//    takes steps.
// The trade-off is in two numbers: the weight of the pelvis goal (how hard the body is held to the capsule) and LIMIT
// (how far a leg stretches before the foot leaves the ground). A capsule can do what no body can; the planted feet
// never slide, so what gives is the pelvis. The few centimetres it is off the capsule in a walk are its sway over the
// standing leg, on purpose.

import type { Humanoid, Side } from "@drawcall/humanoid"
import { type Goal, type Pose, posture, soft, Target } from "@drawcall/ik"
import { Quaternion, Vector3 } from "three"
import { Feet, type Foot } from "./feet"
import { type BodyPart, clamp, flat, follow, forward, type Frame, leftOf, measure, type Measures, type Motion, smoothstep, SWING, TURN, wrap } from "./frame"

const Y = new Vector3(0, 1, 0)
const TWIST = 0.8 // rad the pelvis can be turned from a planted foot: turning further takes a step
const WINDUP = 0.22 // s of going down before a jump
const PUSH = 0.1 // s of stretching up onto the toes, at the end of which it leaves the ground

const BONES: Record<BodyPart, string[]> = {
  armL: ["shoulderL", "upperArmL", "forearmL", "handL"],
  armR: ["shoulderR", "upperArmR", "forearmR", "handR"],
  head: ["neck", "head"],
  trunk: ["spine", "chest"],
}

/** How the planner moves a humanoid. */
export interface LocomotionOptions {
  /** How fast the body's velocity turns into the desired one (m/s²), as whatever moves the body does it (a capsule's controller): only used to predict where it will be. Default: 35. */
  acceleration?: number
  /** How fast a body in the air falls (m/s²), to predict where it lands. Default: 9.81. */
  gravity?: number
  /** The highest step the body gets onto without jumping (m), a capsule's step height: no foot is put on anything higher above the position. Default: 0.3. */
  stepHeight?: number
  /** How much the pelvis sways, tilts and turns with each step, as a share of an ordinary walk's: 1 (the default) is an ordinary walk, 0 none. */
  hipSwing?: number
  /** How much the trunk turns and tilts against the pelvis and the arms swing, as a share of an ordinary walk's: 1 (the default) is an ordinary walk, 0 none. A broad-shouldered man swings the shoulders more and the hips less. */
  shoulderSwing?: number
  /** How far out from the sides the upper arms hang (rad): more for a bulky trunk or kit. Default: 0.1. */
  armSpread?: number
}

/** How the body carries itself this frame, read off the feet. */
interface Carriage {
  /** The foot it stands on, with the other in the air. */
  stance: Feet["left"] | undefined
  /** How far the left foot is ahead of the right, -1..1. */
  stride: number
  /** Rad the pelvis tilts, the standing leg's hip up. */
  list: number
  lean: Vector3
  /** How much it bows forward: the forward share of the lean, and more as the knees bend. */
  bow: number
}

/**
 * A planner for a humanoid on its feet: each frame `update` is told where the body should be and how it moves, and
 * returns this frame's goals for its feet, pelvis and whole posture, to solve together with the frame's other goals.
 * Its weights: a planted foot is a hard goal; the pelvis is a soft goal of weight 100 on the motion's position, a
 * swinging foot one of 30, a foot's turn one of 10 planted and 1 in the air, and its posture lists every bone not
 * `taken` with weight 0.1.
 */
export class LocomotionPlanner {
  readonly #feet: Feet
  readonly #body: Humanoid
  readonly #measures: Measures
  readonly #acceleration: number
  readonly #gravity: number
  /** How the body carries itself as it goes (see the constructor) */
  readonly #gait: { hipSwing: number; shoulderSwing: number; armSpread: number }
  readonly #pelvis = new Target()
  readonly #was = new Vector3() // the velocity a frame ago, and the acceleration read off it
  readonly #push = new Vector3()
  #t = 0
  #pace = 0 // the speed, smoothed: how the body carries itself changes over a few steps, not in a frame
  #facing: number
  #squat = 0 // m the pelvis is down from bending the knees: a spring, pushed by a landing and by the windup of a jump
  #squatSpeed = 0
  #bob = 0 // m the pelvis is up or down with the step
  #sway = 0 // which leg the body is over, -1..1
  #spin = 0 // rad/s it turns: all three smoothed
  #held = 0 // s the velocity has not been turning into the desired one: something is in the way
  #arms = 0 // -1 swung back for a jump .. 1 thrown up with it, smoothed
  #windup: { start: number; launch: () => void } | undefined

  /** The planner for `body`, which starts as the body stands. */
  constructor(
    body: Humanoid,
    { acceleration = 35, gravity = 9.81, stepHeight = 0.3, hipSwing = 1, shoulderSwing = 1, armSpread = 0.1 }: LocomotionOptions = {},
  ) {
    this.#body = body
    this.#gait = { hipSwing, shoulderSwing, armSpread }
    this.#acceleration = acceleration
    this.#gravity = gravity
    this.#measures = measure(body)
    this.#feet = new Feet(body, this.#measures, { acceleration, gravity, stepHeight })
    this.#facing = this.#feet.left.yaw
  }

  /** The feet as this frame left them. */
  get feet(): { readonly left: Foot; readonly right: Foot } {
    return { left: this.#feet.left, right: this.#feet.right }
  }

  /** Seconds the planner has run. */
  get time() {
    return this.#t
  }

  /** Whether the body is in the air (a jump or a fall, not the flight phase of a run). */
  get airborne() {
    return !!this.#feet.air
  }

  /**
   * Jump: the body goes down, arms back, then stretches up onto its toes and throws the arms up; at the end of that
   * `launch` is called, which must send the body up (a capsule's jump). In the air the legs hang stretched, toes
   * pointed; they reach for the ground before it comes and the knees take the landing.
   * From there to the landing the planner is committed: it follows the body through the air and lands on both feet.
   */
  jump(launch: () => void) {
    if (!this.#feet.air && !this.#windup) this.#windup = { start: this.#t, launch }
  }

  /**
   * Ask for a foot to be planted at a place (m, world) `inSeconds` from now, turned to `yaw` (rad about +Y, 0
   * facing +Z; where the body faces by default). Returns whether that fits:
   * the foot can be free and get there in time, and the place is under where the body will be. If not, nothing changes.
   */
  plant(side: Side, position: Vector3, inSeconds: number, yaw = this.#facing): boolean {
    return this.#feet.plant(side, position, inSeconds, yaw, this.#t)
  }

  /** One frame of `dt` seconds: follow `motion`, step the feet, and return this frame's goals. Call it once per frame, with the dt the frame is solved with. */
  update(dt: number, motion: Motion): Goal[] {
    const frame = this.#follow(dt, motion)
    this.#squatSpeed += 1.4 * this.#feet.step(frame) // landing from the air, the knees take the fall
    this.#spring(frame)
    const carriage = this.#carriage(frame)
    return [...this.#feet.both.flatMap((f) => this.#feet.goals(frame, f)), this.#pelvisGoal(frame, carriage), this.#postureGoal(frame, carriage)]
  }

  /** Reads this frame's motion: the time, where the body faces, the acceleration, the pace, a jump's windup. */
  #follow(dt: number, motion: Motion): Frame {
    this.#t += dt
    const t = this.#t
    const p = motion.position,
      v = flat(motion.velocity),
      speed = v.length(),
      want = flat(motion.desiredVelocity ?? motion.velocity)
    const aim = motion.facing ?? (want.length() > 0.3 ? Math.atan2(want.x, want.z) : this.#facing)
    const faced = this.#facing
    this.#facing += clamp(wrap(aim - this.#facing), -TURN * dt, TURN * dt)
    for (const f of this.#feet.both) if (!f.swing && !this.#feet.air) this.#facing = f.yaw + clamp(wrap(this.#facing - f.yaw), -TWIST, TWIST)
    const facing = this.#facing
    if (dt > 0) this.#push.lerp(v.clone().sub(this.#was).divideScalar(dt), follow(dt, 0.15))
    // Held back (a wall, say): the velocity does not turn into the desired one. Then it is the velocity that is believed.
    this.#held = want.distanceTo(v) > 0.3 && v.distanceTo(this.#was) < 0.2 * this.#acceleration * dt ? this.#held + dt : 0
    this.#was.copy(v)
    this.#pace += (speed - this.#pace) * follow(dt, 0.2)
    const run = smoothstep((this.#pace - 1.8) / 1.5, 0, 1)
    const windup = this.#windup
    return {
      dt,
      t,
      motion,
      believed: this.#held > 0.15 ? { ...motion, desiredVelocity: motion.velocity } : motion,
      p,
      v,
      speed,
      going: speed > 0.1 ? v.clone().normalize() : undefined,
      crouch: clamp(motion.crouch ?? 0, 0, 1),
      grounded: motion.grounded ?? true,
      aim,
      faced,
      facing,
      pace: this.#pace,
      run,
      airtime: SWING + 0.1 * run,
      down: windup ? smoothstep((t - windup.start) / WINDUP, 0, 1) : 0,
      pushed: windup ? smoothstep((t - windup.start - WINDUP) / PUSH, 0, 1) : 0,
    }
  }

  /** The spring in the knees, the arms with a jump, and the jump's launch at the end of its windup. */
  #spring(frame: Frame) {
    const { dt, t, down, pushed } = frame,
      windup = this.#windup,
      air = this.#feet.air,
      { size } = this.#measures
    if (windup) {
      this.#squat = (0.28 * down * (1 - pushed) - 0.05 * pushed) * size // down, then up past standing: it is on its toes
      this.#squatSpeed = 0
    } else {
      this.#squatSpeed += (64 * ((air ? -0.04 * size : 0) - this.#squat) - 16 * this.#squatSpeed) * dt // stretched in the air
      this.#squat = clamp(this.#squat + this.#squatSpeed * dt, -0.05, 0.35)
    }
    // The arms go back as it goes down, are thrown up as it stretches and rises, and come down as it falls.
    const arms = windup ? 2 * pushed - down : air ? clamp(frame.motion.velocity.y / 3, -0.3, 1) : 0
    this.#arms += (arms - this.#arms) * follow(dt, 0.07)
    if (windup && t >= windup.start + WINDUP + PUSH) {
      windup.launch()
      this.#windup = undefined
    }
  }

  /** Which leg it stands on, the stride, the tilt of the hips, and the lean with the speed, into every acceleration and into a turn. */
  #carriage(frame: Frame): Carriage {
    const { dt, v, speed, crouch, run, faced, facing } = frame,
      { left, right, both, air } = this.#feet
    const stance = !air && both.filter((f) => f.swing).length === 1 ? both.find((f) => !f.swing) : undefined
    this.#sway += ((stance ? stance.sign * Math.min(1, speed) : 0) - this.#sway) * follow(dt, 0.12) // -1..1: which leg it stands on
    this.#spin += ((dt > 0 ? wrap(facing - faced) / dt : 0) - this.#spin) * follow(dt, 0.15)
    const lean = this.#push
      .clone()
      .multiplyScalar(0.03)
      .clampLength(0, 0.3)
      .addScaledVector(v, 0.025)
      .addScaledVector(leftOf(facing), clamp(0.012 * this.#spin * speed, -0.3, 0.3)) // it banks into a turn
      .addScaledVector(forward(facing), 0.2 * crouch)
      .clampLength(0, 0.45)
    return {
      stance,
      stride: clamp(left.position.clone().sub(right.position).dot(forward(facing)) / this.#measures.size, -1, 1),
      list: this.#sway * (0.12 - 0.02 * run),
      lean,
      bow: lean.dot(forward(facing)) + 1.5 * Math.max(0, this.#squat), // the trunk takes a share of the lean
    }
  }

  /**
   * The pelvis follows the body, over the ground its feet are on, and carries the gait. Up and down: in a walk it
   * rides over the standing leg and is lowest with both feet down; in a run it sinks into the stance and rises through
   * the flight. Sideways: over the standing leg, that hip higher. It turns with the stride and leans with the speed and
   * into every acceleration.
   */
  #pelvisGoal(frame: Frame, { stance, stride, list, lean }: Carriage): Goal {
    const { dt, t, p, speed, going, crouch, grounded, facing, pace, run } = frame,
      { size, limit, height } = this.#measures,
      { left, right, both, air, flight } = this.#feet,
      swings = both.flatMap((f) => (f.swing ? [f.swing] : []))
    const reach = this.#measures.reach(frame, speed),
      phase = stance && going ? clamp((reach - flat(stance.position).sub(stance.beside).dot(going)) / (reach + limit), 0, 1) : 0
    const step = Math.min(1, speed) * Math.sin(Math.PI * phase) * size
    const bob = stance ? (0.035 * (1 - run) - 0.07 * run) * step : swings.length ? 0 : -0.012 * Math.min(1, speed) * size
    this.#bob += (bob - this.#bob) * follow(dt, 0.05)
    // a run's flight, not a jump
    const hop =
      grounded && swings.length === 2 ? clamp((this.#gravity / 2) * (t - flight) * (Math.min(...swings.map((s) => s.end)) - t), 0, 0.06 * size) * run : 0
    const ground = air ? p.y : (left.position.y + right.position.y) / 2
    const pelvisHeight = ground + height - 0.3 * crouch - 0.05 * Math.min(1, pace / 3) - this.#squat + hop + this.#bob
    const hips = this.#gait.hipSwing
    this.#pelvis.set({
      position: new Vector3(p.x, pelvisHeight, p.z).addScaledVector(leftOf(facing), hips * this.#sway * (0.035 - 0.02 * run) * size),
      quaternion: new Quaternion()
        .setFromAxisAngle(new Vector3().crossVectors(Y, lean).normalize(), 0.65 * lean.length())
        .multiply(new Quaternion().setFromAxisAngle(Y, facing - hips * (0.25 + 0.1 * run) * stride))
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), hips * list)),
    })
    return soft(this.#body.root, this.#pelvis, 100)
  }

  /**
   * Posture: the chest turns and tilts against the pelvis and takes its share of the lean, the head stays level, the
   * arms swing against the legs with the elbows bent more the faster it goes. What it leaves out (the legs, the
   * shoulders, the hands) it holds at neutral as firmly; the parts someone else has it leaves alone.
   */
  #postureGoal(frame: Frame, { stride, list, bow }: Carriage): Goal {
    const { crouch, run, motion } = frame,
      arms = this.#arms
    const { shoulderSwing: shoulders, armSpread } = this.#gait
    const swing = shoulders * (0.6 + 0.15 * run) * stride,
      nod = -0.5 * (bow + 0.3 * crouch)
    const pose: Pose = {
      spine: [0.3 * crouch + 0.2 * bow, shoulders * (0.2 + 0.05 * run) * stride, -shoulders * 0.6 * list],
      chest: [0.15 * bow, shoulders * (0.25 + 0.1 * run) * stride, -shoulders * 0.7 * list], // the shoulders tilt against the hips
      neck: [nod / 2, -0.1 * stride, 0],
      head: [nod / 2, -0.1 * stride, 0],
    }
    for (const f of this.#feet.both) {
      const sign = f.sign
      pose["upperArm" + f.suffix] = [sign * swing - 0.15 * run - (arms > 0 ? 1.5 : 0.8) * arms, sign * (armSpread + 0.1 * run + 0.25 * Math.abs(arms)), 0]
      pose["forearm" + f.suffix] = [-0.25 - 1.25 * run - 0.15 * Math.max(0, -sign * swing) - 0.4 * Math.abs(arms), 0]
    }
    return posture(this.#body, pose, 0.1, { unlistedWeight: 1, skip: (motion.taken ?? []).flatMap((part) => BONES[part]) })
  }
}
