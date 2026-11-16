import { Matrix4, type Object3D, Quaternion, Vector3 } from 'three'
import type { Gait, Side } from '@drawcall/gait'
import { Channel, EASE, SWAY, type Frame, type Mover, type Xyz } from '@drawcall/plan'
import type { OnHim } from './movers'
import { DOWN, type Grip, type Pose, type Touch } from './rig/fingers'
import { type Limb, NEAR, REACH, sway } from './rig/limb'
import { EXACT, type Size, tick } from './rig/size'
import { room } from './solve'
import { type Story, waits } from './story'

/**
 * how strong a hand and a foot are, how hard they can be pushed along at the most (in his paces a beat), and how far
 * each draws back before a fast arrival at the most (in lengths of its limb)
 */
const END = { hand: { strength: 25, draw: 0.5 }, foot: { strength: 30, draw: 0.6 } }
/** how near the limb's start its end comes swung round it at the most (of the limb's length): nearer, the limb is folded in through the body */
const FOLDED = 0.5
/** how far ahead the first moment a limb can reach something is looked for, and how finely (in his beats) */
const LOOK = { far: 10, fine: 0.1 }

/** a place counted `on` him, from where the limb starts and as he faces, or on a thing, in its frame as it moves */
export type On = { on?: Object3D | object }
/** how an end is to arrive: moving so, in the scene, at a place counted `on` him or a thing */
export type Arriving = On & { velocity?: Xyz }
/**
 * and a hand: turned for its `palm` to face and its fingers to be `pointing` a way, counted as its place is; the place
 * being that of what it is there `with`, if not its wrist: a part of it, or what sits in it by a grip
 */
export type Reaching = Arriving & { palm?: Xyz; pointing?: Xyz; with?: Touch | Grip }

/** What a story has of a hand: where its wrist is and how it moves, whether it is where it was sent, and to send it, have it somewhere by a moment, shape its fingers, or cancel what it was sent to, which gives it back to the body once it has swung on. */
export type Hand = Readonly<{
  value: Vector3
  velocity: Vector3
  there: boolean
  to(place: Xyz | Grip, how?: Reaching & { seconds?: number }): Story<boolean>
  by(when: number, place: Xyz | Grip, how?: Reaching): Story<boolean>
  shape(pose?: Pose, how?: { by?: number }): Story<boolean>
  cancel(): void
}>
/** What a story has of a foot: where its ankle is and how it moves, where the ground holds it, and to send it, have it somewhere by a moment, or cancel what it was sent to. */
export type Foot = Readonly<{
  value: Vector3
  velocity: Vector3
  anchor?: Vector3
  to(place: Xyz, how?: Arriving & { seconds?: number }): Story<boolean>
  by(when: number, place: Xyz, how?: Arriving): Story<boolean>
  cancel(): void
}>

/** what an end needs of the body: its size, clock and gait, the body that a place `on` him names, and what a thing is as a frame moves on */
export type Body = {
  size: Size
  gait: Gait
  him: object
  time(): number
  mover(thing: Object3D): Mover
  /** the frame the body's places are told in: what takes the scene to it */
  frame: Matrix4
  /** a frame was written or cancelled: what the hands ask of the rest of him may have changed */
  changed(): void
  /** how long before a hand is at a place he takes to get down for it, if he must (s) */
  lowering(side: Side, place: Vector3): number
  /** how long he takes to be up again from how far down and bent he is now (s) */
  rising(): number
}

/**
 * how a hand is turned, from hanging straight down, for its palm to face and its fingers to point as said: what is
 * not said, it keeps from how it is turned `now`; the palm is kept, and the fingers point as near as is square to it
 */
