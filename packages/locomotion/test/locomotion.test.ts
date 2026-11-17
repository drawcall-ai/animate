// Headless numbers for the planner alone: the body follows a point that turns its velocity into the desired one.
import { Humanoid } from "@drawcall/humanoid"
import { type Goal, solve } from "@drawcall/ik"
import { Vector3 } from "three"
import { afterAll, expect, test } from "vitest"
import { LocomotionPlanner, type Motion } from "../src"

const DT = 1 / 60,
  ACCELERATION = 35
const report: string[] = []
const say = (s: string) => report.push(s)
afterAll(() => console.log("\n" + report.join("\n") + "\n"))

/** A body, its planner and the point it follows; `run` steps it and measures. */
function scene(stepHeight?: number) {
  const body = new Humanoid(),
    planner = new LocomotionPlanner(body, { acceleration: ACCELERATION, stepHeight })
  const motion: Motion & { desiredVelocity: Vector3 } = { position: new Vector3(), velocity: new Vector3(), desiredVelocity: new Vector3() }
  const m = { track: 0, trackMax: 0, slide: 0, dq: 0, frames: 0, steps: 0, flight: 0, travelled: 0, dip: 0 }
  const feet = Object.values(planner.feet)
  const planted = feet.map((f) => ({ was: false, at: new Vector3(), on: f.groundPoint }))
  let before = body.angles.slice()
  const run = (seconds: number, each?: (goals: Goal[]) => void) => {
    for (let k = 0; k < Math.round(seconds / DT); k++) {
      motion.velocity.add(
        motion.desiredVelocity
          .clone()
          .sub(motion.velocity)
          .clampLength(0, ACCELERATION * DT),
      )
      motion.position.addScaledVector(motion.velocity, DT)
      const goals = planner.update(DT, motion)
      solve(body, goals, DT)
      const p = body.positionOf(body.root),
        error = Math.hypot(p.x - motion.position.x, p.z - motion.position.z)
      m.track += error
      m.trackMax = Math.max(m.trackMax, error)
      m.dip = Math.max(m.dip, motion.position.y + 0.94 - p.y)
      m.travelled += motion.velocity.length() * DT
      feet.forEach((f, i) => {
        const at = body.positionOf(f.groundPoint) // the point of the foot that is on the ground: the heel, then the ball
        if (f.planted && planted[i].was && planted[i].on === f.groundPoint) m.slide = Math.max(m.slide, at.distanceTo(planted[i].at))
        if (f.planted && !planted[i].was) m.steps++
        planted[i] = { was: f.planted, at, on: f.groundPoint }
      })
      if (feet.every((f) => f.landing)) m.flight++
      body.angles.forEach((q, j) => j > 5 && (m.dq = Math.max(m.dq, Math.abs(q - before[j]))))
      before = body.angles.slice()
      m.frames++
      each?.(goals)
    }
  }
  const reset = () => Object.assign(m, { track: 0, trackMax: 0, slide: 0, dq: 0, frames: 0, steps: 0, flight: 0, travelled: 0, dip: 0 })
  return { body, planner, motion, m, run, reset }
}

test("one planner from a stroll to a sprint: the flight phase appears with speed", () => {
  say("speed   step length  cadence      in flight  pelvis off (mean / max)  foot slide  joint change")
  for (const speed of [0.7, 1.4, 2.5, 3.5, 6]) {
    const { motion, m, run, reset } = scene()
    motion.desiredVelocity.set(0, 0, speed)
    run(2)
    reset()
    run(4)
    say(
      `${speed.toFixed(1)} m/s  ${(m.travelled / m.steps).toFixed(2)} m       ${((60 * m.steps) / 4).toFixed(0)} steps/min  ${((100 * m.flight) / m.frames).toFixed(0).padStart(2)} %       ${((100 * m.track) / m.frames).toFixed(1)} / ${(100 * m.trackMax).toFixed(1)} cm           ${m.slide.toExponential(1)} m   ${m.dq.toFixed(2)} rad`,
    )
    expect(m.slide).toBeLessThan(1e-6)
    if (speed < 1.5) expect(m.flight).toBe(0)
    if (speed > 3) expect(m.flight).toBeGreaterThan(0)
  }
})

test("commitment: a foot in the air lands when it was going to, and where from 0.12 s before", () => {
  const { planner, motion, run } = scene()
  motion.desiredVelocity.set(0, 0, 3.5)
  run(2)
  const landing = () => Object.values(planner.feet).find((x) => x.landing && x.landing.time - planner.time < 0.1)
  let f = landing()
  while (!f?.landing) {
    run(DT)
    f = landing()
  }
  const { time: end, position: spot } = f.landing
  motion.desiredVelocity.set(0, 0, -3.5) // the input turns around with the foot 0.1 s from the ground
  while (f.landing) run(DT)
  say(
    `turning around 0.1 s before a foot lands: it lands ${(1000 * Math.abs(planner.time - end)).toFixed(0)} ms off its time and ${f.position.distanceTo(spot).toExponential(1)} m off its spot`,
  )
  expect(Math.abs(planner.time - end)).toBeLessThan(DT)
  expect(f.position.distanceTo(spot)).toBeLessThan(1e-9)
})

