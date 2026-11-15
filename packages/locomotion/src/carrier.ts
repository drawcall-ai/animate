import type { Carrier } from '@drawcall/limbs'
import type { Ahead } from './ahead'
import type { Mover } from './mover'
import { lower } from './stoops'

/** the hips and the feet, looked ahead along, as what carries the limbs: what their planner asks of the rest of the body */
export const carrier = (mover: Mover, ahead: Ahead): Carrier => ({
  get now() {
    return ahead.now
  },
  hips: (seconds, value, velocity) => ahead.hips(seconds, value, velocity),
  hip: (side, seconds, at, turned) => ahead.hip(side, seconds, at, turned),
  shoulder: (side, seconds, at, turned) => ahead.shoulder(side, seconds, at, turned),
  facing: (seconds) => ahead.facing(seconds),
  stepped: (side, seconds, at) => ahead.stepped(side, seconds, at),
  spare: (side, seconds, until) => ahead.spare(side, seconds, until),
  stale: (from) => ahead.stale(from),
  get down() {
    return ahead.down
  },
  stoop: (end, side, span, place, reach) => lower(end, side, mover, ahead, span, place, reach),
  rise: (stoop, at) => ahead.rise(stoop, at),
  wind: ahead.wind,
  take(side, span) {
    mover.foot[side].taken = span
  },
  get ground() {
    return mover.origin.y
  },
  put(side, place) {
    mover.put(side, place)
    return mover.foot[side].put
  },
  foot: (side) => mover.foot[side],
  get landing() {
    return mover.falls && mover.velocity.y <= 0
  },
})