function turnOf(palm: Vector3 | undefined, pointing: Vector3 | undefined, rest: Vector3, now: Quaternion) {
  const faces = palm?.clone().normalize() ?? rest.clone().applyQuaternion(now)
  const points = (pointing?.clone() ?? DOWN.clone().applyQuaternion(now)).addScaledVector(faces, -(pointing ?? DOWN.clone().applyQuaternion(now)).dot(faces))
  if (!palm && !pointing) return undefined
  // (with the fingers along the way the palm is to face, they point the nearest way square to it)
  if (points.lengthSq() < EXACT) {
    if (pointing && palm) throw new Error('a hand is turned to point the way its palm faces')
    points.copy(Math.abs(faces.y) < 0.9 ? DOWN : new Vector3(0, 0, 1)).addScaledVector(faces, -faces.dot(Math.abs(faces.y) < 0.9 ? DOWN : new Vector3(0, 0, 1)))
  }
  points.normalize()
  const basis = (a: Vector3, b: Vector3) => new Matrix4().makeBasis(a, b, a.clone().cross(b))
  return new Quaternion().setFromRotationMatrix(basis(faces, points).multiply(basis(rest, DOWN).invert()))
}

/**
 * The far end of a limb, a hand or a foot, as a channel the story writes frames to. A statement is one frame: a place,
 * on him, on a thing or in the scene, a velocity and a turn to arrive with, and a moment, given or the first one the
 * body lets it be there at its ease. Frames are met in order, each from the state it is in; one met moving swings on
 * and comes round to where the body has it; one met at rest is held there, as near as the limb reaches, until it is
 * sent elsewhere or cancelled.
 */
export class End {
  readonly channel: Channel
  /** where the posed end was from where its channel had it, after the last step (m) */
  gap = 0
  anchor?: Vector3

  constructor(
    readonly kind: 'hand' | 'foot',
    readonly side: Side,
    readonly limb: Limb,
    readonly root: OnHim,
    private readonly body: Body,
    /** how the bone at the end lies as the limb hangs straight down, and how large it is */
    private readonly lies: { hangs: Quaternion; large: number },
    /** the bone the limb starts at, which all of it hangs from */
    private readonly start: Object3D,
  ) {
    const { strength, draw } = END[kind]
    const { pace, beat } = body.size
    // (a hand turns no faster than its wrist does)
    this.channel = new Channel(`${side} ${kind}`, (strength * pace) / beat, draw * limb.length, limb.hand?.wrist.strength)
    // (it swings on round where its limb starts, as far round as the limb goes)
    this.channel.pivot = { about: root, room: (out, axis) => this.room(out, axis.clone().negate()), near: FOLDED * limb.length }
  }

  get name() {
    return this.channel.name
  }

  get value() {
    return this.channel.value
  }

  get velocity() {
    return this.channel.velocity
  }

  /** whether the story has it now: on its way somewhere, held somewhere, or on a thing */
  get held() {
    const { channel } = this
    const off = channel.setsOff
    // (swung on and come to rest, it is the body's)
    if (channel.owner === 'on' && !channel.busy) return false
    // (a foot just sent, not yet fitted, has not set off: the gait keeps it until it does)
    if (this.kind === 'foot' && off === undefined && channel.frames.length) return channel.holding
    // (as of the step being made, which ends a step of his time after his clock)
    return channel.holding || (channel.busy && (off === undefined || off <= this.body.time() + tick(this.body.size) + EXACT))
  }

  /** whether it is where it was last sent, as near as an end counts as there */
  get there() {
    const { channel } = this
    const bound = channel.busy && !channel.frames.length
    return (channel.holding || bound) && this.gap <= NEAR * this.body.size.leg
  }

  /** sends the end somewhere: in `seconds`, or at the first moment the body lets it be there */
  to(place: Xyz | Grip, { seconds, ...how }: Reaching & { seconds?: number } = {}) {
    return this.send(place, how, { seconds })
  }

  /** has the end somewhere by a moment */
  by(when: number, place: Xyz | Grip, how: Reaching = {}) {
    return this.send(place, how, { by: when })
  }

