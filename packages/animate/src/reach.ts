import { LOWEST, type Side } from '@drawcall/gait'
import { Euler, Quaternion, Vector3 } from 'three'
import { RANGE } from './rig/joints'
import { type Limb } from './rig/limb'
import type { Size } from './rig/size'

/** how he leans to reach: the trunk bent forward, turned to his left and rolled, as its joint turns (rad), and the hips let down (m) */
export type Lean = Record<(typeof PARTS)[number], number>
const PARTS = ['bend', 'turn', 'roll', 'sink'] as const
/** a place a hand is to reach, on him (from the middle of his hips as he stands, as he faces), and whether it goes down and along with his hips, being on him */
export type Ask = { side: Side; place: Vector3; carried?: boolean }
/** how many times the lean is worked on at the most, how near counts as reaching, and how finely places are told apart (in lengths of his arm) */
const TRIES = { most: 12, near: 1e-3, fine: 3e-3 }
/** how much more each ask weighs against itself than against another, when two are met at once */
const DAMP = 1.1

const [euler, trunk, at, out] = [new Euler(), new Quaternion(), new Vector3(), new Vector3()]
export const upright = (): Lean => ({ bend: 0, turn: 0, roll: 0, sink: 0 })

/**
 * What the arms with the trunk reach: for places the hands are to be at, the least he leans, each part going the same
 * share of the way its joint has left, for every arm to reach its place; how far short each still comes, and the
 * nearest place it reaches. The trunk turns as far as its joint does, the hips let down to a full squat.
 */
export class Reach {
  readonly range: Record<keyof Lean, readonly number[]>
  /** how far the trunk is turned and rolled for all else but the hands: what he leans by from (rad) */
  base = { turn: 0, roll: 0 }

  constructor(
    private readonly arms: Record<Side, Limb>,
    /** where a shoulder is from the middle of the hips, he standing, the trunk turned so */
    private readonly shoulder: (side: Side, trunk: Quaternion, to: Vector3) => Vector3,
    private readonly size: Size,
  ) {
    this.range = { bend: RANGE.trunk.x, turn: RANGE.trunk.y, roll: RANGE.trunk.z, sink: [0, (1 - LOWEST) * size.stand] }
  }

  /** how far short of its place an arm comes, he leaning so (m); and the nearest place it reaches, on him */
  short({ side, place, carried }: Ask, lean: Lean, nearest?: Vector3, reach = 1) {
    const from = this.shoulder(side, trunk.setFromEuler(euler.set(lean.bend, this.base.turn + lean.turn, this.base.roll + lean.roll)), at)
    from.y -= lean.sink
    out.copy(place).sub(from)
    if (carried) out.y -= lean.sink
    const length = reach * this.arms[side].length
    const short = Math.max(0, out.length() - length)
    if (nearest) nearest.copy(place).addScaledVector(out, -short / Math.max(out.length(), 1e-9))
    // (and no further behind him than an upper arm swings back, in the frame of the trunk: as far round as it is past that)
    const way = out.applyQuaternion(trunk.invert())
    const behind = Math.atan2(-way.z, Math.hypot(way.x, way.y))
    return short + length * Math.max(0, behind - RANGE.arm.x[1])
  }

  /** what was worked out for places, each told so finely */
  private readonly known = new Map<string, { lean: Lean; short: number }>()

  /** the least lean for every place to be reached, the arms stretched so much of their length at the most, and how far short the furthest still comes (m) */
  lean(asks: Ask[], reach = 1) {
    const fine = (at: number) => Math.round(at / (TRIES.fine * this.size.arm))
    const key = asks.map(({ side, place, carried }) => `${side}${carried ? 'c' : ''}${fine(place.x)},${fine(place.y)},${fine(place.z)}`).join(' ') + reach + Math.round(this.base.turn / TRIES.fine) + ',' + Math.round(this.base.roll / TRIES.fine)
    const known = this.known.get(key)
    if (known) return { lean: { ...known.lean }, short: known.short }
    if (this.known.size > 4096) this.known.clear()
    const lean = upright()
    const near = TRIES.near * this.size.arm
    // (each part as far as its joint goes from where all else has it)
    const from = (part: keyof Lean) => (part === 'turn' || part === 'roll' ? this.base[part] : 0)
    const [least, most] = [(part: keyof Lean) => Math.min(0, this.range[part][0] - from(part)), (part: keyof Lean) => Math.max(0, this.range[part][1] - from(part))]
    // (what no lean brings within reach he does not lean for: the shoulder goes no further than his trunk is long, and the hips as far as they go)
    const far = this.size.trunk + this.range.sink[1]
    const tried = asks.filter((ask) => this.short(ask, lean, undefined, reach) < far)
    for (let k = 0, was = Infinity; k < TRIES.most; k++) {
      const shorts = tried.map((ask) => this.short(ask, lean, undefined, reach))
      const worst = Math.max(0, ...shorts)
      // (reaching, or coming no nearer)
      if (worst < near || worst > was - near) break
      was = worst
      // (every part goes, by as much as it has left to go, along the least way that brings each hand short as far as it is short)
      const short = tried.filter((_, n) => shorts[n] >= near)
      const gone = short.map((ask) => this.short(ask, lean, undefined, reach))
      const room = PARTS.map((part) => Math.max(0, Math.min(most(part) - lean[part], lean[part] - least(part))) + 0.5 * (this.range[part][1] - this.range[part][0]))
      const slopes = short.map((ask, n) =>
        PARTS.map((part) => {
          const step = 1e-3 * (this.range[part][1] - this.range[part][0])
          lean[part] += step
          const slope = (this.short(ask, lean, undefined, reach) - gone[n]) / step
          lean[part] -= step
          return slope
        }),
      )
      const dot = (a: number[], b: number[]) => PARTS.reduce((sum, _, n) => sum + room[n] * room[n] * a[n] * b[n], 0)
      // (one hand: along its slope; two: the least lean that meets both, as far as they can both be met)
      const [a, b] = [slopes[0], slopes[1] ?? slopes[0]]
      // (damped, so two asks that pull nearly the same way do not throw him to his limits)
      const [aa, ab, bb] = [dot(a, a) * DAMP, dot(a, b), dot(b, b) * DAMP]
      const det = aa * bb - ab * ab
      const [x, y] = slopes.length < 2 ? [gone[0] / Math.max(aa, 1e-12), 0] : [(gone[0] * bb - gone[1] * ab) / det, (gone[1] * aa - gone[0] * ab) / det]
      PARTS.forEach((part, n) => {
        lean[part] = Math.min(most(part), Math.max(least(part), lean[part] - room[n] * room[n] * (x * a[n] + y * b[n])))
      })
    }
    const found = { lean, short: Math.max(0, ...asks.map((ask) => this.short(ask, lean, undefined, reach))) }
    this.known.set(key, { lean: { ...lean }, short: found.short })
    return found
  }
}
