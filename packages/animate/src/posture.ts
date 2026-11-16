import { SETTLE, type Side } from '@drawcall/gait'
import { EASE, type Mover } from '@drawcall/plan'
import { Quaternion, Vector3 } from 'three'
import type { End } from './ends'
import { OnHim, Watched } from './movers'
import { type Ask, type Lean, type Reach, upright } from './reach'
import { REACH } from './rig/limb'
import { type Size } from './rig/size'

/** how far ahead of a hand each part leans for it (in his beats): the hips and the bend first, as the parts nearer the middle lead */
const LEAD: Lean = { sink: 1, bend: 1, turn: 0.5, roll: 0.5 }
/** how fast the hips let down (in his paces a second), taking the gait's `SETTLE` over the last of the way */
const SINK = 0.34

/** how far through something is, eased in and out */
const smooth = (s: number) => {
  const t = Math.max(0, Math.min(1, s))
  return t * t * (3 - 2 * t)
}

/**
 * What the hands ask of the hips and the trunk at a moment, for the gait and the free parts to read: how he leans for
 * every hand the story has to reach where its plan has it then, and to be down in time for where it is to arrive.
 * Asked again for the same moment it is told from what it worked out, until a frame is written or the clock goes on.
 */
export class Asks {
  private readonly known = new Map<number, Lean>()

  constructor(
    readonly hands: End[],
    private readonly size: Size,
    readonly reach: Reach,
    /** the hips' plan, and how high the ground under him is */
    private readonly hips: () => Mover,
    private readonly ground: () => number,
    /** how strong the trunk is and how fast it comes round */
    private readonly trunk: { strength: number; rate: number },
  ) {}

  /** how long the hips take to let down so far, and the trunk to bend so far (s): each from as long before as it takes */
  private leads({ bend, sink }: { bend: number; sink: number }) {
    const { pace, beat } = this.size
    return {
      sinks: sink > 0 ? sink / (SINK * pace) + SETTLE * beat : 0,
      bends: Math.abs(bend) > 0 ? Math.sqrt((6 * Math.abs(bend)) / (EASE * this.trunk.strength)) + 1 / this.trunk.rate : 0,
    }
  }

  /** what was worked out is worked out again: a frame was written, or the clock went on */
  forget() {
    this.known.clear()
  }

  /** a place in the scene on him, from the middle of his hips standing at a moment (or as high as a jump has them), as he faces then */
  on(place: Vector3, time: number, carried = false) {
    const [hips, turn] = [new Vector3(), new Quaternion()]
    this.hips().state(Math.max(time, this.now), hips, new Vector3(), turn)
    // (a place that goes with him is counted from where his hips will be, let down as they are)
    if (!carried) hips.y = Math.max(hips.y, this.ground() + this.size.stand)
    return place.clone().sub(hips).applyQuaternion(this.facing(turn).invert())
  }