  private send(place: Xyz | Grip, how: Reaching, when: { seconds?: number; by?: number }): Story<boolean> {
    if (this.channel.bound) throw new Error(`the ${this.name} is on a thing and leads it with it: send the thing, or take the hand off it first`)
    // a foot sent to rest on the ground, or on a thing, stands there: the body steps there with it
    const moving = how.velocity && new Vector3().copy(how.velocity).lengthSq() > 0
    const ground = !how.on && 'y' in place && place.y <= this.body.gait.lead.place.y + this.body.size.ankle + EXACT
    if (this.kind === 'foot' && 'y' in place && !moving && (ground || (how.on && how.on !== this.body.him))) {
      return this.step(this.scene(place, how.on as Object3D | undefined), when?.seconds)
    }
    const frame = this.timed(this.frame(place, how), this.channel, when)
    // (a grip is handed over whole: the fingers close as it has them, by the moment the hand is on the thing)
    if ('target' in place) this.close(place.pose, frame.at - this.body.time())
    return this.write(frame)
  }

  /**
   * a frame for this end, or for what it leads on `channel`, given its moment: by a moment, in `seconds` after the
   * frames before it, or the first it can be there at, he getting down for it first; and when it sets off
   */
  timed(frame: Frame, channel: Channel, when?: { seconds?: number; by?: number }): Frame & { at: number } {
    const after = Math.max(this.body.time(), ...channel.frames.filter((one) => one.by === 'story').map((one) => one.at ?? 0))
    frame.at = this.moment(when?.by !== undefined ? Math.max(when.by, after) : when?.seconds !== undefined ? after + when.seconds : this.first(frame, after))
    // (a hand told no moment, for a place he gets down for, is there no sooner than he is down)
    if (when?.by === undefined && when?.seconds === undefined && this.kind === 'hand') {
      if (channel === this.channel) frame.at = Math.max(frame.at, this.moment(after + this.body.lowering(this.side, this.placed(frame, frame.at))))
      // (and one on him, no sooner than he is up again: it is counted from him standing)
      if (frame.on === this.root) frame.at = Math.max(frame.at, this.moment(after + this.body.rising()))
    }
    if (this.kind === 'hand') this.within(frame as Frame & { at: number }, channel)
    // (a foot steps off for half as long as it sways)
    if (this.kind === 'foot') frame.leaves = frame.at - sway(this.limb) / 2
    return frame as Frame & { at: number }
  }

  /** how far round `axis` behind a place `out` from where it starts in the scene it can be drawn back (rad) */
  room(out: Vector3, axis: Vector3) {
    const facing = new Quaternion()
    this.root.state(this.body.time(), new Vector3(), new Vector3(), facing)
    const back = facing.invert()
    return room(this.limb, out.clone().applyQuaternion(back), axis.clone().applyQuaternion(back))
  }

  /** how far short of where it was sent the last frame written to it is planned, out of the arm's reach (m) */
  short = 0

  /**
   * a frame for a place above the shoulder, which only the arm reaches (getting down or bending brings nothing higher),
   * is planned no further from the shoulder than the arm reaches, as the hips will have the shoulder then: for a thing
   * the hand leads, the thing goes as far short as the hand does
   */
  private within(frame: Frame & { at: number }, channel: Channel) {
    const [shoulder, turn] = [new Vector3(), new Quaternion()]
    this.root.state(frame.at, shoulder, new Vector3())
    const wrist = this.placed(frame, frame.at).add(channel === this.channel ? new Vector3() : this.channel.value.clone().sub(channel.value))
    const out = wrist.clone().sub(shoulder)
    this.short = wrist.y > shoulder.y ? Math.max(0, out.length() - REACH * this.limb.length) : 0
    if (!this.short || !frame.place) return
    const by = out.setLength(-this.short)
    if (frame.on) frame.on.state(frame.at, new Vector3(), new Vector3(), turn)
    frame.place = new Vector3().copy(frame.place).add(by.applyQuaternion(turn.invert()))
  }

