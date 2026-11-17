// Headless numeric proof for the tennis example. `pnpm test` prints the numbers.
import { CachedPlayerLoader } from "@drawcall/example-stage/player"
import { describeGrip, solve } from "@drawcall/animate"
import { Bone, Quaternion, Vector3 } from "three"
import { afterAll, expect, test } from "vitest"
import { createStrokePlanner, STROKES } from "../src/strokes"

const DT = 1 / 60
const report: string[] = []
const say = (s: string) => report.push(s)
const e = (x: number) => x.toExponential(2)
afterAll(() => console.log("\n" + report.join("\n") + "\n"))

test("forehand, two-handed backhand and serve: the sweet spot meets the ball exactly, smoothly", async () => {
  for (const stroke of STROKES) {
    let moved: Vector3 | null = null
    const s = createStrokePlanner(stroke, (await new CachedPlayerLoader().loadAsync()).object, () => (moved ?? s.nominal).clone()),
      { body, goalsAt, sweet } = s
    const bones: Bone[] = []
    body.root.traverse((o) => {
      if (o instanceof Bone) bones.push(o)
    })
    const turns = () => bones.map((b) => b.getWorldQuaternion(new Quaternion()))
    let hard = 0,
      grip = 0,
      rot = 0,
      its = 0,
      unconverged = 0,
      frames = 0,
      prev = turns()
    for (let t = 0; t <= 2 * stroke.period + 1e-9; t += DT, frames++) {
      // two repetitions
      const goals = goalsAt(t),
        r = solve(body, goals, DT)
      hard = Math.max(hard, r.hardMissedBy)
      grip = Math.max(grip, r.loopsMissedBy)
      its += r.iterations
      if (!r.converged) unconverged++
      const now = turns()
      if (frames) now.forEach((q, i) => (rot = Math.max(rot, q.angleTo(prev[i]))))
      prev = now
    }
    // exactly at the contact time: the sweet spot is on the ball and the strings face where they should
    const at = (t: number) => {
      solve(body, goalsAt(t), DT)
      return sweet.getWorldPosition(new Vector3())
    }
    for (let t = stroke.contact - 0.2; t < stroke.contact - DT; t += DT) at(t)
    const before = at(stroke.contact - DT),
      r = solve(body, goalsAt(stroke.contact), DT)
    const hit = sweet.getWorldPosition(new Vector3()).distanceTo(s.ball(stroke.contact)),
      strings = r.goals[5].missedBy
    const speed = at(stroke.contact + DT).distanceTo(before) / (2 * DT)
    // a ball 12 cm away from the planned contact point is still met exactly
    moved = s.nominal.clone().add(new Vector3(0.08, 0.06, -0.07))
    for (let t = stroke.contact - 0.5; t < stroke.contact - DT / 2; t += DT) solve(body, goalsAt(t), DT)
    solve(body, goalsAt(stroke.contact), DT)
    const hit2 = sweet.getWorldPosition(new Vector3()).distanceTo(moved)
    for (const [side, held] of Object.entries(s.grips)) say(`${stroke.name}: the ${side} hand on the racket\n` + describeGrip(held).replace(/^/gm, "  "))
    if (s.toss) say(`${stroke.name}: the left hand on the ball, until it lets go\n` + describeGrip(s.toss).replace(/^/gm, "  "))
    say(`${stroke.name}: hard goals (feet, pelvis, racket hand and sweet spot) off by at most ${e(hard)} over the whole stroke`)
    say(`  at contact the sweet spot is ${e(hit)} m from the ball, the strings ${strings.toFixed(3)} rad off; racket head speed ${speed.toFixed(1)} m/s`)
    say(`  ball moved 12 cm: still met to ${e(hit2)} m`)
    if (stroke.twoHanded) say(`  both hands on the racket: second hand's grip off by at most ${e(grip)}`)
    say(
      `  smoothness: no body part turns more than ${rot.toFixed(2)} rad in a frame; ${(its / frames).toFixed(1)} iterations/frame, unconverged frames ${unconverged} of ${frames}`,
    )
    expect(hard).toBeLessThan(1e-6)
    expect(hit).toBeLessThan(1e-9)
    expect(hit2).toBeLessThan(1e-9)
    expect(strings).toBeLessThan(0.02)
    expect(rot).toBeLessThan(0.8)
    expect(unconverged).toBeLessThan(3)
  }
})
