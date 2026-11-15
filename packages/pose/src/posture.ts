import { Vector3 } from 'three'
import type { Side } from '@drawcall/gait'

const SIGN = { left: 1, right: -1 }
/**
 * How the trunk and the hips share what a hand is to do: how far the trunk turns for a hand drawn back behind its
 * shoulder or reaching ahead (rad for an arm's length), how far the hips shift onto the foot behind or ahead (m for an
 * arm's length), and where a hand is at its ease ahead of its shoulder (of an arm)
 */
const SHARE = { turn: 0.7, shift: 0.12, ease: 0.45 }
/** how far the trunk bends forward at the most (rad), and how far the hips come down (of a leg) */
const DOWN = { bend: 1.1, sink: 0.45 }
/** how much of an arm a hand reaches without stretching */
const REACH = 0.92
/** how hard each part comes round (Hz): the hips first, the trunk after, and both like a weight on a spring */
const RATE = { hips: 2.2, trunk: 2.6 }

/** how he is to hold himself: the trunk turned (rad about y) and bent forward (rad), the hips down (m) and shifted ahead (m) */
export type Posture = { turn: number; bend: number; sink: number; shift: number }
export const still = (): Posture => ({ turn: 0, bend: 0, sink: 0, shift: 0 })

/**
 * What a hand asks of the rest of him, told from where it will be, on him as he faces (from the middle of the hips):
 * the trunk turns after a hand drawn back and through after it as it swings, his weight going with it, and for a hand
 * lower than it reaches he bends and comes down, the knees first for what is below the hips. `shoulder` is where the
 * shoulder is on him standing, `arm` and `leg` how long they are.
 */
export function asks(side: Side, hand: Vector3, shoulder: Vector3, arm: number, leg: number): Posture {
  const ahead = (hand.z - shoulder.z) / arm - SHARE.ease
  const turn = SIGN[side] * SHARE.turn * Math.max(-0.6, Math.min(1.2, -ahead))
  const shift = SHARE.shift * arm * Math.max(-1, Math.min(1, ahead))
  // the least bend and sink that has it reach, the bend costing more for what is below the hips
  let best = { bend: 0, sink: 0, cost: Infinity }
  const low = hand.y < 0
  for (let bend = 0; bend <= DOWN.bend + 1e-6; bend += DOWN.bend / 10) {
    for (let sink = 0; sink <= DOWN.sink * leg + 1e-6; sink += (DOWN.sink * leg) / 10) {
      const at = new Vector3(shoulder.x, shoulder.y * Math.cos(bend) - sink, shoulder.z + shoulder.y * Math.sin(bend))
      const short = Math.max(0, at.distanceTo(hand) - REACH * arm)
      const cost = 100 * short + (low ? 0.6 : 0.2) * bend + (low ? 0.2 : 1) * sink
      if (cost < best.cost) best = { bend, sink, cost }
    }
  }
  return { turn, bend: best.bend, sink: best.sink, shift }
}

/** both hands' asks together: the turns and shifts add, the most bend and sink is kept */
export function together(asked: Posture[]): Posture {
  const all = still()
  for (const one of asked) {
    all.turn += one.turn
    all.shift += one.shift
    all.bend = Math.max(all.bend, one.bend)
    all.sink = Math.max(all.sink, one.sink)
  }
  all.turn = Math.max(-1.2, Math.min(1.2, all.turn))
  all.shift = Math.max(-0.12, Math.min(0.12, all.shift))
  return all
}

/** a value that comes round to what it is to be like a weight on a spring, without overshooting */
export class Spring {
  value = 0
  velocity = 0
  constructor(private readonly rate: number) {}
  to(target: number, dt: number) {
    const pull = 2 * Math.PI * this.rate
    this.velocity = (this.velocity + pull * pull * dt * (target - this.value)) / (1 + pull * dt) ** 2
    this.value += this.velocity * dt
    return this.value
  }
}

/** the springs of a posture: the hips come round faster than the trunk */
export const springs = () => ({
  turn: new Spring(RATE.trunk),
  bend: new Spring(RATE.trunk),
  sink: new Spring(RATE.hips),
  shift: new Spring(RATE.hips),
})
