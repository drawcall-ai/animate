import { type Goal, goal } from './drivers'
import { type Mass, type Rod, mass, pointing } from './physics'
import { KG, SIZE, STAND } from './skeleton'
import { type Vec, V, add, deg, len, mul, out, rad, sub } from './vec'

/** how a foot the story named bears the body: `firm` lets it pass over, `braced` stops it */
export type Landing = 'firm' | 'braced'

/** a lifted foot on its way: how far through (0…1), how far the body travels meanwhile, where it left, and the spot it is committed to */
export type Swing = { s: number; travel: number; from: number; spot?: number }

/** A foot is a mass at the ankle. Planted, the ground holds it: it is the body's anchor. */
export type Foot = Mass & {
  swing: Swing | null
  braced: boolean
  named: { at: number; lands: Landing; bend: number } | null
  /** how far its knee has given under the weight (m), and how far it is to give */
  give: number
  giveTo: number
}

/** `driven`: a drive has this limb, and the figure's own rules leave it alone */
export type Leg = { knee: Mass; foot: Foot; driven: boolean }
export type Arm = { elbow: Mass; hand: Mass; upper: Goal; fold: Goal; driven: boolean }

export type Figure = {
  hips: Mass
  chest: Mass
  head: Mass
  /** right (drawn near), left */
  arms: [Arm, Arm]
  legs: [Leg, Leg]
  masses: Mass[]
  rods: Rod[]
  /** how far the trunk is to lean forward (degrees) */
  lean: Goal
  /** the speed the legs are to keep (m/s) */
  pace: number
  time: number
  footfalls: number
  /** what the ground last gave (m/s²), smoothed */
  push: number
  /** how firmly the arms are held (1 is everyday) and how hard the trunk is braced over the hips */
  tone: number
  brace: number
  /** a drive is on: no foot is lifted for being left behind */
  driving: boolean
  /** since when the figure is only shedding its speed, and when a foot first caught it */
  settling: number | null
  caught: number | null
}

export const planted = (foot: Foot) => foot.swing === null && foot.held

/** how fast the figure as a whole is going: all its masses together */
export function speed(figure: Figure) {
  let kg = 0
  let momentum = 0
  for (const m of figure.masses) {
    if (m.held) continue
    kg += m.kg
    momentum += m.kg * m.v.x
  }
  return momentum / kg
}

/** how far the trunk leans forward (degrees) */
export const leaning = (figure: Figure) => 90 - deg(pointing(figure.hips, figure.chest))

/** an arm as the directions of its upper arm and forearm (degrees round from straight ahead) */
export type Pose = [upper: number, fore: number]

/**
 * A figure as a run delivers it to its last stride: going `speed`, off its right foot at `x`, the left in the air ahead,
 * the trunk leaning `lean` forward.
 */
export function arriving(x: number, { speed, lean = 6, arms = [[-60, -25], [-125, -100]] }: { speed: number; lean?: number; arms?: [Pose, Pose] }): Figure {
  const at = (from: Vec, degrees: number, length: number) => add(from, out(rad(degrees), length))
  const make = (p: Vec, kg: number) => mass(p.x, p.y, kg)
  const hipsAt = V(x + 0.22, STAND - 0.02)
  const hips = make(hipsAt, KG.hips)
  const chest = make(at(hipsAt, 90 - lean, SIZE.trunk), KG.chest)
  const head = make(at(chest.p, 90 - lean, SIZE.neck), KG.head)
  const arm = ([upper, fore]: Pose): Arm => {
    const elbow = make(at(chest.p, upper, SIZE.upper), KG.elbow)
    return { elbow, hand: make(at(elbow.p, fore, SIZE.fore), KG.hand), upper: goal(upper), fold: goal(fore - upper), driven: false }
  }
  const foot = (footX: number): Foot => ({ ...mass(footX, SIZE.ankle, KG.foot), held: true, swing: null, braced: false, named: null, give: 0, giveTo: 0 })
  const leg = (f: Foot): Leg => {
    // the knee, bent forward, between the hips and the foot
    const d = sub(f.p, hipsAt)
    const far = len(d)
    const off = Math.sqrt(Math.max(0, SIZE.thigh ** 2 - (far / 2) ** 2))
    const mid = V((hipsAt.x + f.p.x) / 2, (hipsAt.y + f.p.y) / 2)
    return { knee: make(add(mid, mul(V(-d.y / far, d.x / far), off)), KG.knee), foot: f, driven: false }
  }
  const right = foot(x)
  const left: Foot = { ...foot(x + 0.5), held: false, swing: { s: 0.5, travel: 1.4, from: x - 0.2 } }
  left.p.y = SIZE.ankle + 0.1
  const armPair: [Arm, Arm] = [arm(arms[0]), arm(arms[1])]
  const legPair: [Leg, Leg] = [leg(right), leg(left)]
  const masses = [hips, chest, head, ...armPair.flatMap((a) => [a.elbow, a.hand]), ...legPair.flatMap((l) => [l.knee, l.foot])]
  for (const m of masses) if (!m.held) m.v = V(speed, 0)
  const rods: Rod[] = [
    { a: hips, b: chest, length: SIZE.trunk },
    { a: chest, b: head, length: SIZE.neck },
    ...armPair.flatMap((a) => [
      { a: chest, b: a.elbow, length: SIZE.upper },
      { a: a.elbow, b: a.hand, length: SIZE.fore },
    ]),
    ...legPair.flatMap((l) => [
      { a: hips, b: l.knee, length: SIZE.thigh },
      { a: l.knee, b: l.foot, length: SIZE.shin },
    ]),
  ]
  return {
    hips, chest, head, arms: armPair, legs: legPair, masses, rods,
    lean: goal(lean), pace: speed, time: 0, footfalls: 0, push: 0, tone: 1, brace: 1, driving: false, settling: null, caught: null,
  }
}
