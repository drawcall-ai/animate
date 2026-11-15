import { Quaternion, Vector3 } from 'three'
import { type State, between, cubic, hardest, turnBy, turnFrom } from './curve'

export type Xyz = { x: number; y: number; z: number }

/** anything that can tell where it will be at a moment, and how turned: a channel, or a frame of the body */
export interface Mover {
  state(t: number, place: Vector3, velocity: Vector3, turn?: Quaternion): void
}

/**
 * A frame: the state something is to have at a moment. Its `place` (m) and `turn` are counted in what it is `on`, if
 * anything; its `velocity` (m/s) is how it moves in the scene. Left out, the moment is as soon as it can be at its
 * ease, the place where its velocity carries it, the velocity rest, the turn the one it has. `by` names who wrote it.
 */
export type Frame = { at?: number; place?: Xyz; velocity?: Xyz; turn?: Quaternion; on?: Mover; by?: string }

/** a frame as it is met: the moment, the velocity it can arrive with, when it sets off, and what it came short of */
type Planned = Frame & { met?: { at: number; velocity: Vector3; leaves: number; slow: number; late: number } }
/** what a share of its strength it eases with, coming round on its own */
const EASE = 0.5
/** how far a fast arrival draws back is `velocity × swing × 4/27`: so a swing of `DRAW × draw / speed` draws back `draw` */
const DRAW = 27 / 4

/**
 * Something with a place and a turn that goes from frame to frame on the smoothest way, from whatever state it is in:
 * so writing new frames, or cancelling them, replans at once and smoothly. It pushes no harder than its `strength`
 * (m/s²): a frame it cannot meet it meets as near as it can, arriving slower or later, and says so. A fast arrival
 * draws back first, no further than `draw` (m), with none setting off at once, and swings on after the way it was going. Bound to another, it goes with it
 * as one, offset as it was; unbound it goes on from the state it had. Moved from `outside`, it is only watched.
 */
export class Channel implements Mover {
  private readonly from: State & { turn: Quaternion; spin: Vector3 } = { value: new Vector3(), velocity: new Vector3(), turn: new Quaternion(), spin: new Vector3() }
  private readonly to: State = { value: new Vector3(), velocity: new Vector3() }
  private readonly rFrom: State = { value: new Vector3(), velocity: new Vector3() }
  private readonly rTo: State = { value: new Vector3(), velocity: new Vector3() }
  private readonly at = new Vector3()
  private readonly moving = new Vector3()
  private readonly spun = new Quaternion()
  private readonly rotated = new Vector3()
  private readonly turned = new Vector3()
  private readonly scratch = new Quaternion()

  readonly value = new Vector3()
  readonly velocity = new Vector3()
  readonly turn = new Quaternion()
  /** how fast it turns, about the scene's axes (rad/s) */
  readonly spin = new Vector3()
  readonly frames: Planned[] = []
  outside = false
  /** asked for a frame once it has none left and has come to rest: what owns it then */
  settle?: (channel: Channel) => Frame | undefined
  /** how the last frame it met came short: arriving so much slower (share) and later (s) */
  short = { slow: 0, late: 0 }
  private parent?: { on: Channel; place: Vector3; turn: Quaternion }
  private now = 0
  /** frames cancelled outright, and when: for whoever looks */
  private dropped: (Frame & { gone: number })[] = []
  private last?: Planned

  constructor(
    readonly name: string,
    readonly strength: number,
    readonly draw: number,
  ) {}

  /** writes a frame: it goes there from the state it is in, after the frames before it */
  by(frame: Frame): Frame {
    if (this.parent) return this.parent.on.by(this.through(frame))
    const planned: Planned = { ...frame }
    const k = this.frames.findIndex((one) => (one.at ?? Infinity) > (frame.at ?? Infinity))
    this.frames.splice(k < 0 ? this.frames.length : k, 0, planned)
    this.replan(planned)
    return planned
  }

