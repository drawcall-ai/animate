// FEET: when each foot leaves the ground, where it lands, and how it rolls while it stands.
//  - a planted foot stays where it is (the only HARD goals) until the pelvis has travelled past it, then swings to
//    land ahead of where the pelvis will be. Walking, both feet are down for a while; above about 2 m/s the pelvis
//    outruns the planted foot before the other has landed, and that is the flight phase of a run. Stopping, turning
//    on the spot and turning around are the same rule with another velocity.
//  - a foot rolls: in a walk it lands on the heel, comes down flat, and leaves over the ball with the heel up. What
//    is planted is that one point of it, so nothing slides while the rest of the foot turns about it.
//  - commitment: a foot in the air lands when it was going to. Its spot follows the prediction until COMMIT before,
//    then stays unless the body has left it beyond the leg's reach. A jump is committed from the launch to the ground;
//    an asked-for plant fixes its spot from the start.

import type { Humanoid, Side } from "@drawcall/humanoid"
import { type Goal, hard, soft, Target } from "@drawcall/ik"
import { type Object3D, Quaternion, Vector3 } from "three"
import { clamp, flat, forward, type Frame, leftOf, type Measures, type Motion, predict, smoothstep, SWING, TURN, wrap } from "./frame"

const X = new Vector3(1, 0, 0),
  Y = new Vector3(0, 1, 0)
const COMMIT = 0.12 // s before it lands from which a foot's landing spot no longer changes
const APART = 0.08 // m the feet stay apart side by side at the least, for a body whose pelvis stands 0.98 m over its soles
const LANDING = 600 // how firmly the point a foot lands on is drawn onto its spot as it touches down: far over the pelvis's 100

/** A foot as the planner has it this frame. */
export interface Foot {
  readonly side: Side
  /** Its sole point (`soleL` or `soleR`). */
  readonly sole: Object3D
  /** The point of it held on the ground while it is planted: the heel as it lands, the ball as it rolls off. */
  readonly groundPoint: Object3D
  /** Whether it is on the ground: not swinging, and the body not in the air. */
  readonly planted: boolean
  /** Where it is on the ground (m, world), or the point over the ground its swing has reached. */
  readonly position: Vector3
  /** While it swings: when it lands (s of the planner's `time`) and where (m, world). */
  readonly landing?: { time: number; position: Vector3 }
}

type Swing = { start: number; end: number; to: Vector3; yawTo: number; fixed: boolean; asked: boolean; tipped: number; land: number }

/** A foot and how the planner moves it. */
class Step implements Foot {
  /** The suffix of its points' and bones' names, and +1 left or -1 right. */
  readonly suffix: "L" | "R"
  readonly sign: number
  readonly sole: Object3D
  readonly heel: Object3D
  readonly ball: Object3D
  groundPoint: Object3D
  readonly position: Vector3
  /** Where its point on the ground is held. */
  readonly pin: Vector3
  /** How far the foot is tipped: toes down (+) or up (-), rad. */
  pitch = 0
  yaw: number
  /** Its place on the ground beside the pelvis this frame. */
  beside = new Vector3()
  swing?: Swing
  readonly place = new Target()
  readonly turn = new Target()
  /** Where the point it lands on is to touch down: what the foot is drawn onto as it comes to land. */
  readonly touchdown = new Target()

  readonly #airborne: () => boolean

  constructor(
    body: Humanoid,
    readonly side: Side,
    yaw: number,
    airborne: () => boolean,
  ) {
    this.suffix = side === "left" ? "L" : "R"
    this.sign = side === "left" ? 1 : -1
    this.sole = body.get("sole" + this.suffix)
    this.heel = body.get("heel" + this.suffix)
    this.ball = this.groundPoint = body.get("ball" + this.suffix)
    this.pin = body.positionOf(this.ball)
    this.position = body.positionOf(this.sole)
    this.yaw = yaw
    this.#airborne = airborne
  }

  get planted() {
    return !this.swing && !this.#airborne()
  }
  get landing() {
    return this.swing && { time: this.swing.end, position: this.swing.to.clone() }
  }
  /** Where a point of the foot is from its sole point, along the foot, with the foot flat. */
  along(point: Object3D) {
    return forward(this.yaw).multiplyScalar(point.position.z - this.sole.position.z)
  }
}

