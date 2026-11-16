import type { Side, Size } from '@drawcall/limbs'
import type { Posture } from '@drawcall/locomotion'
import { Vector3 } from 'three'
import type { End } from './ends'

const SIGN = { left: 1, right: -1 }
/**
 * How the trunk and the hips share what a hand is to do: how far the trunk turns for a hand drawn back behind its
 * shoulder or reaching across ahead (rad for an arm's length), how far his weight shifts after it (in lengths of his
 * arm for an arm's length), and how far ahead of its shoulder a hand is at its ease (in lengths of his arm)
 */
const SHARE = { turn: 0.7, shift: 0.12, ease: 0.45 }
/** how far the trunk bends forward at the most (rad), and how far the hips come down (in lengths of his leg) */
const DOWN = { bend: 1.1, sink: 0.62 }
/** how far below the shoulder a hand is, in lengths of his arm, before he gets down for it */
const LOW = 0.4
/** how much of an arm a hand reaches without stretching */
const REACH = 0.97
/** how far ahead of a hand the hips and the trunk move for it (in his beats): the hips first, as the parts nearer the middle lead; and how long getting down takes */
const LEAD = { hips: 1, trunk: 0.5, down: 1 }
/** what bending costs against getting down, for a hand above the knees and below them: a low one is reached with the legs */
const COST = { high: { bend: 0.6, sink: 0.5 }, low: { bend: 0.9, sink: 0.25 } }

type Asked = { turn: number; bend: number; sink: number; shift: number }

/**
 * What a hand asks of the rest of him, told from where it will be, on him as he faces, from the middle of his hips:
 * the trunk turns after a hand drawn back and through as it swings, his weight going with it; for a hand lower than
 * it reaches he bends and comes down, as little as has it reach, the legs doing more the lower it is.
 */
function asks(side: Side, hand: Vector3, shoulder: Vector3, { arm }: Size) {
  const ahead = (hand.z - shoulder.z) / arm - SHARE.ease
  return { turn: SIGN[side] * SHARE.turn * Math.max(-0.6, Math.min(1.2, -ahead)), shift: SHARE.shift * arm * Math.max(-1, Math.min(1, ahead)) }
}

/** for a hand lower than it reaches he bends and comes down, as little as has it reach, the legs doing more the lower it is */
function down(hand: Vector3, shoulder: Vector3, { arm, leg }: Size) {
  // (he gets down only for what is lower than his shoulder by more than so much of his arm: out ahead the arm reaches)
  if (hand.y > shoulder.y - LOW * arm) return { bend: 0, sink: 0 }
  const cost = hand.y < -0.5 * leg ? COST.low : COST.high
  let best = { bend: 0, sink: 0, cost: Infinity }
  for (let bend = 0; bend <= DOWN.bend + 1e-6; bend += DOWN.bend / 12) {
    for (let sink = 0; sink <= DOWN.sink * leg + 1e-6; sink += (DOWN.sink * leg) / 12) {
      const at = new Vector3(shoulder.x, shoulder.y * Math.cos(bend) - sink, shoulder.z + shoulder.y * Math.sin(bend))
      const short = Math.max(0, at.distanceTo(hand) - REACH * arm)
      const costs = 100 * short + cost.bend * bend + cost.sink * (sink / leg)
      if (costs < best.cost) best = { bend, sink, cost: costs }
    }
  }
  return { bend: best.bend, sink: best.sink }
}

/**
 * What the hands ask of the hips and the trunk at a moment, for locomotion to read: each hand the story has, as its
 * plan has it a little ahead, on him as he will face. Turns and shifts add, the most bend and sink is kept. Asked
 * again for the same moment it is told from what it worked out, until a frame is written or the clock goes on.
 */
export class Asks implements Posture {
  private readonly known = new Map<number, Asked>()

  constructor(
    readonly hands: End[],
    private readonly size: Size,
    /** where each shoulder is from the middle of the hips, he standing at rest */
    readonly shoulders: Record<Side, Vector3>,
    /** where the hips are now and how fast they go, and which way he faces */
    private readonly hips: () => { at: Vector3; velocity: Vector3; facing: number; ground: number },
  ) {}

  /** what was worked out is worked out again: a frame was written, or the clock went on */
  forget() {
    this.known.clear()
  }

  private at(time: number): Asked {
    const key = Math.round((time / this.size.beat) * 80)
    const known = this.known.get(key)
    if (known) return known
    const all: Asked = { turn: 0, bend: 0, sink: 0, shift: 0 }
    const { at, velocity, facing, ground } = this.hips()
    // (from the hips as they would stand: what he is down for is what is asked)
    const hips = at.clone().addScaledVector(velocity, Math.max(0, time - this.now)).setY(ground + this.size.stand)
    // (where a hand will be on him is told from where he is now: what is looked ahead at already reads this)
    for (const end of this.hands) end.root.flat = true
    for (const end of this.hands) {
      const { channel } = end
      if (!channel.busy && !channel.holding) continue
      if (channel.owner === 'on') continue
      // (the trunk turns after the way a hand goes; he gets down for where it is to arrive, not for its wind-up)
      const [hand, there] = [new Vector3(), new Vector3()]
      channel.state(time, hand, new Vector3())
      // (a hand on a thing is where that is sent)
      const due = Math.max(time, (channel.bound ?? channel).frames[0]?.at ?? time)
      channel.state(due, there, new Vector3())
      const on = (at: Vector3) => at.sub(hips).applyAxisAngle(new Vector3(0, 1, 0), -facing)
      const soon = due - time <= LEAD.down * this.size.beat
      const one = { ...asks(end.side, on(hand), this.shoulders[end.side], this.size), ...(soon ? down(on(there), this.shoulders[end.side], this.size) : { bend: 0, sink: 0 }) }
      // (a hand on its way turns him after it and shifts his weight; one held where it is, or on a thing, only gets him down)
      const going = channel.frames.length > 0
      all.turn += going ? one.turn : 0
      all.shift += going ? one.shift : 0
      all.bend = Math.max(all.bend, one.bend)
      all.sink = Math.max(all.sink, one.sink)
    }
    for (const end of this.hands) end.root.flat = false
    all.turn = Math.max(-1.2, Math.min(1.2, all.turn))
    all.shift = Math.max(-0.12, Math.min(0.12, all.shift))
    this.known.set(key, all)
    return all
  }

  /** the moment it is now, on his clock */
  now = 0

  /** the most a hand will ask of the hips or the trunk from a moment until so long after it: he gets down in time, and stays down till it is done */
  private most(time: number, within: number, of: 'sink' | 'bend') {
    let most = 0
    for (let ahead = 0; ahead <= within + 1e-9; ahead += within / 4) most = Math.max(most, this.at(time + ahead)[of])
    return most
  }

  low(time: number) {
    return this.most(time, LEAD.down * this.size.beat, 'sink')
  }

  shift(time: number) {
    return this.at(time + LEAD.hips * this.size.beat).shift
  }

  bend(time: number) {
    return this.most(time, LEAD.down * this.size.beat, 'bend')
  }

  turn(time: number) {
    return this.at(time + LEAD.trunk * this.size.beat).turn
  }
}
