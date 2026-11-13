import { EASY } from './goal'
import { SETTLE, SINK, SQUAT } from './hips'
import { PARTS, RANGE } from './joints'
import { due } from './world'

/** how far he gets down for a hand or a foot to reach: the hips let down (m) and the trunk bent (rad), each from the moment that has it there in time, and until another */
export type Stoop = { low: number; bend: number; sinks: number; bends: number; until: number }

/** how long before he is to be down the hips begin to sink so far, and the trunk to bend so far (s): the hips to sink and settle, the trunk to turn at its ease and come round */
const lead = (low: number, bend: number) => ({
  sinks: low / SINK + SETTLE,
  bends: Math.sqrt((6 * Math.abs(bend)) / (EASY * PARTS.trunk.strength)) + 1 / PARTS.trunk.rate,
})

/** how long getting down as far as he can takes him (s) */
export const DOWN_IN = Math.max(...Object.values(lead(SQUAT, RANGE.trunk.x[1])))

/** What he gets down for, and so how far down he is to be at a moment. */
export class Stoops {
  private readonly all: Stoop[] = []

  /** he gets down, the hips let down and the trunk bent, to be down at a moment and until another: each from as long before as it takes */
  add(low: number, bend: number, when: number, until: number, now: number) {
    // (what he was down for until a moment that is past is done with)
    for (let k = this.all.length - 1; k >= 0; k--) if (this.all[k].until < now) this.all.splice(k, 1)
    const { sinks, bends } = lead(low, bend)
    const stoop = { low, bend, sinks: when - sinks, bends: when - bends, until }
    this.all.push(stoop)
    return stoop
  }

  /** how far the hips are to be let down at a moment (m): as far as the most he is down for then takes them */
  low(time: number) {
    const down = this.all.filter(({ sinks, until }) => time >= sinks && !due(time, until))
    return Math.max(0, ...down.map(({ low }) => low))
  }

  /** how far the trunk is to be bent at a moment (rad): for all he is down for then */
  bend(time: number) {
    const down = this.all.filter(({ bends, until }) => time >= bends && !due(time, until))
    return down.reduce((sum, { bend }) => sum + bend, 0)
  }
}
