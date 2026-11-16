// Headless numeric proofs. `pnpm test` prints the numbers as a report.
import { Object3D, Quaternion, Vector3 } from 'three'
import { afterAll, expect, test } from 'vitest'
import { type Body, type Goal, createHumanoid, hard, mark, posture, soft, solve, Target, toward, upright } from '../src'

const DT = 1 / 60
const V = (x: number, y: number, z: number) => new Vector3(x, y, z)
const Y = V(0, 1, 0), FLAT = V(1, 0, 1)
const report: string[] = []
const say = (s: string) => report.push(s)
const e = (x: number) => x.toExponential(2)
afterAll(() => console.log('\n' + report.join('\n') + '\n'))

/** Standing still: both soles pinned where they are, trunk and legs upright, the centre of mass over the feet. */
function standing(body: Body): Goal[] {
  const soles = [body.get('soleL'), body.get('soleR')]
  const support = new Target().set({ position: body.positionOf(soles[0]).add(body.positionOf(soles[1])).multiplyScalar(0.5), axes: FLAT })
  return [
    ...soles.map(sole => hard(sole, new Target().set({ position: body.positionOf(sole), quaternion: body.rotationOf(sole) }))),
    posture(body, upright(body)), soft(body.centre, support),
  ]
}
/** Standing, the right hand hard on a point that `move` places each frame. */
function reach(move: (t: number, point: Target) => void) {
  const body = createHumanoid(), point = new Target(), goals = [...standing(body), hard(body.get('fistR'), point)]
  return { body, plan: (t: number) => { move(t, point); return goals } }
}

/** Step a scene over [0, T]: the plan rebuilds this frame's goals, the solver solves them. */
function run(body: Body, plan: (t: number) => Goal[], T: number, each?: (t: number, r: ReturnType<typeof solve>) => void) {
  let prev = body.q.slice(), frames = 0, its = 0, maxIts = 0, hardMiss = 0, grip = 0, dq = 0, unconverged = 0
  const t0 = performance.now()
  for (let t = 0; t <= T + 1e-9; t += DT, frames++) {
    const goals = plan(t), r = solve(body, goals, DT)
    if (frames > 0) { // frame 0 starts from the neutral pose: not a frame-to-frame change
      body.q.forEach((v, i) => (dq = Math.max(dq, Math.abs(v - prev[i]))))
      maxIts = Math.max(maxIts, r.iterations)
    }
    r.goals.forEach((g, i) => { const goal = goals[i]; if ('a' in goal && goal.hard) hardMiss = Math.max(hardMiss, g.missedBy) })
    grip = Math.max(grip, r.closureError)
    its += r.iterations; if (!r.converged) unconverged++
    each?.(t, r)
    prev = body.q.slice()
  }
  return { frames, hard: hardMiss, grip, dq, unconverged, avgIts: its / frames, maxIts, ms: (performance.now() - t0) / frames }
}
const perf = (s: ReturnType<typeof run>) => `${s.frames} frames, ${s.avgIts.toFixed(1)} Newton iterations/frame (max ${s.maxIts}), ${s.ms.toFixed(2)} ms/frame, unconverged frames ${s.unconverged}`

const moving = (t: number) => V(-0.25 + 0.2 * Math.sin(3 * t), 1.1 + 0.2 * Math.sin(2 * t), 0.4 + 0.1 * Math.cos(4 * t))

test('(a) hard hand goal on a moving point: exact every frame, zero lag', () => {
  const { body, plan } = reach((t, point) => point.set({ position: moving(t) }))
  let err = 0, lagged = 0, speed = 0
  const s = run(body, plan, 6, t => {
    const p = body.positionOf(body.get('fistR'))
    err = Math.max(err, p.distanceTo(moving(t)))
    lagged = Math.max(lagged, p.distanceTo(moving(t - DT)))
    speed = Math.max(speed, moving(t).distanceTo(moving(t - DT)) / DT)
  })
  say(`(a) moving hand target (peak speed ${speed.toFixed(2)} m/s)`)
  say(`    max |hand - target(t)|      = ${e(err)} m   <- zero lag`)
  say(`    max |hand - target(t - dt)| = ${e(lagged)} m   (what one frame of lag would look like)`)
  say(`    ${perf(s)}`)
  expect(err).toBeLessThan(1e-9)
  expect(s.unconverged).toBe(0)
})