  /** where a frame has it in the scene at a moment */
  private placed(frame: Frame, at: number) {
    const [place, turn] = [new Vector3(), new Quaternion()]
    if (frame.on) frame.on.state(at, place, new Vector3(), turn)
    return place.add(new Vector3().copy(frame.place ?? { x: 0, y: 0, z: 0 }).applyQuaternion(turn))
  }

  /** a moment is the first step of his time at or after it */
  moment(at: number) {
    const dt = tick(this.body.size)
    return Math.ceil(at / dt - 1e-6) * dt
  }

  /** writes a frame the story has sent: it is the story's from when it sets off; tells whether it was there at its moment */
  write(frame: Frame): Story<boolean> {
    const written = this.channel.by(frame)
    // (what it was sent onto before matters no more once it is sent elsewhere)
    const ons = this.channel.frames.map(({ on }) => (on && 'object' in on ? (on as { object: Object3D }).object : undefined))
    for (const thing of this.on) if (!ons.includes(thing)) this.on.delete(thing)
    this.body.changed()
    return this.met(written)
  }

  /** a place on a thing, as the thing is now, or in the scene */
  private scene(place: Xyz, on?: Object3D) {
    const at = new Vector3()
    const turn = new Quaternion()
    if (!on) return at.copy(place)
    this.body.mover(on).state(this.body.time(), at, new Vector3(), turn)
    return new Vector3().copy(place).applyQuaternion(turn).add(at)
  }

  /** where the story last put the foot down to stand, until it is sent elsewhere */
  private put?: Vector3

  /** the body steps with the foot to a place it stands on, in so many `seconds` or as soon as it can, and stands over it there: over once it is down there */
  private step(place: Vector3, seconds?: number): Story<boolean> {
    this.cancel()
    const { gait } = this.body
    gait.put(this.side, place, seconds)
    const put = (this.put = place)
    const foot = gait.feet[this.side]
    return waits(
      () => this.put === put,
      () => !gait.steps[this.side] && !foot.frames.length && foot.value.distanceTo(put) < EXACT,
    )
  }

  /**
   * one the story does not have is where the body has put it: told how it moves from where it was a step ago, so a
   * frame written to it sets off from how it really is
   */
  track(dt: number, at?: Vector3, turn?: Quaternion) {
    if (this.held || !at) return
    const { channel } = this
    if (dt > 0) channel.velocity.copy(at).sub(channel.value).divideScalar(dt)
    channel.value.copy(at)
    if (turn) channel.turn.copy(turn)
  }

  private *met(frame: Frame): Story<boolean> {
    while (this.channel.frames.includes(frame)) yield
    return this.channel.met(frame) && this.gap <= NEAR * this.body.size.leg
  }

  /** the part of the hand it was last sent with, if not its wrist: its channel plans where that part is, and the arm puts it there */
  part?: Touch

  /** where the part it was sent with is from the wrist now, in the frame of the hand: none, sent with the wrist */
  offset() {
    return this.part ? this.fingers().tip(this.part, 0) : undefined
  }

  /** where the part its channel plans is, for a wrist and a hand turned so */
  point(wrist: Vector3, turn: Quaternion) {
    const offset = this.offset()
    return offset ? offset.applyQuaternion(turn).add(wrist) : wrist.clone()
  }

  /** it plans another part of the hand from now: what it plans goes over to where that part is */
  private plans(part?: Touch) {
    if (part === this.part) return
    const { value, turn } = this.channel
    const wrist = this.offset()?.applyQuaternion(turn).negate().add(value) ?? value.clone()
    this.part = part
    this.channel.set(this.point(wrist, turn), turn)
  }

  /** the things it was sent onto, until it is cancelled */
  readonly on = new Set<Object3D>()