  /** cancels the frames still to come, those written `by` someone if said: it goes on from the state it is in */
  cancel(by?: string) {
    const head = this.frames[0]
    const kept = this.frames.filter((one) => by !== undefined && one.by !== by)
    if (by === undefined) this.dropped.push(...this.frames.map((frame) => ({ ...frame, gone: this.now })))
    this.frames.splice(0, this.frames.length, ...kept)
    this.replan(this.frames[0] === head ? undefined : this.frames[0])
    if (this.last && (by === undefined || this.last.by === by)) this.last = undefined
  }

  /** what was fitted to the frames to come is fitted anew, from the state it will be in */
  private replan(from?: Planned) {
    // (the frame it is on its way to keeps its plan unless a new one comes before it)
    const head = this.frames[0]
    for (const frame of this.frames) if (frame !== head || from === head) frame.met = undefined
  }

  /** who owns it now: who wrote the frame it goes to or holds, the channel it is bound to, or the outside */
  get owner() {
    if (this.outside) return 'outside'
    if (this.parent) return this.parent.on.name
    return (this.frames[0] ?? this.last)?.by
  }

  get busy() {
    return this.frames.length > 0 || this.parent !== undefined || this.outside
  }

  /** binds it to another, as it is offset from it now: until unbound it goes with it, and frames written to it move that one */
  bind(on: Channel) {
    const back = on.turn.clone().invert()
    this.parent = { on, place: this.value.clone().sub(on.value).applyQuaternion(back), turn: back.multiply(this.turn) }
    this.cancel()
  }

  /** unbinds it: it goes on as it was moving, into its next frame, or swings on and comes to rest */
  unbind() {
    this.parent = undefined
    this.last = undefined
    if (!this.frames.length) this.swingOn(this.now, this.value, this.velocity)
  }

  /** arrived moving with nothing after, it swings on the way it was going and comes to rest as hard as it can push */
  private swingOn(when: number, place: Vector3, velocity: Vector3) {
    const speed = velocity.length()
    if (speed < 1e-6) return
    const T = (2 * speed) / this.strength
    this.frames.push({ at: when + T, place: place.clone().addScaledVector(velocity, T / 2), by: 'on' })
  }

  /** a frame for this channel told as the frame its parent is to have */
  private through(frame: Frame): Frame {
    const { place, turn } = this.parent!
    const theirs = frame.turn && frame.turn.clone().multiply(turn.clone().invert())
    const offset = place.clone().applyQuaternion(theirs ?? this.parent!.on.turn)
    const there = frame.place && new Vector3().copy(frame.place).sub(frame.on ? offset.clone() : offset)
    return { ...frame, place: there, turn: theirs }
  }

  /** where it will be at a moment, going as its frames have it, and how it will move and be turned */
  state(t: number, place: Vector3, velocity: Vector3, turn = this.scratch) {
    if (this.parent) {
      const { on, place: offset, turn: by } = this.parent
      on.state(t, place, velocity, turn)
      this.rotated.copy(offset).applyQuaternion(turn)
      velocity.add(this.at.crossVectors(on.spin, this.rotated))
      place.add(this.rotated)
      turn.multiply(by)
      return
    }
    if (this.outside) {
      place.copy(this.value).addScaledVector(this.velocity, t - this.now)
      velocity.copy(this.velocity)
      turn.copy(this.turn)
      return
    }
    this.from.value.copy(this.value)
    this.from.velocity.copy(this.velocity)
    this.from.turn.copy(this.turn)
    this.from.spin.copy(this.spin)
    let start = this.now
    let held = this.last
    for (const frame of this.frames) {
      const met = frame.met ?? this.fit(frame, start)
      if (t <= met.at) return this.between(t, Math.max(start, met.leaves), met.at, frame, met.velocity, place, velocity, turn)
      this.resolve(frame, met.at, met.velocity)
      this.from.value.copy(this.to.value)
      this.from.velocity.copy(this.to.velocity)
      if (frame.turn) this.from.turn.copy(this.spun)
      this.from.spin.set(0, 0, 0)
      start = met.at
      held = frame
    }
    this.after(t, start, held, place, velocity, turn)
  }

