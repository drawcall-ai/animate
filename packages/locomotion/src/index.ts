// LOCOMOTION: one planner for a humanoid on its feet. Each frame it is told where the body should be and how it
// moves (a physics capsule, say) and returns this frame's goals for the solver. There are no gaits in here:
//  - a planted foot stays where it is (the only HARD goals) until the pelvis has travelled past it, then swings to
//    land ahead of where the pelvis will be. Walking, both feet are down for a while; above about 2 m/s the pelvis
//    outruns the planted foot before the other has landed, and that is the flight phase of a run. Stopping, turning
//    on the spot and turning around are the same rule with another velocity.
//  - a foot rolls: in a walk it lands on the heel, comes down flat, and leaves over the ball with the heel up. What
//    is planted is that one point of it, so nothing slides while the rest of the foot turns about it.
//  - the pelvis is a strong SOFT goal on the given position, so where the legs cannot reach it gives, not the feet.
//    It carries the weight of the gait: over the standing leg in a walk, down into the stance and up through the
//    flight in a run, leaning with speed and into every acceleration.
//  - the rest is posture read off the feet: the chest turns and tilts against the pelvis, the arms swing against
//    the legs.

import { type Body, type Goal, ease, hard, soft, Target } from "@drawcall/ik"
import { type Object3D, Quaternion, Vector3 } from "three"

const X = new Vector3(1, 0, 0),
  Y = new Vector3(0, 1, 0)
// Lengths in metres, for a body whose pelvis stands 0.98 m over its soles.
const HEIGHT = 0.94 // pelvis above the ground when standing
const HIP = 0.09 // m, a foot's place beside the middle
const REACH = 0.3 // m a foot lands ahead of the pelvis in a walk at 1 m/s and above (less when slower, crouched or running)
const LIMIT = 0.48 // m behind the pelvis at which a leg is at its end, up on the ball of the foot: it leaves the ground even with the other in the air
const SWING = 0.4 // s a foot is in the air in a walk; a run takes up to 0.1 s longer
const COMMIT = 0.12 // s before it lands from which a foot's landing spot no longer changes
const TURN = 10 // rad/s the body turns to face where it goes
const TWIST = 0.8 // rad the pelvis can be turned from a planted foot: turning further takes a step
const WINDUP = 0.22 // s of going down before a jump
const PUSH = 0.1 // s of stretching up onto the toes, at the end of which it leaves the ground

export type Side = "L" | "R"
/** Parts of the body someone else can take: the planner then emits no goals for them. */
export type Part = "armL" | "armR" | "head" | "trunk"
const BONES: Record<Part, string[]> = {
  armL: ["shoulderL", "upperArmL", "forearmL", "handL"],
  armR: ["shoulderR", "upperArmR", "forearmR", "handR"],
  head: ["neck", "head"],
  trunk: ["spine", "chest"],
}

/** What the body should follow this frame. Only the position and velocity are needed. */
export interface Motion {
  /** The point on the ground under the body (the feet of a capsule), in the world. */
  position: Vector3
  velocity: Vector3
  /** The velocity the input asks for: the planner predicts that the velocity turns into it. Default: the velocity. */
  desired?: Vector3
  /** False while the body is in the air. */
  grounded?: boolean
  /** 0 standing to 1 fully crouched: lower pelvis, shorter steps. */
  crouch?: number
  /** Yaw (rad about Y, 0 = +Z) to face. Default: where it goes. */
  facing?: number
  /** How high the ground is under a point (a ray cast down): each foot stands on what is under it. Default: level with the position. */
  ground?: (at: Vector3) => number
  taken?: Part[]
}

interface Foot {
  S: Side
  side: number
  sole: Object3D
  heel: Object3D
  ball: Object3D
  /** The point of the foot that is on the ground (the heel or the ball), and where it is held. */
  on: Object3D
  pin: Vector3
  /** How far the foot is tipped: toes down (+) or up (-), rad. */
  pitch: number
  place: Target
  turn: Target
  /** Where it is on the ground (planted), or the point on the ground its swing has reached. */
  at: Vector3
  yaw: number
  swing?: { start: number; end: number; to: Vector3; yawTo: number; fixed: boolean; asked: boolean; tipped: number; land: number }
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const wrap = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI))
const flat = (v: Vector3) => new Vector3(v.x, 0, v.z)
const forward = (yaw: number) => new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
const leftOf = (yaw: number) => new Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
// How far a swing has come at x in [0, 1]: it lands at rest, but leaves fast enough that the foot never falls behind the body.
const swung = (x: number) => 0.7 * ease(x) + 0.3 * (1 - (1 - Math.min(1, Math.max(0, x))) ** 2)