test('(b) a box gripped by both hands, held at a marker on the chest, while the pelvis walks, bobs and turns', () => {
  const body = createHumanoid(), box = new Object3D()
  box.userData.mass = 3
  const grips = { R: mark(box, 'gripR', V(-0.175, 0, 0)), L: mark(box, 'gripL', V(0.175, 0, 0)) }
  body.attach(box, body.get('palmR'), grips.R) // carried by the right hand
  body.attach(box, body.get('palmL'), grips.L) // the left hand closes the loop
  const spot = mark(body.get('chest'), 'carry', V(0, -0.1, 0.3)) // both points of this goal are on the body
  const pelvis = new Target()
  const arms = { shoulderL: [0.3, 0.32], upperArmL: [-0.03, -0.3, -0.24], forearmL: [-1.36, 0.03], handL: [0, -0.18], shoulderR: [-0.3, -0.32], upperArmR: [-0.03, 0.3, 0.24], forearmR: [-1.36, -0.03], handR: [0, 0.18] }
  const goals = [hard(body.get('pelvis'), pelvis), soft(box, spot, 4), posture(body, { ...upright(body), ...arms })]
  const plan = (t: number) => { // a simulated walk on a circle: forward, bobbing, swaying, turning
    const a = (0.7 * t) / 2.5
    pelvis.set({ position: V(2.5 * (1 - Math.cos(a)), 0.95 + 0.02 * Math.cos(4 * Math.PI * t), 2.5 * Math.sin(a)), quaternion: new Quaternion().setFromAxisAngle(Y, a + 0.08 * Math.sin(2 * Math.PI * t)) })
    return goals
  }
  let gp = 0, gr = 0, hold = 0
  const s = run(body, plan, 8, (_t, r) => {
    for (const S of ['L', 'R'] as const) { // straight from the scene graph: each hand's frame against its grip on the box
      gp = Math.max(gp, body.positionOf(body.get('palm' + S)).distanceTo(body.positionOf(grips[S])))
      gr = Math.max(gr, body.rotationOf(body.get('palm' + S)).angleTo(body.rotationOf(grips[S])))
    }
    hold = Math.max(hold, r.goals[1].missedBy)
  })
  say(`(b) box carry, 8 s (pelvis walks 5.6 m on a curve, bobs 4 cm, yaws 2.2 rad)`)
  say(`    max grip error, both hands  = ${e(gp)} m, ${e(gr)} rad`)
  say(`    max hard error (pelvis)     = ${e(s.hard)}; loop closure ${e(s.grip)}`)
  say(`    soft 'box at the chest marker' missed by at most ${(100 * hold).toFixed(2)} cm or rad/100`)
  say(`    ${perf(s)}`)
  expect(gp).toBeLessThan(1e-9); expect(gr).toBeLessThan(1e-7); expect(s.hard).toBeLessThan(1e-9)
})

test('(c) a racket attached to the hand: hard goal on the sweet spot position and rotation', () => {
  const body = createHumanoid(), racket = new Object3D(), target = new Target()
  racket.userData.mass = 0.3
  const sweet = mark(racket, 'sweet', V(0, 0.5, 0))
  body.attach(racket, mark(body.get('handR'), 'hold', V(0, -0.08, 0), new Quaternion(0.5, 0.5, 0.5, 0.5)))
  const swing = (t: number) => {
    const a = 0.25 + 0.75 * Math.cos((2 * Math.PI * t) / 2.4)
    return { position: V(-0.3 - 0.62 * Math.sin(a), 0.92 - 0.1 * Math.cos((2 * Math.PI * t) / 2.4), 0.05 + 0.62 * Math.cos(a)), quaternion: new Quaternion().setFromAxisAngle(Y, -a).multiply(new Quaternion(0.5, 0.5, 0.5, 0.5)) }
  }
  const goals = [...standing(body), hard(sweet, target)]
  let pos = 0, rot = 0
  const s = run(body, t => { target.set(swing(t)); return goals }, 4.8, t => {
    pos = Math.max(pos, body.positionOf(sweet).distanceTo(swing(t).position))
    rot = Math.max(rot, body.rotationOf(sweet).angleTo(swing(t).quaternion))
  })
  say(`(c) racket swing (two full swings), sweet spot 0.5 m from the hand`)
  say(`    max sweet-spot position error = ${e(pos)} m, rotation error = ${e(rot)} rad`)
  say(`    ${perf(s)}`)
  expect(pos).toBeLessThan(1e-9); expect(rot).toBeLessThan(1e-7)
})