  /** the way he faces, from how the hips are turned: about up alone */
  private facing(turn: Quaternion) {
    const way = new Vector3(0, 0, 1).applyQuaternion(turn)
    return turn.setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(way.x, way.z))
  }

  /** places in the scene for hands at a moment, each brought as near as the arms reach unstretched with him leaning so: how far short the furthest comes (m) */
  within(time: number, asks: { side: Side; place: Vector3; carried?: boolean }[]) {
    const on = asks.map(({ side, place, carried }) => ({ side, place: this.on(place, time, carried), carried }))
    // (a place on him is counted from him standing: it is planned within what the arms reach upright)
    // (and else as he leans for them, the arms unstretched)
    const lean = on.some(({ carried }) => carried) ? upright() : this.reach.lean(on).lean
    const short = Math.max(...on.map((ask) => this.reach.short(ask, lean, undefined, REACH)))
    if (short <= 0) return 0
    const [nearest, turn] = [new Vector3(), new Quaternion()]
    this.hips().state(Math.max(time, this.now), new Vector3(), new Vector3(), turn)
    this.facing(turn)
    on.forEach((ask, k) => {
      this.reach.short(ask, lean, nearest, REACH)
      asks[k].place.add(nearest.sub(ask.place).applyQuaternion(turn))
    })
    return short
  }

  private at(time: number): Lean {
    const key = Math.round((time / this.size.beat) * 80)
    const known = this.known.get(key)
    if (known) return known
    const nows: Ask[] = []
    const theres: { ask: Ask; due: number }[] = []
    for (const end of this.hands) {
      const { channel } = end
      if (!channel.busy && !channel.holding) continue
      // (swinging on after a fast arrival, it asks nothing of him)
      if (channel.owner === 'on') continue
      const [hand, there, turn] = [new Vector3(), new Vector3(), new Quaternion()]
      // (the wrist, for a hand that plans a part of it)
      const wrist = (at: Vector3) => at.sub(end.offset()?.applyQuaternion(turn) ?? new Vector3())
      // (a hand on a thing is where that is sent)
      const frame = (channel.bound ?? channel).frames[0]
      const next = frame?.at
      // (for a frame still to come, at its moment; one met already moving he leans for till it is done with, as it was met; one met at rest is held there)
      const passed = next !== undefined && next < time - 1e-6 * this.size.beat
      const swung = passed && frame.velocity !== undefined && new Vector3().copy(frame.velocity).lengthSq() > 0
      channel.state(swung ? next : time, hand, new Vector3(), turn)
      wrist(hand)
      const due = next !== undefined && !passed ? next : time
      channel.state(due, there, new Vector3(), turn)
      wrist(there)
      // (a thing carried with him, a place on him, or a thing the game moves, goes down and along with him)
      const held = (channel.bound ?? channel).goal?.on
      const carried = (held instanceof Watched && held.carried) || held instanceof OnHim || !!channel.bound?.outside
      // (before it sets off it is the body's, going with him)
      const off = (channel.bound ?? channel).setsOff
      // (a thing the game moves is where it was last told, against him as he was then)
      if (off === undefined || off <= time) nows.push({ side: end.side, place: this.on(hand, channel.bound?.outside ? this.now : time, carried), carried })
      if (due > time && !swung) theres.push({ ask: { side: end.side, place: this.on(there, due, carried), carried }, due })
    }
    const all = this.reach.lean(nows).lean
    // (he leans in time for where each hand is to arrive, from as long before as getting so far takes him)
    for (const due of new Set(theres.map(({ due }) => due))) {
      const going = theres.filter((one) => one.due === due).map(({ ask }) => ask)
      const lean = this.reach.lean([...going, ...nows.filter(({ side }) => !going.some((ask) => ask.side === side))]).lean
      const { sinks, bends } = this.leads(lean)
      const eased = (lead: number) => (lead > 0 ? smooth(1 - (due - time) / lead) : 1)
      const most = (a: number, b: number) => (Math.abs(b) > Math.abs(a) ? b : a)
      all.sink = Math.max(all.sink, lean.sink * eased(sinks))
      for (const part of ['bend', 'turn', 'roll'] as const) all[part] = most(all[part], lean[part] * eased(bends))
    }
    this.known.set(key, all)
    return all
  }

  /** the moment it is now, on his clock */
  now = 0

  /**
   * the most a hand asks of a part of him from a moment until as far ahead as that part leads, looked at then and a quarter beat
   * apart on his clock (a beat apart, further ahead than the gait's first marks): he leans in time, and stays so till it is done
   */
  private most(time: number, of: keyof Lean) {
    const step = this.size.beat / (time < this.now + 3 * this.size.beat ? 4 : 1)
    const ahead = LEAD[of] * this.size.beat
    // (as of now exactly, further ahead from the quarter beat after)
    let most = time < this.now + step ? this.at(time)[of] : 0
    for (let k = Math.floor(time / step) + 1; k <= Math.ceil((time + ahead) / step); k++) {
      const one = this.at(k * step)[of]
      if (Math.abs(one) > Math.abs(most)) most = one
    }
    return most
  }

  low = (time: number) => this.most(time, 'sink')
  bend = (time: number) => this.most(time, 'bend')
  turn = (time: number) => this.at(time + LEAD.turn * this.size.beat).turn
  roll = (time: number) => this.at(time + LEAD.roll * this.size.beat).roll
}
