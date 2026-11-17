// Headless numeric proof for the soldier example. `pnpm test` prints the numbers.
import { MUZZLE } from "@drawcall/example-stage/rifle"
import { CachedSoldierLoader } from "@drawcall/example-stage/soldier"
import { describeGrip, solve } from "@drawcall/animate"
import { Vector3 } from "three"
import { afterAll, expect, test } from "vitest"
import { createSoldierPlanner, type SoldierPlanner } from "../src/soldier"

const DT = 1 / 60
const report: string[] = []
const say = (s: string) => report.push(s)
const e = (x: number) => x.toExponential(2)
afterAll(() => console.log("\n" + report.join("\n") + "\n"))

/** how far each hand bone is from where its grip seats it on the rifle (m) */
const gripError = ({ body, seats }: SoldierPlanner) =>
  Math.max(...(["right", "left"] as const).map((side) => body.positionOf(body.hands[side].bone).distanceTo(body.positionOf(seats[side]))))
/** the largest change of any joint since `before` (rad) */
const change = (q: number[], before: number[]) => Math.max(...q.map((v, i) => (i > 2 ? Math.abs(v - before[i]) : 0)))
const yaw = (v: Vector3) => Math.atan2(v.x, v.z)
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

test("both hands close round the rifle: the right round the pistol grip with the index on the trigger, the left round the handguard", async () => {
  const { grips } = createSoldierPlanner((await new CachedSoldierLoader().loadAsync()).object, () => new Vector3(0, 1.3, 14))
  const pistol = describeGrip(grips.pistol),
    right = describeGrip(grips.right),
    left = describeGrip(grips.left)
  say("the right hand round the pistol grip\n" + pistol.replace(/^/gm, "  "))
  say("and then its index on the trigger\n" + right.replace(/^/gm, "  "))
  say("the left hand on the handguard\n" + left.replace(/^/gm, "  "))
  for (const text of [pistol, right, left]) expect(text).not.toMatch(/free|straight/)
  expect(grips.right.missedBy).toBeLessThan(0.01)
})

// The locomotion planner faces him toward the aim and the snaking path turns under him: he walks partly sideways, as a soldier
// aiming does, rather than turning his pelvis away from the aim and twisting back with the trunk.
test("walking a snaking path while aiming a two-handed rifle at a fixed world target", async () => {
  const aim = new Vector3(1.5, 1.3, 14),
    soldier = createSoldierPlanner((await new CachedSoldierLoader().loadAsync()).object, () => aim.clone())
  const { body, rifle } = soldier
  let ang = 0,
    gp = 0,
    loop = 0,
    sideLo = 9,
    sideHi = -9,
    facing = 0,
    hardMiss = 0,
    dq = 0,
    its = 0,
    unconverged = 0,
    frames = 0,
    prev = body.angles.slice()
  for (let t = DT; t <= 8 + 1e-9; t += DT, frames++) {
    const goals = soldier.update(DT),
      r = solve(body, goals, DT)
    if (frames > 1) dq = Math.max(dq, change(body.angles, prev))
    prev = body.angles.slice()
    hardMiss = Math.max(hardMiss, r.hardMissedBy)
    its += r.iterations
    if (!r.converged) unconverged++
    const barrel = new Vector3(0, 0, -1).applyQuaternion(body.quaternionOf(rifle)),
      muzzle = rifle.localToWorld(MUZZLE.clone())
    ang = Math.max(ang, barrel.angleTo(aim.clone().sub(muzzle)))
    gp = Math.max(gp, gripError(soldier))
    loop = Math.max(loop, r.loopsMissedBy)
    const at = body.positionOf(body.root),
      faces = yaw(new Vector3(0, 0, 1).applyQuaternion(body.quaternionOf(body.root))),
      toAim = yaw(aim.clone().sub(at))
    if (t > 1) facing = Math.max(facing, Math.abs(wrap(faces - toAim)))
    const moving = body.velocityOf(body.root).setY(0)
    if (moving.length() > 0.4) {
      const side = wrap(yaw(moving) - faces)
      sideLo = Math.min(sideLo, side)
      sideHi = Math.max(sideHi, side)
    }
  }
  say(`rifle gripped by both hands, aimed at a fixed target 14 m away during an 8 s snaking walk planned by the locomotion planner`)
  say(
    `  he walks [${sideLo.toFixed(2)}, ${sideHi.toFixed(2)}] rad off where his pelvis faces; after the first second his pelvis faces within ${facing.toFixed(2)} rad of the aim`,
  )
  say(`  max angular error of the barrel from the aim line = ${e(ang)} rad; max grip error = ${e(gp)} m (the left hand's loop ${e(loop)})`)
  say(`  hard goals (planted feet, rifle pose) missed by at most ${e(hardMiss)}`)
  say(
    `  max frame-to-frame joint change = ${dq.toFixed(4)} rad after the first frame; ${(its / frames).toFixed(1)} iterations/frame, unconverged frames ${unconverged}`,
  )
  expect(ang).toBeLessThan(1e-7)
  expect(gp).toBeLessThan(1e-9)
  expect(hardMiss).toBeLessThan(1e-9)
  expect(sideHi - sideLo).toBeGreaterThan(0.8)
})

test("lowering the rifle to low ready and raising it again keeps both grips exact", async () => {
  let on = true,
    since = -9
  const aiming = (t: number) => {
    const x = Math.min(1, Math.max(0, (t - since) / 0.4))
    return on ? x : 1 - x
  }
  const soldier = createSoldierPlanner((await new CachedSoldierLoader().loadAsync()).object, () => new Vector3(1.5, 1.3, 14), aiming),
    { body } = soldier
  let gp = 0,
    hardMiss = 0,
    unconverged = 0,
    dq = 0,
    frames = 0,
    prev = body.angles.slice()
  for (let t = DT; t <= 6 + 1e-9; t += DT, frames++) {
    if (t >= 2 && on && since < 0) {
      on = false
      since = t
    } // lower at t = 2 s
    if (t >= 4 && !on) {
      on = true
      since = t
    } // raise again at t = 4 s
    const goals = soldier.update(DT),
      r = solve(body, goals, DT)
    if (frames > 1) dq = Math.max(dq, change(body.angles, prev))
    prev = body.angles.slice()
    hardMiss = Math.max(hardMiss, r.hardMissedBy)
    if (!r.converged) unconverged++
    gp = Math.max(gp, gripError(soldier))
  }
  say(
    `  lowering (to low ready) and raising again, 0.4 s each: max grip error ${e(gp)} m; hard goals missed by at most ${e(hardMiss)}; max frame-to-frame joint change ${dq.toFixed(3)} rad after the first frame; unconverged frames ${unconverged}`,
  )
  expect(gp).toBeLessThan(1e-9)
  expect(hardMiss).toBeLessThan(1e-9)
  expect(unconverged).toBe(0)
})
