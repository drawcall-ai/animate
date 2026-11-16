// Headless numeric proof for the soldier example. `pnpm test` prints the numbers.
import { createHumanoid, solve, upright } from '@drawcall/ik'
import { Vector3 } from 'three'
import { afterAll, expect, test } from 'vitest'
import { createSoldier } from '../src/soldier'
import { createWalker, makeWalk } from '../src/walk'

const DT = 1 / 60
const report: string[] = []
const say = (s: string) => report.push(s)
const e = (x: number) => x.toExponential(2)
afterAll(() => console.log('\n' + report.join('\n') + '\n'))

test('walking while aiming a two-handed rifle at a fixed world target', () => {
  const aim = new Vector3(1.5, 1.3, 14), walk = makeWalk(t => 0.6 * Math.sin(0.8 * t))
  const { body, rifle, plan } = createSoldier(() => aim.clone(), () => 1, walk)
  const grips = (['L', 'R'] as const).map(S => [body.get('palm' + S), rifle.getObjectByName('grip' + S)!])
  const spine = body.chain(body.get('spine')), chest = body.chain(body.get('chest'))
  let ang = 0, gp = 0, offLo = 9, offHi = -9, twLo = 9, twHi = -9, side = 0, hardMiss = 0, dq = 0, its = 0, unconverged = 0, frames = 0
  let prev = body.q.slice()
  for (let t = 0; t <= 8 + 1e-9; t += DT, frames++) {
    const goals = plan(t), r = solve(body, goals, DT)
    if (frames) body.q.forEach((v, i) => (dq = Math.max(dq, Math.abs(v - prev[i]))))
    prev = body.q.slice()
    r.goals.forEach((g, i) => { const goal = goals[i]; if ('a' in goal && goal.hard) hardMiss = Math.max(hardMiss, g.missedBy) })
    its += r.iterations; if (!r.converged) unconverged++
    const barrel = new Vector3(0, 0, 1).applyQuaternion(body.rotationOf(rifle)), muzzle = rifle.localToWorld(new Vector3(0, 0, 0.6))
    ang = Math.max(ang, barrel.angleTo(aim.clone().sub(muzzle)))
    for (const [hand, grip] of grips) gp = Math.max(gp, body.positionOf(hand).distanceTo(body.positionOf(grip)))
    const d = aim.clone().sub(body.positionOf(body.root)), fwd = new Vector3(0, 0, 1).applyQuaternion(body.rotationOf(body.root))
    const off = Math.atan2(d.x, d.z) - Math.atan2(fwd.x, fwd.z)
    offLo = Math.min(offLo, off); offHi = Math.max(offHi, off)
    const twist = body.q[spine.at(-2)!] + body.q[chest.at(-2)!]
    twLo = Math.min(twLo, twist); twHi = Math.max(twHi, twist)
    side = Math.max(side, Math.abs(body.q[spine.at(-1)!] + body.q[chest.at(-1)!]))
  }
  say(`rifle gripped by both hands, aimed at a fixed target 14 m away during an 8 s snaking walk`)
  say(`  pelvis facing vs aim direction ranges over [${offLo.toFixed(2)}, ${offHi.toFixed(2)}] rad; spine+chest twist resolves [${twLo.toFixed(2)}, ${twHi.toFixed(2)}] rad of it, side bend at most ${side.toFixed(2)} rad`)
  say(`  max angular error of the barrel from the aim line = ${e(ang)} rad; max grip error = ${e(gp)} m`)
  say(`  hard goals (pelvis, feet, rifle pose) missed by at most ${e(hardMiss)}`)
  say(`  max frame-to-frame joint change = ${dq.toFixed(4)} rad; ${(its / frames).toFixed(1)} iterations/frame, unconverged frames ${unconverged}`)
  expect(ang).toBeLessThan(1e-7); expect(gp).toBeLessThan(1e-9); expect(hardMiss).toBeLessThan(1e-9)
  expect(offHi - offLo).toBeGreaterThan(0.8)

  // The arm swing is a soft goal the walk planner emits only when told the arms are free.
  const empty = createHumanoid(), walker = createWalker(empty, walk)
  let lo = 9, hi = -9
  for (let t = 0; t <= 4; t += DT) {
    solve(empty, walker(t, upright(empty), true), DT)
    const z = empty.root.worldToLocal(empty.positionOf(empty.get('fistL'))).z
    lo = Math.min(lo, z); hi = Math.max(hi, z)
  }
  say(`  with empty hands the walk planner emits the arm swing: the left hand swings ${(100 * (hi - lo)).toFixed(0)} cm fore-aft`)
  expect(hi - lo).toBeGreaterThan(0.2)
})

test('lowering the rifle to the chest marker and raising it again keeps both grips exact', () => {
  let on = true, since = -9
  const aiming = (t: number) => { const x = Math.min(1, Math.max(0, (t - since) / 0.4)); return on ? x : 1 - x }
  const { body, rifle, plan } = createSoldier(() => new Vector3(1.5, 1.3, 14), aiming)
  let gp = 0, hardMiss = 0, unconverged = 0, dq = 0, frames = 0, prev = body.q.slice()
  for (let t = 0; t <= 6 + 1e-9; t += DT, frames++) {
    if (t >= 2 && on && since < 0) { on = false; since = t } // lower at t = 2 s
    if (t >= 4 && !on) { on = true; since = t } // raise again at t = 4 s
    const goals = plan(t), r = solve(body, goals, DT)
    if (frames) body.q.forEach((v, i) => (dq = Math.max(dq, Math.abs(v - prev[i]))))
    prev = body.q.slice()
    r.goals.forEach((g, i) => { const goal = goals[i]; if ('a' in goal && goal.hard) hardMiss = Math.max(hardMiss, g.missedBy) })
    if (!r.converged) unconverged++
    for (const S of ['L', 'R']) gp = Math.max(gp, body.positionOf(body.get('palm' + S)).distanceTo(body.positionOf(rifle.getObjectByName('grip' + S)!)))
  }
  say(`  lowering (to the chest marker) and raising again, 0.4 s each: max grip error ${e(gp)} m; hard goals missed by at most ${e(hardMiss)}; max frame-to-frame joint change ${dq.toFixed(3)} rad; unconverged frames ${unconverged}`)
  expect(gp).toBeLessThan(1e-9); expect(hardMiss).toBeLessThan(1e-9); expect(unconverged).toBe(0)
})