  /** the time it takes at the least, and the velocity it can arrive with, to meet a frame from how it is at `start` */
  private fit(frame: Frame, start: number) {
    const speed = frame.velocity ? this.moving.copy(frame.velocity).length() : 0
    // (a fast arrival from rest sets off as late as draws it back `draw`)
    const still = this.from.velocity.length() < 0.2 * this.draw
    const asked = frame.at ?? start + this.soonest(frame, start)
    // (as long as the way there would not go back on itself unasked: three times as long as it takes at that speed)
    this.resolve(frame, asked, this.to.velocity.set(0, 0, 0))
    const far = this.to.value.distanceTo(this.from.value)
    let leaves = speed > 0 && still && this.draw > 0 ? Math.max(start, asked - Math.max(DRAW * this.draw, 3 * far) / speed) : start
    const hard = (when: number, share: number, from = leaves) => {
      this.resolve(frame, when, this.moving.copy(frame.velocity ?? this.to.velocity.set(0, 0, 0)).multiplyScalar(share))
      return hardest(this.from, this.to, when - from) > this.strength
    }
    let [when, slow] = [Math.max(asked, leaves + 1e-3), 0]
    // too hard: it sets off sooner, then arrives slower, and only at rest still too hard, later
    if (leaves > start && hard(when, 1)) leaves = hard(when, 1, start) ? start : between(start, leaves, (from) => !hard(when, 1, from))
    if (hard(when, 1)) {
      const share = hard(when, 0) ? 0 : between(0, 1, (s) => !hard(when, s))
      slow = 1 - share
      if (share === 0) when = between(when + 5, when, (w) => !hard(w, 0))
    }
    const velocity = new Vector3().copy(frame.velocity ?? this.to.velocity.set(0, 0, 0)).multiplyScalar(1 - slow)
    return { at: when, velocity, leaves, slow, late: when - asked }
  }

  /** how long it takes at its ease to go to a frame given no moment */
  private soonest(frame: Frame, start: number) {
    this.resolve(frame, start, this.to.velocity.set(0, 0, 0))
    return Math.max(0.1, Math.sqrt((6 * this.to.value.distanceTo(this.from.value)) / (EASE * this.strength)))
  }

  /** where a frame has it at a moment: its place, as what it is on will be then, in `to`, and its turn in `spun` */
  private resolve(frame: Frame, when: number, velocity: Vector3) {
    this.to.velocity.copy(velocity)
    if (frame.on) {
      frame.on.state(when, this.to.value, this.at, this.spun)
      if (!frame.velocity) this.to.velocity.copy(this.at)
      this.to.value.add(this.rotated.copy(frame.place ?? { x: 0, y: 0, z: 0 }).applyQuaternion(this.spun))
      if (frame.turn) this.spun.multiply(frame.turn)
      return
    }
    if (frame.place) this.to.value.copy(frame.place)
    else this.to.value.copy(this.from.value).addScaledVector(this.at.addVectors(this.from.velocity, velocity), (when - this.now) / 2)
    this.spun.copy(frame.turn ?? this.from.turn)
  }

  /** on its way to a frame between two moments, holding still before it sets off */
  private between(t: number, leaves: number, when: number, frame: Frame, arrives: Vector3, place: Vector3, velocity: Vector3, turn: Quaternion) {
    this.resolve(frame, when, arrives)
    const T = when - leaves
    const s = Math.max(0, (t - leaves) / T)
    cubic(s, T, this.from, this.to, place, velocity)
    if (t < leaves) velocity.set(0, 0, 0)
    // the turn goes the same smoothest way, as a rotation vector from where it starts
    this.rFrom.value.set(0, 0, 0)
    this.rFrom.velocity.copy(this.from.spin).applyQuaternion(this.scratch.copy(this.from.turn).invert())
    this.rTo.value.copy(turnFrom(this.from.turn, frame.turn ? this.spun : this.from.turn, this.turned))
    this.rTo.velocity.set(0, 0, 0)
    cubic(s, T, this.rFrom, this.rTo, this.rotated, this.at)
    turnBy(this.from.turn, this.rotated, turn)
  }

