// Headless numbers for the controller example: a scripted input drives the physics capsule through every kind of
// movement, and the body is measured against it. `pnpm test` prints the table and writes filmstrips to test/film.
import { CachedSoldierLoader } from "@drawcall/example-stage/soldier"
import { describeGrip } from "@drawcall/animate"
import { mkdirSync, writeFileSync } from "node:fs"
import { Vector3 } from "three"
import { afterAll, expect, test } from "vitest"
import { type Input, createCharacter } from "../src/character"
import { film } from "./film"

const DT = 1 / 60
const report: string[] = []
const say = (s: string) => report.push(s)
afterAll(() => console.log("\n" + report.join("\n") + "\n"))
const cm = (x: number) => (100 * x).toFixed(1)

const HEADER = [
  "                       pelvis off the capsule  foot slide  joint change  solve     ",
  "                       (mean / max)            (planted)   (max/frame)   (mean)",
]

/** A character on its capsule, an input to script, and `run`, which plays the input for a while and measures. */
async function session() {
  const character = await createCharacter((await new CachedSoldierLoader().loadAsync()).object)
  const { capsule, controller, body, locomotion, carry, ground, frame } = character
  const sides = Object.values(locomotion.feet)
  const input: Input = { move: new Vector3(), pace: "walk", crouch: false, jump: false, rifle: false }
  const feet = sides.map((f) => ({ down: false, at: new Vector3(), on: f.groundPoint }))
  let before = body.angles.slice(),
    t = 0
  const strips = new Map<string, ReturnType<typeof film>>()
  const total = { ms: 0, msMax: 0, frames: 0, slide: 0, unconverged: 0 }

  /** Run `seconds` of the current input and measure. `every` takes a film shot each so many frames, 14 of them, from frame `from`. */
  const run = (name: string, seconds: number, every = 0, each?: (k: number) => void, from = 0) => {
    const m = { track: 0, trackMax: 0, slide: 0, dq: 0, joint: "", ms: 0, frames: 0, steps: 0, flight: 0 }
    const along = input.move.lengthSq()
      ? input.move.clone().normalize()
      : new Vector3(0, 0, 1).applyQuaternion(body.quaternionOf(body.root)).setY(0).normalize() // seen from the side
    for (let k = 0; k < Math.round(seconds / DT); k++, t += DT) {
      each?.(k)
      const { result, solveMs } = frame(DT, input)
      input.jump = false
      const p = body.positionOf(body.root)
      const error = Math.hypot(p.x - capsule.position.x, p.z - capsule.position.z)
      m.track += error
      m.trackMax = Math.max(m.trackMax, error)
      sides.forEach((f, i) => {
        const at = body.positionOf(f.groundPoint) // the point of the foot that is on the ground: the heel, then the ball
        if (f.planted && feet[i].down && feet[i].on === f.groundPoint) m.slide = Math.max(m.slide, at.distanceTo(feet[i].at))
        if (f.planted && !feet[i].down) m.steps++
        feet[i] = { down: f.planted, at, on: f.groundPoint }
      })
      if (sides.every((f) => f.landing) || locomotion.airborne) m.flight++
      body.angles.forEach(
        (q, j) => j > 5 && Math.abs(q - before[j]) > m.dq && ((m.dq = Math.abs(q - before[j])), (m.joint = `${body.angleName(j)} at ${t.toFixed(2)} s`)),
      )
      before = body.angles.slice()
      m.ms += solveMs
      total.msMax = Math.max(total.msMax, solveMs)
      if (!result.converged) total.unconverged++
      m.frames++
      if (every && k >= from && (k - from) % every === 0 && k < from + 14 * every) {
        const strip = strips.get(name) ?? film(body)
        strips.set(name, strip)
        strip.shot(
          `${t.toFixed(2)} s`,
          capsule.position,
          along,
          feet.map((f) => f.down),
        )
      }
    }
    total.ms += m.ms
    total.frames += m.frames
    total.slide = Math.max(total.slide, m.slide)
    say(
      `${name.padEnd(22)} ${cm(m.track / m.frames).padStart(5)} / ${cm(m.trackMax).padStart(5)} cm   ${m.slide.toExponential(0)} m   ${m.dq.toFixed(2)} rad   ${(m.ms / m.frames).toFixed(2)} ms   ${String(m.steps).padStart(2)} steps, ${((100 * m.flight) / m.frames).toFixed(0)}% in the air   (${m.joint})`,
    )
    return m
  }

  const finish = () => {
    say(
      `all ${total.frames} frames: solve ${(total.ms / total.frames).toFixed(2)} ms mean, ${total.msMax.toFixed(1)} ms max; unconverged ${total.unconverged}; worst foot slide ${total.slide.toExponential(1)} m\n`,
    )
    mkdirSync(new URL("./film", import.meta.url), { recursive: true })
    for (const [name, strip] of strips) writeFileSync(new URL(`./film/${name.replace(/[^a-z0-9]+/gi, "-")}.svg`, import.meta.url), strip.svg())
    expect(total.slide).toBeLessThan(1e-6)
  }
  return { capsule, controller, body, locomotion, sides, carry, ground, input, run, finish, now: () => t }
}