  /** a thing it is sent onto, which may not hang from its own limb */
  private onto(thing: Object3D) {
    for (let up: Object3D | null = thing; up; up = up.parent) {
      if (up === this.start) throw new Error(`the ${this.name} is sent to a thing that hangs from its own limb`)
    }
    this.on.add(thing)
    return this.body.mover(thing)
  }

  /** a statement as a frame: where the wrist or the ankle is to be, how fast and how turned, counted as the place is */
  frame(place: Xyz | Grip, { velocity, on, palm, pointing, with: part }: Reaching = {}): Frame {
    const hand = this.limb.hand
    if ('target' in place) {
      if (!hand) throw new Error(`the ${this.name} is sent to hold something, and is no hand`)
      if (palm || pointing || part) {
        throw new Error(`the ${this.name} is sent to hold something by a grip, which says where it is and how it is turned: leave out \`palm\`, \`pointing\` and \`with\``)
      }
      const held = this.seats(place)
      return { on: this.onto(place.target), place: held.place, turn: held.turn, by: 'story' }
    }
    const told = [place, velocity, palm, pointing].filter((one): one is Xyz => one !== undefined)
    if (!told.every((one) => [one.x, one.y, one.z].every(Number.isFinite))) {
      throw new Error(`the ${this.name} is sent to a place, to move there, or turned a way, as no numbers say`)
    }
    const mover = on === this.body.him ? this.root : on ? this.onto(on as Object3D) : undefined
    const there = new Vector3().copy(place)
    // (a foot goes no lower than it stands on the ground)
    if (this.kind === 'foot' && !mover) there.y = Math.max(there.y, this.body.gait.lead.place.y + this.body.size.ankle)
    const ways = [palm, pointing].map((way) => way && new Vector3().copy(way))
    if (ways.some((way) => way && way.lengthSq() < EXACT)) throw new Error(`the ${this.name} is turned a way that leads nowhere`)
    // (said in the frame of what the place is on: the hand as it is now, told the same way)
    const into = new Quaternion()
    if (mover) mover.state(this.body.time(), new Vector3(), new Vector3(), into)
    const now = into.clone().invert().multiply(this.channel.turn)
    // (told nothing of how it is turned, or only how the palm faces, the fingers point on along the arm, as from its shoulder to the place)
    const along = !ways[1] ? this.along(there, mover, into) : undefined
    const turn = hand ? turnOf(ways[0], ways[1] ?? along, hand.palm, now) : undefined
    // (sent with what sits in it by a grip, the wrist is where that has it there; with a part of the hand, it plans that part)
    if (part && hand && typeof part !== 'string') there.sub(this.sits(part).at.applyQuaternion(turn ?? now))
    this.plans(typeof part === 'string' ? part : undefined)
    const frame: Frame = { on: mover, place: there, turn, velocity, by: 'story' }
    const speed = velocity ? new Vector3().copy(velocity) : undefined
    if (speed && speed.lengthSq() > 0) {
      // a fast end swings round where its limb starts, and a hand's wrist whips on with it: the fingers led into the way it goes
      frame.about = this.root
      if (hand) frame.spin = DOWN.clone().applyQuaternion(into.clone().multiply(turn ?? now)).cross(speed).divideScalar(this.body.size.forearm)
    }
    return frame
  }

  /** the fingers take a pose in so many seconds, or as soon as they can if that is too soon */
  close(pose: Pose, seconds: number) {
    const fingers = this.limb.hand?.fingers
    try {
      void fingers?.shape(pose, seconds)
    } catch {
      void fingers?.shape(pose)
    }
  }

  /** the way from where the limb starts to a place, counted as the place is */
  private along(place: Vector3, mover: Mover | undefined, into: Quaternion) {
    const root = new Vector3()
    this.root.state(this.body.time(), root, new Vector3())
    const there = new Vector3()
    mover?.state(this.body.time(), there, new Vector3())
    const at = mover ? new Vector3().copy(place).applyQuaternion(into).add(there) : place.clone()
    const way = at.sub(root)
    return way.lengthSq() > EXACT ? way.applyQuaternion(into.clone().invert()).normalize() : undefined
  }