/**
 * `acceleration` (m/s^2) is how fast the velocity turns into the desired one, `gravity` how a body in the air falls:
 * both are only used to predict. `climb` (m) is how high a step the body gets up without jumping (a capsule's step
 * height): no foot is put on anything higher above the position than that.
 */
export function createLocomotion(body: Body, { acceleration = 35, gravity = 9.81, climb = 0.3 } = {}) {
  const pelvis = new Target()
  // The lengths above are for a body whose pelvis stands 0.98 m over its soles: this body's are in proportion.
  const size = (body.positionOf(body.root).y - body.positionOf(body.get("soleL")).y) / 0.98
  const height = HEIGHT * size,
    hip = HIP * size,
    reachAhead = REACH * size,
    limit = LIMIT * size
  const ahead = new Vector3(0, 0, 1).applyQuaternion(body.rotationOf(body.root)) // it starts as the body stands
  const feet: Foot[] = (["L", "R"] as const).map((S) => {
    const sole = body.get("sole" + S),
      ball = body.get("ball" + S)
    return { S, side: S === "L" ? 1 : -1, sole, heel: body.get("heel" + S), ball, on: ball, pin: body.positionOf(ball), pitch: 0, place: new Target(), turn: new Target(), at: body.positionOf(sole), yaw: Math.atan2(ahead.x, ahead.z) } // prettier-ignore
  })
  /** Where a point of the foot is from its sole point, along the foot, with the foot flat. */
  const along = (f: Foot, point: Object3D) => forward(f.yaw).multiplyScalar(point.position.z - f.sole.position.z)
  const length = feet[0].ball.position.z - feet[0].heel.position.z
  const dofs = (name: string) => body.chain(body.get(name)).slice(-(body.get(name).userData.hinges as unknown[]).length)
  const asked = new Map<Side, { position: Vector3; yaw: number; time: number }>()
  const was = new Vector3(), // the velocity a frame ago, and the acceleration read off it
    push = new Vector3()
  let t = 0,
    pace = 0, // the speed, smoothed: how the body carries itself changes over a few steps, not in a frame
    facing = feet[0].yaw,
    ground = feet[0].at.y,
    last: Side = "R",
    air: { since: number; fall: number } | undefined, // in the air: committed until the ground is back
    flight = 0, // when the second foot left the ground in a run
    squat = 0, // m the pelvis is down from bending the knees: a spring, pushed by a landing and by the windup of a jump
    squatSpeed = 0,
    bob = 0, // m the pelvis is up or down with the step
    sway = 0, // which leg the body is over, -1..1
    spin = 0, // rad/s it turns: all three smoothed
    held = 0, // s the velocity has not been turning into the desired one: something is in the way
    arms = 0, // -1 swung back for a jump .. 1 thrown up with it, smoothed
    windup: { start: number; launch: () => void } | undefined
  let latest: Motion | undefined

  /** Where the body will be `s` seconds from now if the velocity turns into the desired one. */
  const predict = (m: Motion, s: number) => {
    const v = flat(m.velocity),
      change = flat(m.desired ?? m.velocity).sub(v),
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

  return {
    feet,
    /** Seconds the planner has run. */
    get time() {
      return t
    },
    /** Whether the body is in the air (a jump or a fall, not the flight phase of a run). */
    get airborne() {
      return !!air
    },
    /**
     * Jump: the body goes down, arms back, then stretches up onto its toes and throws the arms up; at the end of that
     * `launch` is called, which must send the body up (a capsule's jump). In the air the legs hang stretched, toes
     * pointed; they reach for the ground before it comes and the knees take the landing.
     * From there to the landing the planner is committed: it follows the body through the air and lands on both feet.
     */
    jump(launch: () => void) {
      if (!air && !windup) windup = { start: t, launch }
    },
    /**
     * Ask for a foot to be planted at a place `within` seconds from now, turned to `yaw`. Returns whether that fits:
     * the foot can be free and get there in time, and the place is under where the body will be. If not, nothing changes.
     */
    plant(S: Side, position: Vector3, within: number, yaw = facing): boolean {
      const f = feet.find((x) => x.S === S)!
      const there = !f.swing && flat(f.at).distanceTo(flat(position)) < 0.03
      const free = (f.swing ? f.swing.end - t : 0) + SWING / 2 // it finishes the step it is in, then needs one more
      const far = latest ? flat(predict(latest, within).position.sub(position)).length() : 0
      if (air || (!there && within < free) || far > limit + hip) return false
      asked.set(S, { position: position.clone(), yaw, time: t + within })
      return true
    },

    /** One frame: follow `motion`, step the feet, and return this frame's goals. */
    step(dt: number, motion: Motion): Goal[] {
      t += dt
      latest = motion
      const p = motion.position,
        v = flat(motion.velocity),
        speed = v.length(),
        want = flat(motion.desired ?? motion.velocity)
      const crouch = clamp(motion.crouch ?? 0, 0, 1),
        grounded = motion.grounded ?? true
      const aim = motion.facing ?? (want.length() > 0.3 ? Math.atan2(want.x, want.z) : facing)
      const faced = facing
      facing += clamp(wrap(aim - facing), -TURN * dt, TURN * dt)
      for (const f of feet) if (!f.swing && !air) facing = f.yaw + clamp(wrap(facing - f.yaw), -TWIST, TWIST)
      // A foot in the air hangs from the pelvis: it turns with the body, about it, and by a share k towards a yaw of its own.
      const carry = (f: Foot, to: number, k: number) => {
        const own = wrap(f.yaw - faced),
          around = flat(f.at)
            .sub(flat(motion.position))
            .applyAxisAngle(Y, facing - faced)
        f.at.set(motion.position.x + around.x, f.at.y, motion.position.z + around.z)
        f.yaw = facing + clamp(own + (wrap(to - facing) - own) * k, -0.6, 0.6) // no further than the hip turns
      }
      if (dt > 0) push.lerp(v.clone().sub(was).divideScalar(dt), 1 - Math.exp(-dt / 0.15))
      // Held back (a wall, say): the velocity does not turn into the desired one. Then it is the velocity that is believed.
      held = want.distanceTo(v) > 0.3 && v.distanceTo(was) < 0.2 * acceleration * dt ? held + dt : 0
      const believed: Motion = held > 0.15 ? { ...motion, desired: motion.velocity } : motion
      was.copy(v)
      pace += (speed - pace) * (1 - Math.exp(-dt / 0.2))
      const run = ease((pace - 1.8) / 1.5) // 0 walking, 1 running
      // A runner lands nearly under himself and takes longer strides through the air.
      const reach = (speed: number) => reachAhead * (1 - 0.4 * crouch) * Math.min(1, speed) * (1 - 0.45 * run)
      const airtime = SWING + 0.1 * run
      const home = (f: Foot, at: Vector3, yaw: number) => at.clone().addScaledVector(leftOf(yaw), hip * f.side)
      const floor = (at: Vector3) => motion.ground?.(at) ?? p.y
      // A jump being wound up: how far down it has gone (0..1), then how far it has stretched up again (0..1).
      const down = windup ? ease((t - windup.start) / WINDUP) : 0,
        pushed = windup ? ease((t - windup.start - WINDUP) / PUSH) : 0
      /**
       * Puts a spot for a foot on the ground, at the height there: pulled back towards the body off anything the body
       * cannot climb, then nudged until heel and ball stand on the same level as it (the tread of a stair).
       */
      const settle = (f: Foot, at: Vector3) => {
        const beside = flat(p), // where the body is, there is ground it stands on
          climbable = (x: Vector3) => floor(x) <= p.y + climb
        for (let k = 0; motion.ground && k < 8; k++) {
          const toes = at.clone().add(along(f, f.ball)),
            heel = at.clone().add(along(f, f.heel))
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

      if (!grounded) {
        // In the air: nothing is planted. The feet come under the body, fold, and stretch for the predicted landing.
        air ??= { since: t, fall: 0 }
        air.fall = -motion.velocity.y
        const vy = motion.velocity.y,
          left = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * gravity * (p.y - ground)))) / gravity
        const fold = 0.05 * ease(4 * Math.min(t - air.since, left)) // the legs hang nearly stretched
        for (const f of feet) {
          f.swing = undefined
          f.on = f.ball
          f.pitch += (0.7 * clamp(left / 0.15, 0, 1) - f.pitch) * (1 - Math.exp(-15 * dt)) // toes pointed, until the ground comes
          carry(f, facing, 1 - Math.exp(-8 * dt))
          f.at
            .addScaledVector(v, dt)
            .lerp(home(f, p, facing), 1 - Math.exp(-8 * dt))
            .setY(p.y + fold - 0.13 * size * f.pitch) // pointed toes reach below where the soles would be: the body is stretched
        }
      } else {
        ground = p.y
        const landed = new Set<Foot>()
        if (air) {
          // landed: both feet stay where they touch down, the knees take the fall
          for (const f of feet) f.pin.copy(settle(f, f.at)).add(along(f, f.on))
          squatSpeed += 1.4 * air.fall
          air = undefined
        }
        for (const f of feet) {
          const s = f.swing
          if (!s) {
            // Planted: it rolls from the heel it landed on to flat, then up onto the ball as the pelvis leaves it behind.
            const behind = home(f, flat(p), facing).sub(flat(f.at)).dot(forward(f.yaw)),
              moving = clamp(v.dot(forward(f.yaw)) / 0.6, 0, 1)
            const want = f.on === f.heel ? Math.min(0, -0.3 * moving * clamp(-behind / reachAhead, 0, 1)) : moving * clamp((behind - 0.08 * size) * 3, 0, 0.9)
            f.pitch += clamp(Math.max(want, f.on === f.ball ? 0.7 * pushed : want) - f.pitch, -9 * dt, 9 * dt) // and up onto the toes to jump
            if (f.on === f.heel && Math.abs(f.pitch) < 0.02 && (behind > 0 || moving < 0.5)) {
              f.on = f.ball // flat: from here the ball carries it, where it is
              f.pin.copy(body.positionOf(f.ball).setY(f.at.y))
            }
            continue
          }
          const span = s.end - s.start,
            x0 = swung((t - dt - s.start) / span),
            x1 = swung((t - s.start) / span)
          const then = predict(believed, s.end - t),
            yaw = facing + clamp(wrap(aim - facing), -TURN * (s.end - t), TURN * (s.end - t)),
            below = home(f, then.position, yaw)
          if (!s.fixed) {
            // the future that is not committed yet: the spot is where the pelvis will pass over it mid-stance
            s.to = below.clone().addScaledVector(then.velocity.clone().normalize(), reach(then.velocity.length()))
            s.yawTo = yaw
            s.fixed = s.end - t < COMMIT
          }
          s.to.sub(below).setY(0).clampLength(0, limit).add(below) // committed or asked for, it still lands where the leg will reach
          settle(f, s.to)
          const k = t < s.end - 1e-9 ? (x1 - x0) / (1 - x0) : 1 // the share of the way left that this frame covers
          carry(f, s.yawTo, k)
          f.at.lerp(s.to, k)
          // Tipped as it left the ground, toes down through the swing (the heel comes up behind), and as it will land.
          const x = clamp((t - s.start) / span, 0, 1)
          f.pitch = s.tipped * (1 - x) ** 2 + Math.min(1.3, 0.3 + 0.25 * pace) * Math.sin(Math.PI * x) * (1 - x) + s.land * x * x
          const away = flat(f.at).sub(home(f, flat(p), facing)) // a foot in the air stays within the leg's reach of the body
          if (k < 1 && away.length() > 1.3 * limit) f.at.sub(away.setLength(away.length() - 1.3 * limit))
          if (t < s.end - 1e-9) continue
          if (s.asked) asked.delete(f.S)
          f.swing = undefined
          landed.add(f)
          f.on = f.pitch < -0.05 ? f.heel : f.ball
          f.pin.copy(f.at).add(along(f, f.on))
        }
        for (const [S, a] of asked) if (a.time < t) asked.delete(S) // done or missed: the foot is free again

        // Does a planted foot have to leave? `off` is how far it is from its place beside the pelvis, with some room ahead:
        // the pelvis is coming. `far` is the same without the room: what the leg has to span.
        const going = speed > 0.1 ? v.clone().normalize() : undefined
        const ahead = (f: Foot) =>
          going
            ? flat(f.at)
                .sub(home(f, flat(p), facing))
                .dot(going)
            : 0
        const off = (f: Foot) => {
          const d = flat(f.at).sub(home(f, flat(p), facing))
          const turned = 0.2 * Math.abs(wrap(f.yaw - facing)) // a foot turned away from where the body faces counts as off, too
          return turned + (going ? d.addScaledVector(going, -clamp(d.dot(going), 0, 0.12)).length() : d.length())
        }
        const far = (f: Foot) => flat(f.at).distanceTo(home(f, flat(p), facing))
        const planted = feet.filter((f) => !f.swing).sort((a, b) => off(b) - off(a) + (a.S === last ? 0.05 : -0.05))
        const stranded = going && feet.every((f) => !f.swing && ahead(f) < 0.02) // nothing ahead to step onto
        for (const f of planted) {
          if (landed.has(f)) continue // a foot that lands stands, at least this frame
          const a = asked.get(f.S),
            due = a && a.time - t <= SWING && flat(f.at).distanceTo(flat(a.position)) > 0.03
          const lone = planted.length < 2 // the other foot is in the air
          if (a && !due && a.time - t < 2 * SWING && far(f) < limit) continue // it is asked to be somewhere soon: it waits, while the leg can
          // Both feet leave the ground only at a run: slower, the leg stretches further before the second one goes.
          // And a leg is only that long up on the ball of the foot, which it is when the body leaves along the foot.
          const end1 = limit * (1 - 0.3 * crouch) * (1.3 - 0.3 * clamp((speed - 1.3) / 0.7, 0, 1)) * (0.83 + 0.17 * clamp(v.dot(forward(f.yaw)) / 0.6, 0, 1))
          if (!due && !(lone ? far(f) > end1 : off(f) > Math.max(0.08, 1.25 * reach(speed)) || stranded)) continue
          // Left and right take turns evenly: a foot that leaves too soon after the other stays in the air until half a
          // stride after the other lands. Without this a run that was disturbed keeps its limp.
          const other = feet.find((x) => x !== f)!,
            half = (airtime + (reach(speed) + limit) / Math.max(1, speed)) / 2
          const land = Math.min(
            t + 1.5 * airtime,
            Math.max(t + airtime * (0.6 + 0.4 * Math.min(1, speed)), other.swing && run > 0.3 ? other.swing.end + half : 0),
          )
          const end = due ? Math.max(t + 0.15, a.time) : land
          f.swing = {
            start: t,
            end,
            to: due ? settle(f, a.position.clone()) : f.at.clone(),
            yawTo: due ? a.yaw : f.yaw,
            fixed: !!due,
            asked: !!due,
            tipped: f.pitch,
            land: -0.3 * (1 - run) * Math.min(1, speed), // a walk lands on the heel, toes up
          }
          f.on = f.ball
          last = f.S
          if (lone) flight = t
          break
        }
      }

      // The spring in the knees.
      if (windup) {
        squat = (0.28 * down * (1 - pushed) - 0.05 * pushed) * size // down, then up past standing: it is on its toes
        squatSpeed = 0
      } else {
        squatSpeed += (64 * ((air ? -0.04 * size : 0) - squat) - 16 * squatSpeed) * dt // stretched in the air
        squat = clamp(squat + squatSpeed * dt, -0.05, 0.35)
      }
      // The arms go back as it goes down, are thrown up as it stretches and rises, and come down as it falls.
      arms += ((windup ? 2 * pushed - down : air ? clamp(motion.velocity.y / 3, -0.3, 1) : 0) - arms) * (1 - Math.exp(-dt / 0.07))
      if (windup && t >= windup.start + WINDUP + PUSH) {
        windup.launch()
        windup = undefined
      }

      const goals: Goal[] = []
      const lifted = feet.filter((f) => f.swing)
      for (const f of feet) {
        const s = f.swing,
          x = s ? (t - s.start) / (s.end - s.start) : 0,
          up = s ? 1.72 * Math.sin(Math.PI * x) * (1 - x) : 0 // highest behind the body (the heel comes up), low as it comes forward to land
        if (s || air) {
          // over the ground and over a step; toes up, the ball is as much higher as the heel is to come down first
          const over = (0.07 + 0.015 * Math.min(6, pace) + 0.16 * run) * size + (s ? Math.abs(s.to.y - f.at.y) : 0)
          f.place.set({
            position: f.at
              .clone()
              .add(along(f, f.ball))
              .add(new Vector3(0, over * up + Math.max(0, -Math.sin(f.pitch)) * length, 0)),
          })
          goals.push(soft(f.ball, f.place, 30))
        } else goals.push(hard(f.on, f.place.set({ position: f.pin })))
        f.turn.set({ quaternion: new Quaternion().setFromAxisAngle(Y, f.yaw).multiply(new Quaternion().setFromAxisAngle(X, f.pitch)) })
        goals.push(soft(f.sole, f.turn, s || air ? 1 : 10))
      }

      // The pelvis follows the body, over the ground its feet are on, and carries the gait. Up and down: in a walk
      // it rides over the standing leg and is lowest with both feet down; in a run it sinks into the stance and rises
      // through the flight. Sideways: over the standing leg, that hip higher. It turns with the stride and leans with
      // the speed and into every acceleration.
      const stance = lifted.length === 1 && !air ? feet.find((f) => !f.swing)! : undefined
      const going = speed > 0.1 ? v.clone().normalize() : undefined
      const phase =
        stance && going
          ? clamp(
              (reach(speed) -
                flat(stance.at)
                  .sub(home(stance, flat(p), facing))
                  .dot(going)) /
                (reach(speed) + limit),
              0,
              1,
            )
          : 0
      const step = Math.min(1, speed) * Math.sin(Math.PI * phase) * size
      bob += ((stance ? (0.035 * (1 - run) - 0.07 * run) * step : lifted.length ? 0 : -0.012 * Math.min(1, speed) * size) - bob) * (1 - Math.exp(-dt / 0.05))
      sway += ((stance ? stance.side * Math.min(1, speed) : 0) - sway) * (1 - Math.exp(-dt / 0.12)) // -1..1: which leg it stands on
      const list = sway * (0.12 - 0.02 * run) // rad the pelvis tilts, the standing leg's hip up
      spin += ((dt > 0 ? wrap(facing - faced) / dt : 0) - spin) * (1 - Math.exp(-dt / 0.15))
      const hop =
        grounded && lifted.length === 2 ? clamp((gravity / 2) * (t - flight) * (Math.min(...lifted.map((f) => f.swing!.end)) - t), 0, 0.06 * size) * run : 0 // a run's flight, not a jump
      const stride = clamp(feet[0].at.clone().sub(feet[1].at).dot(forward(facing)) / size, -1, 1) // + with the left foot ahead
      const lean = push
        .clone()
        .multiplyScalar(0.03)
        .clampLength(0, 0.3)
        .addScaledVector(v, 0.025)
        .addScaledVector(leftOf(facing), clamp(0.012 * spin * speed, -0.3, 0.3)) // it banks into a turn
        .addScaledVector(forward(facing), 0.2 * crouch)
        .clampLength(0, 0.45)
      const bow = lean.dot(forward(facing)) + 1.5 * Math.max(0, squat) // how much of the lean is forward, and it bows as the knees bend: the trunk takes a share of it
      pelvis.set({
        position: new Vector3(p.x, (air ? p.y : (feet[0].at.y + feet[1].at.y) / 2) + height - 0.3 * crouch - 0.05 * Math.min(1, pace / 3) - squat + hop + bob, p.z).addScaledVector(leftOf(facing), sway * (0.035 - 0.02 * run) * size), // prettier-ignore
        quaternion: new Quaternion()
          .setFromAxisAngle(new Vector3().crossVectors(Y, lean).normalize(), 0.65 * lean.length())
          .multiply(new Quaternion().setFromAxisAngle(Y, facing - (0.25 + 0.1 * run) * stride))
          .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), list)),
      })
      goals.push(soft(body.root, pelvis, 100))

      // Posture: the chest turns and tilts against the pelvis and takes its share of the lean, the head stays level,
      // the arms swing against the legs with the elbows bent more the faster it goes.
      const swing = (0.6 + 0.15 * run) * stride,
        nod = -0.5 * (bow + 0.3 * crouch)
      const pose: Record<string, number[]> = {
        spine: [0.3 * crouch + 0.2 * bow, (0.2 + 0.05 * run) * stride, -0.6 * list],
        chest: [0.15 * bow, (0.25 + 0.1 * run) * stride, -0.7 * list], // the shoulders tilt against the hips
        neck: [nod / 2, -0.1 * stride, 0],
        head: [nod / 2, -0.1 * stride, 0],
      }
      for (const [S, side] of [
        ["L", 1],
        ["R", -1],
      ] as const) {
        pose["upperArm" + S] = [side * swing - 0.15 * run - (arms > 0 ? 1.5 : 0.8) * arms, side * (0.1 + 0.1 * run + 0.25 * Math.abs(arms)), 0]
        pose["forearm" + S] = [-0.25 - 1.25 * run - 0.15 * Math.max(0, -side * swing) - 0.4 * Math.abs(arms), 0]
      }
      const joints = body.pose(pose),
        weights = joints.map((_, k) => (k < 6 ? 0 : 1)) // the root is the pelvis goal's business
      for (const part of motion.taken ?? []) for (const name of BONES[part]) for (const k of dofs(name)) weights[k] = 0
      goals.push({ joints, weights, weight: 0.1 })
      return goals
    },
  }
}