test("walk, run, sprint, turn around, crouch, jump and the rifle on one physics capsule", async () => {
  const { capsule, controller, body, locomotion, sides, carry, input, run, finish, now } = await session()
  HEADER.forEach(say)
  run("stand", 0.5)
  input.move.set(0, 0, 1)
  run("walk 1.4 m/s", 4, 5, undefined, 120)
  input.pace = "run"
  run("run 3.5 m/s", 4, 3, undefined, 120)
  input.pace = "sprint"
  run("sprint 6 m/s", 3, 2, undefined, 120)

  // Turn around at a sprint: the input flips, the capsule brakes at 35 m/s^2 and is back at speed 0.34 s later.
  input.move.set(0, 0, -1)
  const flip = now(),
    events: string[] = []
  let stopped = false,
    faced = false
  const swinging = sides.map((f) => !!f.landing)
  run("turn around", 1.5, 4, () => {
    const since = (1000 * (now() - flip)).toFixed(0)
    sides.forEach((f, i) => {
      if (!f.landing && swinging[i])
        events.push(
          `${since} ms: the ${f.side} foot lands ${cm(f.position.z - capsule.position.z)} cm ${f.position.z > capsule.position.z ? "ahead (old direction)" : "behind"} of the capsule`,
        )
      swinging[i] = !!f.landing
    })
    if (!stopped && controller.velocity.z <= 0) (events.push(`${since} ms: the capsule has stopped and turns back`), (stopped = true))
    const facing = new Vector3(0, 0, 1).applyQuaternion(body.quaternionOf(body.root)).z
    if (!faced && facing < -0.9) (events.push(`${since} ms: the pelvis faces the new direction`), (faced = true))
  })
  events.slice(0, 8).forEach((e) => say("    " + e))
  expect(faced).toBe(true)

  input.move.set(0, 0, 0)
  run("stop", 1.5, 5)
  input.pace = "walk"
  input.crouch = true
  input.move.set(1, 0, 0)
  run("crouch walk 1.2 m/s", 4, 5, undefined, 120)
  input.crouch = false
  input.move.set(0, 0, 0)
  run("stand up", 1)

  // Jump on the spot, then a running jump.
  for (const [name, pace] of [
    ["standing jump", undefined],
    ["running jump", "run"],
  ] as const) {
    if (pace) {
      input.pace = pace
      input.move.set(1, 0, 0)
      run("run up", 1.5)
    }
    let apex = 0,
      off = -1,
      landed = -1,
      sole = 0
    const pressed = now()
    input.jump = true
    const m = run(name, 1.5, 6, () => {
      apex = Math.max(apex, capsule.position.y)
      if (locomotion.airborne && off < 0) off = now()
      if (!locomotion.airborne && off >= 0 && landed < 0) {
        landed = now()
        sole = Math.max(...sides.map((f) => Math.abs(body.positionOf(f.sole).y - capsule.position.y)))
      }
    })
    say(
      `    windup ${(1000 * (off - pressed)).toFixed(0)} ms, ${(landed - off).toFixed(2)} s in the air, capsule ${cm(apex)} cm high; soles ${cm(sole)} cm off the ground when it lands, then planted`,
    )
    expect(landed).toBeGreaterThan(off)
    expect(m.slide).toBeLessThan(1e-6)
  }

  // The rifle: the hands reach for it on its sling and close on it, and once they hold it it takes both arms.
  say(`the right hand round the rifle's pistol grip\n${describeGrip(carry.grips.pistol)}`.replace(/\n/g, "\n  "))
  say(`and then its index on the trigger\n${describeGrip(carry.grips.right)}`.replace(/\n/g, "\n  "))
  say(`the left hand on the rifle's handguard\n${describeGrip(carry.grips.left)}`.replace(/\n/g, "\n  "))
  input.move.set(0, 0, 0)
  run("settle", 1)
  let taken = -1
  const took = now()
  input.rifle = true
  const take = run("rifle: take it", 0.8, 4, () => void (taken < 0 && carry.held && (taken = now() - took)))
  say(`    the hands hold it ${(1000 * taken).toFixed(0)} ms after it is asked for`)
  expect(taken).toBeGreaterThan(0.3)
  input.rifle = false
  const away = run("rifle: put it away", 0.8, 4)
  expect(carry.held).toBe(false)
  expect(Math.max(take.dq, away.dq)).toBeLessThan(0.3) // the arms move there and back, no joint jumps
  input.rifle = true
  input.move.set(1, 0, 0)
  input.pace = "walk"
  run("rifle: walk", 3, 5, undefined, 90)
  input.crouch = true
  run("rifle: crouch", 3, 5, undefined, 90)
  input.crouch = false
  input.pace = "sprint"
  run("rifle: sprint", 3, 2, undefined, 90)
  input.move.set(-1, 0, 0)
  run("rifle: turn around", 1.5, 4)

  finish()
})