test('(d) an unreachable hard goal does not throw: closest pose, no jitter, reported', () => {
  const far = V(-0.25, 2.75, 0.2)
  const still = reach((_t, point) => point.set({ position: far }))
  const first = solve(still.body, still.plan(0), DT)
  expect(first.goals[4].reachable).toBe(false) // the hand: out of reach, and said so
  expect(first.goals[0].reachable && first.goals[1].reachable).toBe(false) // the feet give a little too: hard goals in conflict share the miss
  const s1 = run(still.body, still.plan, 2)
  const cost = () => solve(still.body, still.plan(0), DT, { maxIterations: 0 }).goals.slice(0, 5).filter((_, i) => i !== 2 && i !== 3).reduce((a, g) => a + g.missedBy ** 2, 0)
  const best = cost(), q0 = still.body.q.slice()
  let better = 0, rnd = 12345
  const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1
  for (let k = 0; k < 2000; k++) { // closest pose: no nearby pose within the joint limits does better (by the largest residual of each hard goal)
    const size = 10 ** (-1 - 3 * Math.abs(rand()))
    q0.forEach((v, i) => (still.body.q[i] = Math.min(still.body.max[i], Math.max(still.body.min[i], v + size * rand()))))
    still.body.update()
    if (cost() < best * (1 - 1e-3)) better++
  }
  q0.forEach((v, i) => (still.body.q[i] = v))
  still.body.update()
  say(`(d) unreachable hard hand goal: missed by ${first.goals[4].missedBy.toFixed(3)} m, reported unreachable; the feet give ${e(Math.max(first.goals[0].missedBy, first.goals[1].missedBy))} (equal hard goals share a conflict)`)
  say(`    max frame-to-frame joint change over 120 frames = ${e(s1.dq)} rad  <- no jitter`)
  say(`    random nearby poses that do clearly better: ${better} of 2000`)
  expect(s1.dq).toBeLessThan(1e-5); expect(better).toBe(0)

  const sweep = (t: number) => V(-0.2 + 0.25 * Math.sin(0.9 * t), 1.9 + 0.65 * Math.sin(0.6 * t), 0.3 + 0.2 * Math.sin(0.7 * t))
  const a = reach((t, point) => point.set({ position: sweep(t) }))
  let miss = 0, out = 0
  const s2 = run(a.body, a.plan, 21, (_t, r) => { miss = Math.max(miss, r.goals[4].missedBy); if (!r.goals[4].reachable) out++ })
  say(`    target sweeping in and out of reach for 21 s: unreachable in ${out} of ${s2.frames} frames, worst miss ${(100 * miss).toFixed(1)} cm; max frame-to-frame joint change ${s2.dq.toFixed(2)} rad (at the reach boundary, see README)`)
  say(`    ${perf(s2)}`)
  expect(s2.unconverged).toBeLessThan(s2.frames / 50)
})

test('(e) two hard goals on the same point throw', () => {
  const body = createHumanoid(), fist = body.get('fistR')
  expect(() => solve(body, [hard(fist, new Target().set({ position: V(0, 1, 0.3) })), hard(fist, new Target().set({ position: V(0, 1.1, 0.3) }))])).toThrow(/two hard goals/)
  expect(() => solve(body, [hard(fist, new Target().set({ position: V(-0.2, 1, 0.3) })), soft(fist, new Target().set({ position: V(0, 1.1, 0.3) }))])).not.toThrow()
})

