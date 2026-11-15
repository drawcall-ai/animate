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
  while (drive.time < drive.drill.seconds) {
    drive.update(FRAME)
    rig.updateMatrixWorld(true)
    frames++
    const hips = at('hips')
    heights.push(hips.y)
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
  }
}

test('the drills of examples/gait, as a viewer would measure them: the feet stay put and uncrossed, and he goes smoothly', () => {
  const rows = Object.keys(DRILLS).map(measure)
  const f = (x: number, d = 2) => x.toFixed(d).padStart(7)
  console.log(
    'drill        slideMax slideMean steps/s  stride crossed   knee° hipAcc95 hipAccMax headAcc95 headAccMax yawLag°  lean°\n' +
      rows
        .map((r) =>
          [r.drill.padEnd(12), f(r.slideMax, 3), f(r.slideMean, 3), f(r.steps), f(r.stride), f(r.crossed), f(r.knee, 0), f(r.hipAcc95, 1), f(r.hipAccMax, 1), f(r.headAcc95, 1), f(r.headAccMax, 1), f(r.yawLag, 0), f(r.lean, 0)].join(' '),
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
  }
}, 120000)