test("the hardest inputs: circles, left-right, 180s at a run, and a random hand on the stick", async () => {
  const { input, run, finish } = await session()
  HEADER.forEach(say)
  input.pace = "run"
  input.move.set(0, 0, 1)
  run("run up", 1)
  // A circle of 2 m radius at 3.5 m/s: the direction turns at 1.75 rad/s.
  run("run in a circle, r 2 m", 6, 4, (k) => input.move.set(Math.sin(1.75 * k * DT), 0, Math.cos(1.75 * k * DT)), 120)
  input.pace = "sprint"
  run("sprint in a circle", 6, 3, (k) => input.move.set(Math.sin(1.75 * k * DT), 0, Math.cos(1.75 * k * DT)), 120)
  // Left and right: the input flips sideways every 0.4 s, walking then running.
  for (const pace of ["walk", "run"] as const) {
    input.pace = pace
    run(`left-right, ${pace}`, 5, 4, (k) => input.move.set(Math.floor(k / 24) % 2 ? -1 : 1, 0, 0), 60)
  }
  // 180 degrees at a run, again and again, each before the last is done with.
  run("180 every 0.7 s, run", 6, 4, (k) => input.move.set(0, 0, Math.floor(k / 42) % 2 ? -1 : 1), 60)
  input.pace = "sprint"
  run("180 every 0.5 s, sprint", 6, 3, (k) => input.move.set(0, 0, Math.floor(k / 30) % 2 ? -1 : 1), 60)
  // A random hand: every 0.15 to 0.6 s a new direction, pace, crouch or stop, sometimes a jump.
  let seed = 7,
    next = 0
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  run(
    "random input, 30 s",
    30,
    6,
    (k) => {
      if (k < next) return
      next = k + Math.round(60 * (0.15 + 0.45 * random()))
      const angle = 2 * Math.PI * random()
      input.move.set(Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(random() < 0.15 ? 0 : 1)
      input.pace = (["walk", "run", "sprint"] as const)[Math.floor(3 * random())]
      input.crouch = random() < 0.15
      input.jump = random() < 0.1
    },
    600,
  )
  finish()
})

test("stairs: each foot stands on what a ray cast down finds under it", async () => {
  const { capsule, body, sides, ground, input, run, finish } = await session()
  HEADER.forEach(say)
  let apart = 0,
    top = 0
  const watch = () => {
    top = Math.max(top, capsule.position.y)
    for (const f of sides) {
      if (!f.planted) continue
      const points = ["heel", "sole", "ball"].map((name) => body.get(name + (f.side === "left" ? "L" : "R")))
      const gaps = points.map((point) => body.positionOf(point).y - ground(body.positionOf(point)))
      apart = Math.max(apart, Math.min(...gaps), -Math.min(...gaps)) // some of it stands on the ground, none of it is in it
    }
  }
  input.move.set(0, 0, -1)
  run("walk to the stairs", 3.3, 0, watch)
  run("walk up", 2.2, 5, watch)
  run("walk over and down", 5, 5, watch, 110)
  input.move.set(0, 0, 1)
  input.pace = "run"
  run("run back over them", 3.5, 3, watch, 45)
  say(`    the capsule climbed to ${cm(top)} cm; no planted foot more than ${cm(apart)} cm over or in the ground under it`)
  expect(top).toBeGreaterThan(1.3)
  expect(apart).toBeLessThan(0.03)
  finish()
})

test("no foot is put on what the capsule cannot climb", async () => {
  const { capsule, sides, input, run, finish } = await session()
  HEADER.forEach(say)
  // The block is 0.4 m high, the capsule steps up 0.32 m: it runs into it, and has to jump to get on.
  let over = 0
  const watch = () => {
    for (const f of sides) if (f.planted) over = Math.max(over, f.position.y - capsule.position.y)
  }
  input.pace = "run"
  input.move.set(0, 0, 1)
  run("run to it", 8 / 3.5)
  input.pace = "walk"
  input.move.set(-1, 0, 0)
  run("walk into the block", 7, 6, watch, 280)
  input.pace = "run"
  run("run against it", 3, 0, watch)
  say(`    pushed against the 40 cm block, no planted foot is more than ${cm(over)} cm over the ground the capsule stands on`)
  expect(capsule.position.y).toBeLessThan(0.05)
  expect(over).toBeLessThan(0.33)
  input.move.negate()
  run("back off", 1.5)
  input.move.negate()
  run("run up and jump onto it", 2.2, 6, (k) => void (input.jump ||= k === 60), 40)
  say(
    `    after a jump the capsule stands ${cm(capsule.position.y)} cm up, on the block, and so do the feet: ${sides.map((f) => cm(f.position.y)).join(" and ")} cm`,
  )
  expect(capsule.position.y).toBeGreaterThan(0.35)
  for (const f of sides) if (!f.landing) expect(f.position.y).toBeGreaterThan(0.35)
  finish()
})
