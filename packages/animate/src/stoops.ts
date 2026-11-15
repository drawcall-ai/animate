import { Quaternion, Vector3 } from 'three'
import type { Ahead } from './ahead'
import { SETTLE, SINK, behind, lowest, lunge, squat } from './gait'
import { EASY, type Goal } from './goal'
import { RANGE } from './joints'
import { SLACK } from './limb'
import type { Mover } from './mover'
import { SOLE, type Side, type Size, tick } from './size'
import { UP, clamp, due } from './world'

/** how far he gets down for a hand or a foot to reach: the hips let down (m) and the trunk bent (rad), each from the moment that has it there in time, and until another */
export type Stoop = { low: number; bend: number; sinks: number; bends: number; until: number }

/** What he gets down for, and so how far down he is to be at a moment. */
export class Stoops {
  private readonly all: Stoop[] = []
  /** how long getting down as far as he can takes him (s) */
  readonly longest: number

  constructor(
    private readonly size: Size,
    private readonly trunk: Goal,
  ) {
    this.longest = Math.max(...Object.values(this.lead(squat(size), RANGE.trunk.x[1])))
  }

  /** how long before he is to be down the hips begin to sink so far, and the trunk to bend so far (s): the hips to sink and settle, the trunk to turn at its ease and come round */
  private lead(low: number, bend: number) {
    const { size, trunk } = this
    return {
      sinks: low / (SINK * size.pace) + SETTLE * size.beat,
      bends: Math.sqrt((6 * Math.abs(bend)) / (EASY * trunk.strength)) + 1 / trunk.rate,
    }
  }

  /** he gets down, the hips let down and the trunk bent, to be down at a moment and until another: each from as long before as it takes */
  add(low: number, bend: number, when: number, until: number, now: number) {
    // (what he was down for until a moment that is past is done with)
    for (let k = this.all.length - 1; k >= 0; k--) if (this.all[k].until < now) this.all.splice(k, 1)
    const { sinks, bends } = this.lead(low, bend)
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

const hips = new Vector3()
const velocity = new Vector3()
const trunk = new Vector3()
const at = new Vector3()
const fore = new Vector3()
const off = new Vector3()
const turned = new Quaternion()

/**
 * He gets down, the hips let down and the trunk bent, to be down at a moment and until another: which changes where
 * he is going. Not if a look that steps nothing ahead tells that what hangs `from` the hips and the trunk would
 * surely be more than `reach` from a place even so: with the hips no lower than he gets, lunging if he is going
 * along when they begin to sink, and standing low, as far back as they ride at the most.
 */
function sink(
  mover: Mover,
  ahead: Ahead,
  [low, bend, when, until]: number[],
  from: (seconds: number, hips: Vector3, trunk: Vector3) => Vector3,
  place: Vector3,
  reach: number,
) {
  const { stoops } = mover
  // (he is down until the moment: how he is to be then is told a step before it)
  const [seconds, just] = [when - ahead.now, when - tick(mover.size)]
  const deeper = Math.max(0, low - stoops.low(just))
  const stoop = stoops.add(low, bend, when, until, ahead.now)
  const lunges = ahead.at(Math.max(0, stoop.sinks - ahead.now)).copy.lunging
  ahead.hips(seconds, hips, velocity)
  hips.y = Math.min(hips.y, Math.max(hips.y - deeper, (lunges ? lunge : lowest)(mover.size)))
  const root = from(seconds, hips, trunk.set(ahead.leans(just - ahead.now), 0, 0))
  // (back from the way he faces)
  fore.set(0, 0, 1).applyAxisAngle(UP, ahead.facing(seconds))
  if (!lunges) root.addScaledVector(fore, -clamp(off.subVectors(root, place).dot(fore), 0, behind(mover.size, hips.y)))
  if (root.distanceTo(place) > reach + SLACK.reach * mover.size.leg) {
    stoop.until = -Infinity
    return undefined
  }
  ahead.stale()
  return stoop
}

/**
 * Has the body get down for a foot or a hand of a side toward a place by a `share` of the most it can, to be down at a
 * moment and until another: not if that would surely leave the limb more than `reach` from the place. For a foot the
 * hips come down; for a hand the trunk bends toward the place, forward, or back for what is behind his heels: and only
 * once it is bent as far as it goes do the hips come down, for what is below the shoulder and still out of reach
 */
export function lower(
  end: 'foot' | 'hand',
  side: Side,
  mover: Mover,
  ahead: Ahead,
  [share, when, until]: number[],
  place: Vector3,
  reach: number,
) {
  if (end === 'foot') {
    const from = (seconds: number, hips: Vector3) => ahead.hip(side, seconds, at, turned, hips)
    return sink(mover, ahead, [share * squat(mover.size), 0, when, until], from, place, reach)
  }
  const [back, forth] = RANGE.trunk.x
  const seconds = when - ahead.now
  const high = ahead.shoulder(side, seconds, at, turned).y
  fore.set(0, 0, 1).applyAxisAngle(UP, ahead.facing(seconds))
  const rear = off.subVectors(place, ahead.hips(seconds, hips, velocity)).dot(fore) < -SOLE.behind * mover.size.leg
  const low = place.y < high ? Math.max(0, 2 * share - 1) * squat(mover.size) : 0
  const from = (on: number, hips: Vector3, trunk: Vector3) => ahead.shoulder(side, on, at, turned, hips, trunk)
  return sink(mover, ahead, [low, Math.min(1, 2 * share) * (rear ? back : forth), when, until], from, place, reach)
}