  private fingers(asked = 'are asked for') {
    const fingers = this.limb.hand?.fingers
    if (!fingers) throw new Error(`the fingers of the ${this.name} ${asked}, and its rig has no finger bones`)
    return fingers
  }

  /** where a thing sits in the hand by a grip: its middle from the wrist, and its turn, in the frame of the hand hanging straight down */
  sits({ position, quaternion }: Grip) {
    const { hangs, large } = this.lies
    return { at: new Vector3().copy(position).multiplyScalar(large).applyQuaternion(hangs), turned: new Quaternion().copy(quaternion).premultiply(hangs) }
  }

  /** where the wrist is and how the hand is turned on a thing for a grip to hold it, in the thing's frame */
  seats(grip: Grip) {
    if (!this.limb.hand) throw new Error(`the ${this.name} is sent to hold something, and is no hand`)
    const { at, turned } = this.sits(grip)
    const back = turned.clone().invert()
    return { place: at.negate().applyQuaternion(back), turn: back }
  }

  /**
   * the first moment after `after` the end can be at a frame at its ease: within its limb's reach along the ground from
   * where the limb will start, and for a foot, spared by the body; with none in reach, the moment it comes nearest
   */
  first(frame: Frame, after: number) {
    const { body, limb } = this
    const now = body.time()
    const [at, root, unused] = [new Vector3(), new Vector3(), new Vector3()]
    const into = new Quaternion()
    const place = (t: number) => {
      if (frame.on) {
        frame.on.state(t, at, unused, into)
        return at.add(new Vector3().copy(frame.place ?? at).applyQuaternion(into))
      }
      return at.copy(frame.place ?? this.value)
    }
    // (at its ease: pushed a sixth as hard as it can be, which an arm sways in; a strike, half as hard)
    const strikes = frame.velocity && new Vector3().copy(frame.velocity).lengthSq() > 0
    const strength = this.channel.strength * (strikes ? EASE : SWAY)
    const soonest = Math.max(after, now + Math.max(0.5 * body.size.beat, Math.sqrt((6 * place(now).distanceTo(this.value)) / strength)))
    const tried: { t: number; far: number }[] = []
    for (let t = soonest; t < now + LOOK.far * body.size.beat; t += LOOK.fine * body.size.beat) {
      this.root.state(t, root, unused)
      // (a hand's along the ground: how low it is he gets down for; a foot's from its hip)
      const off = place(t).clone().sub(root)
      const far = (this.kind === 'hand' ? Math.hypot(off.x, off.z) : off.length()) - REACH * limb.length
      const spared = this.kind === 'hand' || body.gait.spares(this.side, Math.max(0, t - now - sway(limb) / 2), t - now)
      if (far <= 0 && spared) return t
      tried.push({ t, far })
    }
    // (out of reach all along, the moment it is nearest: for a hand, the first it is about as near as it comes)
    const nearest = Math.min(...tried.map(({ far }) => far)) + (this.kind === 'hand' ? NEAR * limb.length : 0)
    return tried.find(({ far }) => far <= nearest)?.t ?? soonest
  }

  /** cancels what it was sent to: it goes on from the state it is in, a hand swinging on and then the body's */
  cancel() {
    this.on.clear()
    // (one the story does not have yet is only told to set off for nothing)
    if (this.held) this.channel.cancel()
    else this.channel.set(this.channel.value, this.channel.turn)
    this.put = undefined
    this.body.changed()
  }

  shape(pose?: Pose, { by }: { by?: number } = {}): Story<boolean> {
    return this.fingers('are to take a pose').shape(pose, by === undefined ? undefined : by - this.body.time())
  }
}
