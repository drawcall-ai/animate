import { Quaternion, Vector3 } from 'three'
import type { Ahead } from './ahead'
import { SETTLE, SINK, behind, lowest, lunge, squat } from './gait'
import { clamp, due, EASY, EXACT, type Goal, RANGE, type Side, type Size, SOLE, type Stoop, tick, UP } from '@drawcall/limbs'
import type { Mover } from './mover'

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

/** how finely getting down is looked through for the least that has a limb reach, in shares of the most */
const FINE = 1 / 16
const hips = new Vector3()
const from = new Vector3()
const velocity = new Vector3()
const trunk = new Vector3()
const at = new Vector3()
const fore = new Vector3()
const off = new Vector3()
const turned = new Quaternion()

/**
 * Has the body get down for a foot or a hand of a side toward a place, to be down at a moment and until another: as
 * little as has a limb that reaches so far reach it, by a look that steps nothing ahead. For a
 * foot the hips come down; for a hand the trunk bends toward the place, forward, or back for what is behind his heels,
 * which costs him least, and only once it is bent as far as it goes do the hips come down, for what is below the
 * shoulder and still out of reach; for what is below his hips the other way round, the knees first and the chest up. The hips
 * come no lower than he gets, lunging if he is going along then, and standing low they ride back
 * as far as they do at the most.
 */
export function lower(
  end: 'foot' | 'hand',
  side: Side,
  mover: Mover,
  ahead: Ahead,
  [when, until]: number[],
  place: Vector3,
  reach: number,
): Stoop {
  const { stoops, size } = mover
  // (he is down until the moment: how he is to be then is told a step before it)
  const [seconds, just] = [when - ahead.now, when - tick(size)]
  const lunges = ahead.at(seconds).copy.lunging
  const was = stoops.low(just)
  ahead.hips(seconds, from, velocity)
  fore.set(0, 0, 1).applyAxisAngle(UP, ahead.facing(seconds))
  const [back, forth] = RANGE.trunk.x
  const rear = off.subVectors(place, from).dot(fore) < -SOLE.behind * size.leg
  const high = ahead.shoulder(side, seconds, at, turned).y
  // (for what is below his hips he bends his knees first, the chest up, and leans only as far as that leaves short)
  const deep = place.y < from.y
  const [first, then] = [(share: number) => Math.min(1, 2 * share), (share: number) => Math.max(0, 2 * share - 1)]
  const down = (share: number) =>
    end === 'foot'
      ? { low: share * squat(size), bend: 0 }
      : {
          low: place.y < high ? (deep ? first : then)(share) * squat(size) : 0,
          bend: (deep ? then : first)(share) * (rear ? back : forth),
        }
  const root = (share: number) => {
    const { low, bend } = down(share)
    hips.copy(from)
    hips.y = Math.min(hips.y, Math.max(hips.y - Math.max(0, low - was), (lunges ? lunge : lowest)(size)))
    if (end === 'foot') ahead.hip(side, seconds, at, turned, hips)
    else ahead.shoulder(side, seconds, at, turned, hips, trunk.set(ahead.leans(just - ahead.now, bend), 0, 0))
    if (!lunges) at.addScaledVector(fore, -clamp(off.subVectors(at, place).dot(fore), 0, behind(size, hips.y)))
    return at
  }
  // (the least that has it reach: else as far as brings it nearest)
  let [share, nearest] = [0, Infinity]
  for (let tried = FINE; tried <= 1 && nearest > reach; tried += FINE) {
    const far = root(tried).distanceTo(place)
    if (far <= reach || far < nearest - EXACT) [share, nearest] = [tried, far]
  }
  const { low, bend } = down(share)
  const stoop = stoops.add(low, bend, when, until, ahead.now)
  ahead.stale(Math.min(stoop.sinks, stoop.bends))
  return stoop
}