test('(f) a point carries position and velocity together, and the state can be read back', () => {
  // A hand curve planned from the CURRENT state to a future one: each frame the target carries where the hand
  // should be and how fast; the solver meets both, and velocityOf reads the velocity back.
  const body = createHumanoid(), fist = body.get('fistR'), point = new Target(), goals = [...standing(body), hard(fist, point)]
  solve(body, goals.slice(0, -1), DT)
  const goal = { position: V(-0.3, 1.25, 0.45), velocity: V(0, 1.5, 2) }, T = 0.5
  let perr = 0, verr = 0, t = 0
  while (t < T - 1e-9) {
    const curve = toward(body.positionOf(fist), body.velocityOf(fist), goal.position, goal.velocity, T - t) // replanned every frame
    const want = curve(DT)
    point.set({ position: want.position, velocity: want.position.clone().sub(body.positionOf(fist)).divideScalar(DT) })
    const r = solve(body, goals, DT)
    t += DT
    perr = Math.max(perr, r.goals[4].missedBy)
  }
  perr = Math.max(perr, body.positionOf(fist).distanceTo(goal.position))
  verr = body.velocityOf(fist).distanceTo(goal.velocity)
  say(`(f) hand driven from its current state to a point 0.5 s ahead, to arrive at 2.5 m/s: position and velocity rows met to ${e(perr)} m each frame; arrives ${e(body.positionOf(fist).distanceTo(goal.position))} m off, velocity off by ${verr.toFixed(3)} m/s (finite difference of the last frame)`)
  expect(perr).toBeLessThan(1e-9); expect(verr).toBeLessThan(0.3)

  // velocity alone: the point is not placed, only moved
  const free = createHumanoid(), hand = free.get('fistR'), v = V(0.3, 0.2, -0.1), drift = new Target().set({ velocity: v }), g2 = [...standing(free), hard(hand, drift)]
  solve(free, g2.slice(0, -1), DT)
  let err = 0
  for (let k = 0; k < 60; k++) { solve(free, g2, DT); err = Math.max(err, free.velocityOf(hand).distanceTo(v)) }
  say(`    velocity-only goal ${v.length().toFixed(2)} m/s for 1 s: max |velocityOf - v| = ${e(err)} m/s`)
  expect(err).toBeLessThan(1e-9)
})

test('(g) memoryless: the pose does not depend on how the solver got there', () => {
  const T = 2, forward = reach((t, p) => p.set({ position: moving(t) })), backward = reach((t, p) => p.set({ position: moving(t) }))
  for (let t = 0; t <= T + 1e-9; t += DT) solve(forward.body, forward.plan(t))
  for (let t = 2 * T; t >= T - 1e-9; t -= DT) solve(backward.body, backward.plan(t)) // arrive at T from the future
  solve(forward.body, forward.plan(T)); solve(backward.body, backward.plan(T))
  const diff = Math.max(...forward.body.q.map((v, i) => Math.abs(v - backward.body.q[i])))
  say(`(g) same goals reached from the past and from the future: max joint difference = ${e(diff)} rad`)
  expect(diff).toBeLessThan(1e-6)
})

test('attach and detach are explicit, and the object stays where it is in the world', () => {
  const body = createHumanoid(), box = new Object3D(), scene = new Object3D()
  scene.add(body.root)
  body.attach(box, body.get('palmR'), mark(box, 'gripR', V(-0.175, 0, 0)))
  body.attach(box, body.get('palmL'), mark(box, 'gripL', V(0.175, 0, 0)))
  const goals = standing(body)
  expect(body.closures.length).toBe(1)
  expect(solve(body, goals).closureError).toBeLessThan(1e-9)
  body.detach(box, body.get('handL')) // one hand lets go: the loop opens, the box stays with the right hand
  expect(body.closures.length).toBe(0)
  const before = body.positionOf(box)
  body.detach(box) // dropped: no longer on the body, and exactly where it was
  expect(box.parent).toBe(scene); expect(body.positionOf(box).distanceTo(before)).toBeLessThan(1e-12)
  expect(solve(body, goals).goals[0].reachable).toBe(true)
})
