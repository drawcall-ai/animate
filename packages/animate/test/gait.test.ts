import { type Object3D, Vector3 } from 'three'
import { expect, test } from 'vitest'
import { DRILLS, Drive } from '../../../examples/gait/drills'
import { person } from '../../../examples/person'
import { Body } from '../src'

/** the frame a game leads him by (s) */
const FRAME = 1 / 60
/** a foot counts as planted once its ball is so near as low as it stands, and until it is so far above it (m) */
const LOW = 0.012
const CLEAR = 0.02
const SIDES = ['left', 'right'] as const
/** how many frames a foot that came down takes to roll flat */
const ROLLED = 4

const bone = (rig: Object3D, name: string) => {
  const found = rig.getObjectByName(name)
  if (!found) throw new Error(`the rig has no ${name}`)
  return found
}

/** What a viewer sees of a drill, as numbers: how far a planted foot slides, the strides, the legs, how smooth he goes. */
function measure(name: string) {
  const rig = person()
  const body = new Body(rig)
  const drive = new Drive(body, DRILLS[name])
  const at = (part: string) => bone(rig, part).getWorldPosition(new Vector3())
  rig.updateMatrixWorld(true)
  const rest = Object.fromEntries(SIDES.map((side) => [side, at(`${side}Toes`).y]))
  const contact = Object.fromEntries(SIDES.map((side) => [side, undefined as Vector3 | undefined]))
  const was = Object.fromEntries(SIDES.map((side) => [side, undefined as Vector3 | undefined]))
  const slides: number[] = []
  const since = Object.fromEntries(SIDES.map((side) => [side, 0]))
  const strides: number[] = []
  const lastDown: Record<string, Vector3 | undefined> = {}
  let steps = 0
  let crossed = 0
  const knees: number[] = []
  const heights: number[] = []
  const heads: Vector3[] = []
  let lag = 0
  let lagged = 0
  let frames = 0
  let leanIn = 0
  let moving = 0
  // the hips as foreseen at earlier moments, to set against where they are by then: a foresight every so many frames
  const foreseen: { time: number; hips: { at: Vector3; time: number }[] }[] = []
  const missed = { [0.25]: [] as number[], [0.5]: [] as number[] }
  // each foot's footfall as it is aimed in flight, from lift-off to landing: how far the aim moves
  const aims = Object.fromEntries(SIDES.map((side) => [side, [] as { at: Vector3; time: number; lands: number }[]]))
  const wander: number[] = []
  const late: number[] = []
  const flats: Vector3[] = []
  while (drive.time < drive.drill.seconds) {
    drive.update(FRAME)
    rig.updateMatrixWorld(true)
    frames++
    const hips = at('hips')
    heights.push(hips.y)
    flats.push(hips.clone().setY(0))
    // (the gait's plan of the hips over the next 2.5 beats, and the footfalls it aims at)
    const { gait } = body
    const marks = Array.from({ length: 31 }, (_, k) => gait.time + (k * 2.5 * body.size.beat) / 30)
    if (frames % 6 === 0) foreseen.push({ time: body.time, hips: marks.map((time) => {
      const at = new Vector3()
      gait.hips.state(time, at, new Vector3())
      return { at, time }
    }) })
    for (const [ahead, list] of Object.entries(missed)) {
      const then = foreseen.find(({ time }) => Math.abs(time + Number(ahead) - body.time) < FRAME / 2)
      const mark = then?.hips.find(({ time }) => Math.abs(time - body.time) < FRAME / 2)
      if (mark) list.push(Math.hypot(mark.at.x - body.hips.value.x, mark.at.z - body.hips.value.z))
    }
    for (const side of SIDES) {
      const aim = gait.steps[side]
      const track = aims[side]
      if (aim) track.push({ at: aim.to.clone(), time: body.time, lands: aim.lands })
      if (aim || !track.length) continue
      // (landed: how far the aim moved from lift-off, and over the last fifth of a second)
      const last = track[track.length - 1]
      wander.push(Math.hypot(last.at.x - track[0].at.x, last.at.z - track[0].at.z))
      const before = track.find(({ time }) => time >= last.time - 0.2)
      if (before && last.time - track[0].time > 0.25) late.push(Math.hypot(last.at.x - before.at.x, last.at.z - before.at.z))
      track.length = 0
    }
    heads.push(at('head'))
    const across = at('leftUpperLeg').sub(at('rightUpperLeg')).setY(0).normalize()
    const pelvis = Math.atan2(-across.z, across.x)
    const ask = drive.drill.ask(drive.time)
    const way = ask.face ?? (Math.hypot(drive.velocity.x, drive.velocity.z) > 0.2 ? drive.velocity : undefined)
    if (way) {
      lag += Math.abs(Math.atan2(Math.sin(Math.atan2(way.x, way.z) - pelvis), Math.cos(Math.atan2(way.x, way.z) - pelvis)))
      lagged++
    }
    // feet crossed: the left ball to the right of the right one, across the pelvis
    const [left, right] = SIDES.map((side) => at(`${side}Toes`))
    if (left.clone().sub(right).dot(across) < 0.03) crossed++
    for (const side of SIDES) {
      const ball = at(`${side}Toes`)
      // (down once low, and off the ground again once well clear of it)
      const down = contact[side] ? ball.y < rest[side] + CLEAR : ball.y < rest[side] + LOW
      const start = contact[side]
      // (where it stands is taken once the foot has rolled flat, a few frames after it came down)
      if (down && start && frames - since[side] === ROLLED) start.copy(ball)
      if (down && !start) {
        since[side] = frames
        contact[side] = ball.clone()
        steps++
        const before = lastDown[side]
        if (before) strides.push(before.distanceTo(ball))
        lastDown[side] = ball.clone()
      } else if (!down && start) {
        if (frames - since[side] > ROLLED) slides.push(Math.hypot(was[side]!.x - start.x, was[side]!.z - start.z))
        contact[side] = undefined
      }
      was[side] = ball
      // the knee at mid-stance: the planted foot under the hips
      if (down && Math.hypot(ball.x - hips.x, ball.z - hips.z) < 0.08) {
        const [hip, knee, ankle] = ['UpperLeg', 'LowerLeg', 'Foot'].map((part) => at(`${side}${part}`))
        const thigh = knee.clone().sub(hip)
        const shin = ankle.clone().sub(knee)
        knees.push((thigh.angleTo(shin) * 180) / Math.PI)
      }
    }
    // how far the trunk leans toward where the way he goes turns, against how far that asks (deg)
    const v = drive.velocity
    const speed = Math.hypot(v.x, v.z)
    if (speed > 2) {
      const trunk = at('neck').sub(hips)
      const sideways = new Vector3(v.z, 0, -v.x).normalize()
      leanIn += (Math.atan2(trunk.dot(sideways), trunk.y) * 180) / Math.PI
      moving++
    }
  }
  const second = (values: number[]) => values.slice(2).map((v, k) => v - 2 * values[k + 1] + values[k])
  const jitter = second(heights).map((d) => Math.abs(d) / FRAME ** 2)
  const headAcc = heads.slice(2).map((p, k) => p.clone().sub(heads[k + 1].clone().multiplyScalar(2)).add(heads[k]).length() / FRAME ** 2)
  const along = second(flats.map((p) => p.x)).map((dx, k) => Math.hypot(dx, second(flats.map((p) => p.z))[k]) / FRAME ** 2)
  const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b)
  const pct = (xs: number[], p: number) => sorted(xs)[Math.floor(p * (xs.length - 1))] ?? 0
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  return {
    drill: name,
    slideMax: Math.max(0, ...slides),
    slideMean: mean(slides),
    steps: steps / drive.drill.seconds,
    stride: mean(strides),
    crossed: crossed / frames,
    knee: mean(knees),
    hipAcc95: pct(jitter, 0.95),
    hipAccMax: Math.max(...jitter),
    headAcc95: pct(headAcc, 0.95),
    headAccMax: Math.max(...headAcc),
    yawLag: (lag / Math.max(1, lagged) * 180) / Math.PI,
    lean: moving ? leanIn / moving : 0,
    flatAcc95: pct(along, 0.95),
    miss25: mean(missed[0.25]),
    miss50: mean(missed[0.5]),
    miss50Max: Math.max(0, ...missed[0.5]),
    miss50Mid: pct(missed[0.5], 0.5),
    wander: mean(wander),
    wanderMax: Math.max(0, ...wander),
    wanderMid: pct(wander, 0.5),
    lateMax: Math.max(0, ...late),
  }
}