test("a foot asked to be planted at a place by a time is, or the planner says it cannot", () => {
  const { body, planner, motion, run } = scene()
  motion.desiredVelocity.set(0, 0, 1.4)
  run(2)
  const ahead = (metres: number, side = 0.09) => motion.position.clone().add(new Vector3(side, 0, metres))
  const spot = ahead(1.4 * 0.7 + 0.2)
  const fits = planner.plant("left", spot, 0.7)
  const late = planner.plant("right", ahead(0.3, -0.09), 0.05),
    far = planner.plant("right", ahead(4, -0.09), 0.7)
  run(0.7)
  const sole = body.positionOf(body.get("soleL"))
  say(
    `asked while walking: left foot 0.7 s from now at a spot ${fits ? "fits" : "does not fit"}: its sole is ${(100 * sole.distanceTo(spot)).toFixed(1)} cm from it at that time (still rolling down from the heel); asked for 0.05 s from now: ${late ? "fits" : "cannot"}; asked 3 m out of reach: ${far ? "fits" : "cannot"}`,
  )
  expect(fits).toBe(true)
  expect(planner.feet.left.position.distanceTo(spot)).toBeLessThan(1e-9) // that is where it stands; the foot is still rolling down from its heel
  expect(sole.distanceTo(spot)).toBeLessThan(0.04)
  expect(late || far).toBe(false)
})

test("parts taken by someone else get no goals", () => {
  const { body, planner, motion } = scene()
  motion.desiredVelocity.set(0, 0, 1.4)
  const arms = ["shoulder", "upperArm", "forearm", "hand"].flatMap((n) => ["L", "R"].flatMap((S) => body.dofs(body.get(n + S))))
  const weight = (taken: Motion["taken"]) => {
    const posture = planner.update(DT, { ...motion, taken }).find((g) => "weights" in g)
    return posture && "weights" in posture ? arms.reduce((sum, k) => sum + posture.weights[k], 0) : NaN
  }
  expect(weight([])).toBe(arms.length)
  expect(weight(["armL", "armR"])).toBe(0)
  say("arms taken (a rifle): the planner's goals carry weight 0 on every arm joint and no point goal on the arms")
})

test("no foot is put on what the body cannot climb", () => {
  // A 0.4 m kerb beside the way, where the left foot would come down; the body walks straight past it.
  const kerb = (at: Vector3) => (at.x > 0.05 && at.z > 1 && at.z < 2.5 ? 0.4 : 0)
  const highest = (stepHeight: number) => {
    const { body, planner, motion } = scene(stepHeight)
    motion.desiredVelocity.set(0, 0, 1.4)
    let top = 0
    for (let k = 0; k < 240; k++) {
      motion.velocity.add(
        motion.desiredVelocity
          .clone()
          .sub(motion.velocity)
          .clampLength(0, ACCELERATION * DT),
      )
      motion.position.addScaledVector(motion.velocity, DT)
      solve(body, planner.update(DT, { ...motion, groundHeight: kerb }), DT)
      for (const f of Object.values(planner.feet)) if (!f.landing) top = Math.max(top, f.position.y)
    }
    return top
  }
  const free = highest(Infinity),
    held = highest(0.3)
  say(
    `walking past a 0.4 m kerb under the left foot's way: told the body climbs anything, a foot is planted ${(100 * free).toFixed(0)} cm up on it; told it climbs 0.3 m, the highest foot stands at ${(100 * held).toFixed(0)} cm`,
  )
  expect(free).toBeGreaterThan(0.39)
  expect(held).toBeLessThan(0.01)
})

test("held back by a wall with the input still pushing, it stands instead of stepping out ahead", () => {
  const { planner, motion, run, m, reset } = scene()
  motion.desiredVelocity.set(0, 0, 3.5)
  run(1.5)
  const stop = planner.time
  // from here the point does not move, whatever is desired
  motion.position.z = Math.round(motion.position.z * 100) / 100
  reset()
  let last = stop,
    ahead = 0
  for (let k = 0; k < 120; k++) {
    motion.velocity.set(0, 0, 0)
    planner.update(DT, motion)
    if (Object.values(planner.feet).some((f) => f.landing)) last = planner.time
    if (k > 60) for (const f of Object.values(planner.feet)) ahead = Math.max(ahead, f.position.z - motion.position.z)
  }
  say(
    `stopped dead by a wall from 3.5 m/s with the input still pushing: the last foot is down ${(last - stop).toFixed(2)} s later, and no foot is more than ${(100 * ahead).toFixed(0)} cm ahead of the body after that`,
  )
  expect(last - stop).toBeLessThan(1)
  expect(ahead).toBeLessThan(0.1)
  void m
})