  /** past its last frame: held there, on what it is on if anything */
  private after(t: number, start: number, held: Planned | undefined, place: Vector3, velocity: Vector3, turn: Quaternion) {
    turn.copy(this.from.turn)
    place.copy(this.from.value)
    velocity.set(0, 0, 0)
    if (!held) return
    // (arrived moving, it goes on so until it is told how it swings on)
    this.moving.copy(this.from.velocity)
    this.resolve(held, t, this.moving)
    place.copy(this.to.value).addScaledVector(this.moving, held.on ? 0 : t - start)
    velocity.copy(this.to.velocity)
    if (held.turn) turn.copy(this.spun)
  }

  /** time goes on to `now`: it is where its frames have it, and frames it has met are done with */
  advance(now: number) {
    const dt = now - this.now
    if (this.outside) {
      if (dt > 0) this.velocity.copy(this.value).sub(this.watched).divideScalar(dt)
      this.watched.copy(this.value)
      this.now = now
      return
    }
    this.fitHead()
    const was = this.scratch.copy(this.turn).clone()
    this.state(now, this.value, this.velocity, this.turn)
    if (dt > 0 && !this.parent) turnFrom(was, this.turn, this.spin).applyQuaternion(was).divideScalar(dt)
    this.now = now
    for (let head = this.frames[0]; head?.met && head.met.at <= now; head = this.frames[0]) {
      this.short = { slow: head.met.slow, late: head.met.late }
      this.last = this.frames.shift()
      if (!this.frames.length && head.met.velocity.lengthSq() > 0) {
        this.swingOn(head.met.at, this.value, this.velocity)
        this.last = undefined
      }
      this.fitHead()
    }
    if (!this.busy && this.velocity.length() < 1e-3 && this.settle) {
      const next = this.settle(this)
      if (next) this.by(next)
    }
  }

  /** the frame it goes to next is fitted, from the state it is in */
  private fitHead() {
    const head = this.frames[0]
    if (!head || head.met) return
    this.from.value.copy(this.value)
    this.from.velocity.copy(this.velocity)
    this.from.turn.copy(this.turn)
    this.from.spin.copy(this.spin)
    head.met = this.fit(head, this.now)
  }

  /** what it was last told it was, moved from outside */
  private readonly watched = new Vector3()

  /**
   * What it means to do, for whoever looks: the frames to come (where each has it, how fast, by when, by whom), the
   * way its plan goes over the next `seconds`, those cancelled in the last second, and what it is bound to
   */
  intent(seconds = 1, marks = 30) {
    const path = Array.from({ length: marks + 1 }, (_, k) => {
      const at = new Vector3()
      this.state(this.now + (k * seconds) / marks, at, new Vector3())
      return at
    })
    const there = (frame: Frame) => {
      const at = new Vector3()
      const when = (frame as Planned).met?.at ?? frame.at ?? this.now
      if (frame.on) this.resolve(frame, when, this.moving.set(0, 0, 0))
      return frame.on ? at.copy(this.to.value) : at.copy(frame.place ?? this.value)
    }
    this.dropped = this.dropped.filter(({ gone }) => this.now - gone < 1)
    const told = (frame: Frame) => ({ place: there(frame), velocity: new Vector3().copy(frame.velocity ?? { x: 0, y: 0, z: 0 }), in: ((frame as Planned).met?.at ?? frame.at ?? this.now) - this.now, by: frame.by })
    return {
      name: this.name,
      now: this.value.clone(),
      frames: this.frames.map(told),
      path,
      dropped: this.dropped.map((frame) => ({ ...told(frame), ago: this.now - frame.gone })),
      bound: this.parent?.on.name,
      short: this.short,
    }
  }

  /** puts it somewhere at once, at rest, with no frames */
  set(place: Xyz, turn?: Quaternion) {
    this.value.copy(place)
    this.velocity.set(0, 0, 0)
    if (turn) this.turn.copy(turn)
    this.watched.copy(place)
    this.frames.length = 0
    this.last = undefined
  }
}