test('the drills of examples/gait, as a viewer would measure them: the feet stay put and uncrossed, and he goes smoothly', () => {
  const rows = Object.keys(DRILLS).map(measure)
  const f = (x: number, d = 2) => x.toFixed(d).padStart(7)
  console.log(
    'drill        slideMax slideMean steps/s  stride crossed   knee° hipAcc95 hipAccMax headAcc95 headAccMax yawLag°  lean° flatAcc95 miss25 miss50 miss50Max miss50Mid wander wanderMax wanderMid lateMax\n' +
      rows
        .map((r) =>
          [r.drill.padEnd(12), f(r.slideMax, 3), f(r.slideMean, 3), f(r.steps), f(r.stride), f(r.crossed), f(r.knee, 0), f(r.hipAcc95, 1), f(r.hipAccMax, 1), f(r.headAcc95, 1), f(r.headAccMax, 1), f(r.yawLag, 0), f(r.lean, 0), f(r.flatAcc95, 1), f(r.miss25, 3), f(r.miss50, 3), f(r.miss50Max, 3), f(r.miss50Mid, 3), f(r.wander, 3), f(r.wanderMax, 3), f(r.wanderMid, 3), f(r.lateMax, 3)].join(' '),
        )
        .join('\n'),
  )
  for (const r of rows) {
    // never crossed, a foot that is down stays where it stands, and he faces round after the way he is to
    expect(r.crossed, r.drill).toBeLessThan(0.01)
    expect(r.slideMax, r.drill).toBeLessThan(0.25)
    expect(r.yawLag, r.drill).toBeLessThan(60)
  }
  for (const r of rows.filter(({ drill }) => ['tight', 'tightRight', 'wide', 'eight'].includes(drill))) {
    // running round, his feet stay put, he goes smoothly without jolts, at about three steps a second, leaning in
    expect(r.slideMax, r.drill).toBeLessThan(0.07)
    expect(r.hipAcc95, r.drill).toBeLessThan(20)
    expect(r.headAcc95, r.drill).toBeLessThan(30)
    expect(r.steps, r.drill).toBeGreaterThan(2.5)
    expect(r.steps, r.drill).toBeLessThan(3.5)
    // and as he goes round he is where he was foreseen to be half a second before, and a foot lands where it was aimed
    expect(r.miss50Mid, r.drill).toBeLessThan(0.08)
    expect(r.wanderMid, r.drill).toBeLessThan(0.15)
  }
  for (const r of rows.filter(({ drill }) => ['tight', 'tightRight'].includes(drill))) {
    // round a tight circle at a run he leans well into it, the whole of him
    expect(Math.abs(r.lean), r.drill).toBeGreaterThan(20)
  }
}, 120000)

test('led to a stand and then sent to take something off the floor, a hand gets there: the hips come down as the stoop has them', () => {
  const rig = person()
  const body = new Body(rig)
  // led a few steps ahead, then to a stand, as a game leads him
  let z = 0
  for (let time = 0; time < 2.5; time += FRAME) {
    const speed = time < 1 ? 1.2 : 0
    body.go({ x: 0, z: speed })
    body.face()
    body.hips.at({ x: 0, y: 0, z })
    body.update(FRAME)
    z += speed * FRAME
  }
  // then an action has him, which leads him no more: a hand to just over the floor before his right foot
  const { value } = body.hips
  const place = new Vector3(value.x - 0.12, 0.08, value.z + 0.35)
  let reached: boolean | undefined
  body.play(
    (function* () {
      reached = yield* body.hand.right.by(body.time + 0.8, place)
    })(),
  )
  for (let time = 0; time < 1.2; time += FRAME) body.update(FRAME)
  expect(reached).toBe(true)
})