/** The two feet: they take turns to swing and stand, and give the goals that keep them so. */
export class Feet {
  readonly left: Step
  readonly right: Step
  readonly #body: Humanoid
  readonly #measures: Measures
  readonly #acceleration: number
  readonly #gravity: number
  readonly #stepHeight: number
  readonly #asked = new Map<Side, { position: Vector3; yaw: number; time: number }>()
  #last: Side = "right"
  #latest: Motion | undefined
  #ground: number
  /** In the air (a jump or a fall): committed until the ground is back. */
  air: { since: number; fall: number } | undefined
  /** When the second foot left the ground in a run. */
  flight = 0

  constructor(body: Humanoid, measures: Measures, { acceleration, gravity, stepHeight }: { acceleration: number; gravity: number; stepHeight: number }) {
    this.#body = body
    this.#measures = measures
    this.#acceleration = acceleration
    this.#gravity = gravity
    this.#stepHeight = stepHeight
    const ahead = new Vector3(0, 0, 1).applyQuaternion(body.quaternionOf(body.root)) // it starts as the body stands
    const yaw = Math.atan2(ahead.x, ahead.z),
      airborne = () => !!this.air
    this.left = new Step(body, "left", yaw, airborne)
    this.right = new Step(body, "right", yaw, airborne)
    this.#ground = this.left.position.y
  }

  get both() {
    return [this.left, this.right]
  }

  /** See `LocomotionPlanner.plant`. */
  plant(side: Side, position: Vector3, inSeconds: number, yaw: number, now: number): boolean {
    const f = this[side]
    const there = !f.swing && flat(f.position).distanceTo(flat(position)) < 0.03
    const free = (f.swing ? f.swing.end - now : 0) + SWING / 2 // it finishes the step it is in, then needs one more
    const far = this.#latest ? flat(predict(this.#latest, inSeconds, this.#acceleration).position.sub(position)).length() : 0
    if (this.air || (!there && inSeconds < free) || far > this.#measures.limit + this.#measures.hip) return false
    this.#asked.set(side, { position: position.clone(), yaw, time: now + inSeconds })
    return true
  }

  /** One frame: on the ground the feet roll, land and take off; in the air they hang. Returns how fast the body fell (m/s) if it lands this frame, else 0. */
  step(frame: Frame): number {
    this.#latest = frame.motion
    for (const f of this.both) f.beside = this.#home(f, flat(frame.p), frame.facing)
    if (!frame.grounded) {
      this.#fly(frame)
      return 0
    }
    return this.#stand(frame)
  }

  /** A foot's place beside a point on the ground, for a body facing `yaw`. */
  #home(f: Step, at: Vector3, yaw: number) {
    return at.clone().addScaledVector(leftOf(yaw), this.#measures.hip * f.sign)
  }

  /** A foot in the air hangs from the pelvis: it turns with the body, about it, and by a share k towards a yaw of its own. */
  #carry(frame: Frame, f: Step, to: number, k: number) {
    const { p, faced, facing } = frame
    const own = wrap(f.yaw - faced),
      around = flat(f.position)
        .sub(flat(p))
        .applyAxisAngle(Y, facing - faced)
    f.position.set(p.x + around.x, f.position.y, p.z + around.z)
    f.yaw = facing + clamp(own + (wrap(to - facing) - own) * k, -0.6, 0.6) // no further than the hip turns
  }

