import { LOWEST, SETTLE, type Side, SIGN } from '@drawcall/gait'
import { EASE } from '@drawcall/plan'
import { REACH } from './rig/limb'
import { RANGE } from './rig/joints'
import { type Size } from './rig/size'
import { Vector3 } from 'three'
import type { End } from './ends'
import { Watched } from './movers'

/**
 * How the trunk and the hips share what a hand is to do: how far the trunk turns for a hand drawn back behind its
 * shoulder or reaching across ahead (rad for an arm's length), how far his weight shifts after it (in lengths of his
 * arm for an arm's length), and how far ahead of its shoulder a hand is at its ease (in lengths of his arm)
 */
const SHARE = { turn: 0.7, shift: 0.12, ease: 0.45 }
/** how far the trunk bends forward at the most (rad), and how low the hips come down at the most (of how high they stand): a full squat */
const DEEPEST = { bend: RANGE.trunk.x[1], low: LOWEST }
/** how far below the shoulder a hand is, in lengths of his arm, before he gets down for it */
const LOW = 0.4
/** how far ahead of a hand the hips and the trunk move for it (in his beats): the hips first, as the parts nearer the middle lead; and how far ahead what he gets down for is looked at */
const LEAD = { hips: 1, trunk: 0.5, down: 1 }
/** what bending costs against getting down for a hand below the knees: a low one is reached with the legs */
const COST = { low: { bend: 0.9, sink: 0.25 } }
/** how much of his weight is above the hips: what bending lowers, where getting down lowers all of it */
const UPPER = 0.6

/** how fast the hips let down (in his paces a second), taking the gait's `SETTLE` over the last of the way */
const SINK = 0.34

/** how far through something is, eased in and out */
const smooth = (s: number) => {
  const t = Math.max(0, Math.min(1, s))
  return t * t * (3 - 2 * t)
}

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
function down(hand: Vector3, shoulder: Vector3, { arm, leg, stand }: Size) {
  const most = (1 - DEEPEST.low) * stand
  // (he gets down only for what is lower than his shoulder by more than so much of his arm: out ahead the arm reaches)
  if (hand.y > shoulder.y - LOW * arm || hand.distanceTo(shoulder) <= REACH * arm) return { bend: 0, sink: 0 }
  // (above the knees, what it costs is how far his weight comes down: all of it getting down, what is above the hips bending)
  const low = hand.y < -0.5 * leg
  let best = { bend: 0, sink: 0, cost: Infinity }
  for (let bend = 0; bend <= DEEPEST.bend + 1e-6; bend += DEEPEST.bend / 12) {
    for (let sink = 0; sink <= most + 1e-6; sink += most / 12) {
      const at = new Vector3(shoulder.x, shoulder.y * Math.cos(bend) - sink, shoulder.z + shoulder.y * Math.sin(bend))
      const short = Math.max(0, at.distanceTo(hand) - REACH * arm)
      const costs = 100 * short + (low ? COST.low.bend * bend + COST.low.sink * (sink / leg) : (sink + UPPER * shoulder.y * (1 - Math.cos(bend))) / leg)
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
export class Asks {
  private readonly known = new Map<number, Asked>()

  constructor(
    readonly hands: End[],
    private readonly size: Size,
    /** where each shoulder is from the middle of the hips, he standing at rest */
    readonly shoulders: Record<Side, Vector3>,
    /** where the hips are now and how fast they go, and which way he faces */
    private readonly hips: () => { at: Vector3; velocity: Vector3; facing: number; ground: number },
    /** how strong the trunk is and how fast it comes round */
    private readonly trunk: { strength: number; rate: number },
  ) {}

  /** how long getting down so far takes him (s): the hips letting down and settling, the trunk bending at its ease and coming round */
  private takes({ bend, sink }: { bend: number; sink: number }) {
    const { sinks, bends } = this.leads({ bend, sink })
    return Math.max(sinks, bends)
  }

  /** how long the hips take to let down so far, and the trunk to bend so far (s): each from as long before as it takes */
  private leads({ bend, sink }: { bend: number; sink: number }) {
    const { pace, beat } = this.size
    return {
      sinks: sink > 0 ? sink / (SINK * pace) + SETTLE * beat : 0,
      bends: bend > 0 ? Math.sqrt((6 * bend) / (EASE * this.trunk.strength)) + 1 / this.trunk.rate : 0,
    }
  }

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
    for (const end of this.hands) {
      const { channel } = end
      if (!channel.busy && !channel.holding) continue
      if (channel.owner === 'on') continue
      // (the trunk turns after the way a hand goes; he gets down for where it is to arrive, not for its wind-up)
      const [hand, there] = [new Vector3(), new Vector3()]
      channel.state(time, hand, new Vector3())
      // (a hand on a thing is where that is sent)
      const frame = (channel.bound ?? channel).frames[0]
      const next = frame?.at
      // (for a frame still to come, at its moment; one met already moving is done with, one met at rest is held there)
      const passed = next !== undefined && next < time - 1e-6 * this.size.beat
      const swung = passed && frame.velocity !== undefined && new Vector3().copy(frame.velocity).lengthSq() > 0
      const due = next !== undefined && !passed ? next : time
      channel.state(due, there, new Vector3())
      const on = (at: Vector3) => at.sub(hips).applyAxisAngle(new Vector3(0, 1, 0), -facing)
      // (nor for a place on him, or on a thing carried with him, which goes down with him)
      const held = (channel.bound ?? channel).goal?.on
      const lowered = !swung && held !== end.root && !(held instanceof Watched && held.carried) ? down(on(there), this.shoulders[end.side], this.size) : { bend: 0, sink: 0 }
      // (from as long before as getting down that far takes him)
      const { sinks, bends } = this.leads(lowered)
      // (easing in over as long before as each takes)
      const eased = (lead: number) => (lead > 0 ? smooth(1 - (due - time) / lead) : 1)
      const one = { ...asks(end.side, on(hand), this.shoulders[end.side], this.size), bend: lowered.bend * eased(bends), sink: lowered.sink * eased(sinks) }
      // (a hand on its way turns him after it and shifts his weight; one held where it is, or on a thing, only gets him down)
      const going = channel.frames.length > 0
      all.turn += going ? one.turn : 0
      all.shift += going ? one.shift : 0
      all.bend = Math.max(all.bend, one.bend)
      all.sink = Math.max(all.sink, one.sink)
    }
    all.turn = Math.max(-1.2, Math.min(1.2, all.turn))
    all.shift = Math.max(-0.12, Math.min(0.12, all.shift))
    this.known.set(key, all)
    return all
  }

  /** how long before a hand is at a place he takes to get down for it, if he must (s) */
  lowering(side: Side, place: Vector3) {
    const { at, facing, ground } = this.hips()
    const on = place.clone().sub(at.clone().setY(ground + this.size.stand)).applyAxisAngle(new Vector3(0, 1, 0), -facing)
    return this.takes(down(on, this.shoulders[side], this.size))
  }

  /** how long he takes to be up again from how far he is let down and bent now (s) */
  rising(bend: number, low: number) {
    const most = { bend: DEEPEST.bend, sink: (1 - DEEPEST.low) * this.size.stand }
    return Math.max(0, bend / most.bend, low / most.sink) * this.takes(most)
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