  /**
   * Puts a spot for a foot on the ground, at the height there: pulled back towards the body off anything the body
   * cannot climb, then nudged until heel and ball stand on the same level as it (the tread of a stair).
   */
  #settle(frame: Frame, f: Step, at: Vector3) {
    const { p, motion } = frame
    const floor = (x: Vector3) => motion.groundHeight?.(x) ?? p.y
    const beside = flat(p), // where the body is, there is ground it stands on
      climbable = (x: Vector3) => floor(x) <= p.y + this.#stepHeight
    for (let k = 0; motion.groundHeight && k < 8; k++) {
      const toes = at.clone().add(f.along(f.ball)),
        heel = at.clone().add(f.along(f.heel))
      if (!climbable(at) || !climbable(toes) || !climbable(heel)) {
        at.lerp(beside.setY(at.y), k < 7 ? 0.3 : 1) // not onto what takes a jump to get on: the foot stays this side of it
        continue
      }
      const [ahead, behind] = [toes, heel].map((x) => floor(x) - floor(at))
      if (Math.abs(ahead) < 0.03 && Math.abs(behind) < 0.03) break
      at.addScaledVector(forward(f.yaw), ahead < -0.03 && behind > -0.03 ? -0.04 : 0.04) // back off an edge under the toes; otherwise on, past the edge
    }
    return at.setY(floor(at))
  }

  /** In the air: nothing is planted. The feet come under the body, fold, and stretch for the predicted landing. */
  #fly(frame: Frame) {
    const { dt, t, p, v, motion, facing } = frame
    const air = (this.air ??= { since: t, fall: 0 })
    air.fall = -motion.velocity.y
    const vy = motion.velocity.y,
      left = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * this.#gravity * (p.y - this.#ground)))) / this.#gravity
    const fold = 0.05 * smoothstep(4 * Math.min(t - air.since, left), 0, 1) // the legs hang nearly stretched
    for (const f of this.both) {
      f.swing = undefined
      f.groundPoint = f.ball
      f.pitch += (0.7 * clamp(left / 0.15, 0, 1) - f.pitch) * (1 - Math.exp(-15 * dt)) // toes pointed, until the ground comes
      this.#carry(frame, f, facing, 1 - Math.exp(-8 * dt))
      f.position
        .addScaledVector(v, dt)
        .lerp(f.beside, 1 - Math.exp(-8 * dt))
        .setY(p.y + fold - 0.13 * this.#measures.size * f.pitch) // pointed toes reach below where the soles would be: the body is stretched
    }
  }

  /** On the ground: a landing from the air, the planted feet rolling, the swinging feet landing, and a foot taking off. */
  #stand(frame: Frame): number {
    this.#ground = frame.p.y
    let fall = 0
    if (this.air) {
      // landed: both feet stay where they touch down, the knees take the fall
      for (const f of this.both) f.pin.copy(this.#settle(frame, f, f.position)).add(f.along(f.groundPoint))
      fall = this.air.fall
      this.air = undefined
    }
    const landed = new Set<Step>()
    for (const f of this.both) {
      if (!f.swing) this.#roll(frame, f)
      else if (this.#swing(frame, f, f.swing)) landed.add(f)
    }
    for (const [side, a] of this.#asked) if (a.time < frame.t) this.#asked.delete(side) // done or missed: the foot is free again
    this.#takeoff(frame, landed)
    return fall
  }

  /** Planted: it rolls from the heel it landed on to flat, then up onto the ball as the pelvis leaves it behind. */
  #roll(frame: Frame, f: Step) {
    const { dt, v } = frame
    const behind = f.beside.clone().sub(flat(f.position)).dot(forward(f.yaw)),
      moving = clamp(v.dot(forward(f.yaw)) / 0.6, 0, 1)
    const tip =
      f.groundPoint === f.heel
        ? Math.min(0, -0.3 * moving * clamp(-behind / this.#measures.reachAhead, 0, 1))
        : moving * clamp((behind - 0.08 * this.#measures.size) * 3, 0, 0.9)
    f.pitch += clamp(Math.max(tip, f.groundPoint === f.ball ? 0.7 * frame.pushed : tip) - f.pitch, -9 * dt, 9 * dt) // and up onto the toes to jump
    if (f.groundPoint === f.heel && Math.abs(f.pitch) < 0.02 && (behind > 0 || moving < 0.5)) {
      f.groundPoint = f.ball // flat: from here the ball carries it, where it is
      f.pin.copy(this.#body.positionOf(f.ball).setY(f.position.y))
    }
  }

  /** A swinging foot moves on towards its landing spot, which follows the prediction until it is committed. Returns whether it lands this frame. */
  #swing(frame: Frame, f: Step, s: Swing): boolean {
    const { dt, t, facing, aim } = frame
    const span = s.end - s.start,
      x0 = swung((t - dt - s.start) / span),
      x1 = swung((t - s.start) / span)
    const then = predict(frame.believed, s.end - t, this.#acceleration),
      yaw = facing + clamp(wrap(aim - facing), -TURN * (s.end - t), TURN * (s.end - t)),
      below = this.#home(f, then.position, yaw)
    if (!s.fixed) {
      // the future that is not committed yet: the spot is where the pelvis will pass over it mid-stance
      s.to = below.clone().addScaledVector(then.velocity.clone().normalize(), this.#measures.reach(frame, then.velocity.length()))
      s.yawTo = yaw
      this.#besideOther(f, s)
      s.fixed = s.end - t < COMMIT
    }
    s.to.sub(below).setY(0).clampLength(0, this.#measures.limit).add(below) // committed or asked for, it still lands where the leg will reach
    this.#settle(frame, f, s.to)
    const k = t < s.end - 1e-9 ? (x1 - x0) / (1 - x0) : 1 // the share of the way left that this frame covers
    this.#carry(frame, f, s.yawTo, k)
    f.position.lerp(s.to, k)
    // Tipped as it left the ground, toes down through the swing (the heel comes up behind), and as it will land.
    const x = clamp((t - s.start) / span, 0, 1)
    f.pitch = s.tipped * (1 - x) ** 2 + Math.min(1.3, 0.3 + 0.25 * frame.pace) * Math.sin(Math.PI * x) * (1 - x) + s.land * x * x
    const away = flat(f.position).sub(f.beside), // a foot in the air stays within the leg's reach of the body
      most = 1.3 * this.#measures.limit
    if (k < 1 && away.length() > most) f.position.sub(away.setLength(away.length() - most))
    if (t < s.end - 1e-9) return false
    if (s.asked) this.#asked.delete(f.side)
    f.swing = undefined
    f.groundPoint = f.pitch < -0.05 ? f.heel : f.ball
    f.pin.copy(f.position).add(f.along(f.groundPoint))
    // planted where it touches down, if that is near its spot: the leg does not jump the last few millimetres
    const touched = this.#body.positionOf(f.groundPoint).setY(f.pin.y)
    if (touched.distanceTo(f.pin) < 0.02) f.pin.copy(touched)
    return true
  }

  /** A foot lands on its own side of the other one, however the body moves: stepping sideways, the trailing foot comes
   * up beside the planted leading one and never crosses over it, nor does a foot swing through the other leg to get there. */
  #besideOther(f: Step, s: Swing) {
    const other = f === this.left ? this.right : this.left,
      side = leftOf(s.yawTo).multiplyScalar(f.sign)
    // both in the air, as in a run, the other's spot is still to come; turning on the spot, its sides are turning too
    if (other.swing || Math.abs(wrap(other.yaw - s.yawTo)) > 0.6) return
    const apart = s.to.clone().sub(other.position).setY(0).dot(side)
    if (apart < APART * this.#measures.size) s.to.addScaledVector(side, APART * this.#measures.size - apart)
  }

  /** Whether a planted foot has to leave, and if one does, its swing: at most one foot takes off in a frame. */
  #takeoff(frame: Frame, landed: Set<Step>) {
    const { t, v, speed, going, crouch, run, airtime } = frame,
      { limit } = this.#measures,
      reach = this.#measures.reach(frame, speed)
    // `off` is how far a foot is from its place beside the pelvis, with some room ahead: the pelvis is coming.
    // `far` is the same without the room: what the leg has to span.
    const ahead = (f: Step) => (going ? flat(f.position).sub(f.beside).dot(going) : 0)
    const off = (f: Step) => {
      const d = flat(f.position).sub(f.beside)
      const turned = 0.2 * Math.abs(wrap(f.yaw - frame.facing)) // a foot turned away from where the body faces counts as off, too
      return turned + (going ? d.addScaledVector(going, -clamp(d.dot(going), 0, 0.12)).length() : d.length())
    }
    const far = (f: Step) => flat(f.position).distanceTo(f.beside)
    const planted = this.both.filter((f) => !f.swing).sort((a, b) => off(b) - off(a) + (a.side === this.#last ? 0.05 : -0.05))
    const stranded = going && this.both.every((f) => !f.swing && ahead(f) < 0.02) // nothing ahead to step onto
    for (const f of planted) {
      if (landed.has(f)) continue // a foot that lands stands, at least this frame
      const a = this.#asked.get(f.side),
        due = a && a.time - t <= SWING && flat(f.position).distanceTo(flat(a.position)) > 0.03
      const lone = planted.length < 2 // the other foot is in the air
      if (a && !due && a.time - t < 2 * SWING && far(f) < limit) continue // it is asked to be somewhere soon: it waits, while the leg can
      // Both feet leave the ground only at a run: slower, the leg stretches further before the second one goes.
      // And a leg is only that long up on the ball of the foot, which it is when the body leaves along the foot.
      const end1 = limit * (1 - 0.3 * crouch) * (1.3 - 0.3 * clamp((speed - 1.3) / 0.7, 0, 1)) * (0.83 + 0.17 * clamp(v.dot(forward(f.yaw)) / 0.6, 0, 1))
      if (!due && !(lone ? far(f) > end1 : off(f) > Math.max(0.08, 1.25 * reach) || stranded)) continue
      // Left and right take turns evenly: a foot that leaves too soon after the other stays in the air until half a
      // stride after the other lands. Without this a run that was disturbed keeps its limp.
      const other = f === this.left ? this.right : this.left,
        half = (airtime + (reach + limit) / Math.max(1, speed)) / 2
      const land = Math.min(t + 1.5 * airtime, Math.max(t + airtime * (0.6 + 0.4 * Math.min(1, speed)), other.swing && run > 0.3 ? other.swing.end + half : 0))
      f.swing = {
        start: t,
        end: due ? Math.max(t + 0.15, a.time) : land,
        to: due ? this.#settle(frame, f, a.position.clone()) : f.position.clone(),
        yawTo: due ? a.yaw : f.yaw,
        fixed: !!due,
        asked: !!due,
        tipped: f.pitch,
        land: -0.3 * (1 - run) * Math.min(1, speed), // a walk lands on the heel, toes up
      }
      f.groundPoint = f.ball
      this.#last = f.side
      if (lone) this.flight = t
      return
    }
  }

  /** A planted foot is held hard at its point on the ground; one in the air is a soft goal over the ground, and over a step. */
  goals(frame: Frame, f: Step): Goal[] {
    const { t, pace, run } = frame,
      s = f.swing,
      lifted = s || this.air
    f.turn.set({ quaternion: new Quaternion().setFromAxisAngle(Y, f.yaw).multiply(new Quaternion().setFromAxisAngle(X, f.pitch)) })
    const x = s ? (t - s.start) / (s.end - s.start) : 0
    const turn = soft(f.sole, f.turn, lifted ? 1 + 9 * (s ? smoothstep(x, 0.7, 1) : 0) : 10) // as firm as planted by the time it lands
    if (!lifted) return [hard(f.groundPoint, f.place.set({ position: f.pin })), turn]
    const up = s ? 1.72 * Math.sin(Math.PI * x) * (1 - x) : 0 // highest behind the body (the heel comes up), low as it comes forward to land
    // toes up, the ball is as much higher as the heel is to come down first
    const over = (0.07 + 0.015 * Math.min(6, pace) + 0.16 * run) * this.#measures.size + (s ? Math.abs(s.to.y - f.position.y) : 0)
    const rise = over * up + Math.max(0, -Math.sin(f.pitch)) * this.#measures.length
    f.place.set({
      position: f.position
        .clone()
        .add(f.along(f.ball))
        .add(new Vector3(0, rise, 0)),
    })
    if (!s) return [soft(f.ball, f.place, 30), turn]
    // Coming to land, the point it lands on is drawn onto its spot ever more firmly, so that it is there when it is
    // planted there: else the leg, short of the soft goal, snaps to the hard one in the frame it lands.
    const lands = s.land < -0.05 ? f.heel : f.ball,
      firm = LANDING * smoothstep(x, 0.7, 1)
    if (lands === f.ball) return [soft(f.ball, f.place, 30 + firm), turn]
    f.touchdown.set({ position: f.position.clone().add(f.along(f.heel)) })
    return [soft(f.ball, f.place, 30), ...(firm > 0 ? [soft(f.heel, f.touchdown, firm)] : []), turn]
  }
}

// How far a swing has come at x in [0, 1]: it lands at rest, but leaves fast enough that the foot never falls behind the body.
const swung = (x: number) => 0.7 * smoothstep(x, 0, 1) + 0.3 * (1 - (1 - Math.min(1, Math.max(0, x))) ** 2)
