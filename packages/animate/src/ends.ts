import { DOWN, EXACT, type Grip, type Limb, type Pose, type Side, type Size, SLACK, type Story, sway, tick, type Touch, waits, type Xyz } from '@drawcall/limbs'
import type { Carrier } from '@drawcall/locomotion'
import { Channel, type Frame, type Mover } from '@drawcall/plan'
import { Matrix4, type Object3D, Quaternion, Vector3 } from 'three'
import type { OnHim } from './movers'

/**
 * how strong a hand and a foot are, how hard they can be pushed along at the most (in his paces a beat), and how far
 * each draws back before a fast arrival at the most (in lengths of its limb)
 */
const END = { hand: { strength: 15, draw: 0.5 }, foot: { strength: 25, draw: 0.6 } }
/** how far ahead the first moment a limb can reach something is looked for, and how finely (in his beats) */
const LOOK = { far: 10, fine: 0.1 }
/** how many times as long as the limb sways a fast arrival by a moment given well ahead swings for, drawn back first */
const SWING = 1.4
/** how far a fast arrival draws back is `velocity × swing × 4/27` */
const DRAW = 27 / 4
/** how far a limb draws its end back before a fast arrival at the most: in along itself, in lengths of it, and round its first joint, in radians */
const DRAWS = { in: 0.5, round: 1.2 }
/** how much of its length a limb reaches at its ease */
const EASE = 0.97

/** a place counted `on` him, from where the limb starts and as he faces, or on a thing, in its frame as it moves */
export type On = { on?: Object3D | object }
/** how an end is to arrive: moving so, in the scene, at a place counted `on` him or a thing */
export type Arriving = On & { velocity?: Xyz }
/**
 * and a hand: turned for its `palm` to face and its fingers to be `pointing` a way, counted as its place is; the place
 * being that of what it is there `with`, if not its wrist: a part of it, or what sits in it by a grip
 */
export type Reaching = Arriving & { palm?: Xyz; pointing?: Xyz; with?: Touch | Grip }

/** What a story has of a hand: where its wrist is and how it moves, whether it is where it was sent, and to send it, have it somewhere by a moment, shape its fingers, cancel what it was sent to, or give it back to the body. */
export type Hand = Readonly<{
  value: Vector3
  velocity: Vector3
  there: boolean
  to(place: Xyz | Grip, how?: Reaching & { seconds?: number }): Story<boolean>
  by(when: number, place: Xyz | Grip, how?: Reaching): Story<boolean>
  shape(pose?: Pose, how?: { by?: number }): Story<boolean>
  cancel(): void
  free(): void
}>
/** What a story has of a foot: where its ankle is and how it moves, where the ground holds it, and to send it, have it somewhere by a moment, cancel what it was sent to, or give it back to the body. */
export type Foot = Readonly<{
  value: Vector3
  velocity: Vector3
  anchor?: Vector3
  to(place: Xyz, how?: Arriving & { seconds?: number }): Story<boolean>
  by(when: number, place: Xyz, how?: Arriving): Story<boolean>
  cancel(): void
  free(): void
}>

/** what an end needs of the body: its size, clock and carrier, the body that a place `on` him names, and what a thing is as a frame moves on */
export type Body = {
  size: Size
  carrier: Carrier
  him: object
  time(): number
  mover(thing: Object3D): Mover
  /** the frame the body's places are told in: what takes the scene to it */
  frame: Matrix4
  /** a frame was written or cancelled: what the hands ask of the rest of him may have changed */
  changed(): void
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
 * sent elsewhere, cancelled or let `free`.
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
    this.channel = new Channel(`${side} ${kind}`, (strength * pace) / beat, draw * limb.length)
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
    // (as of the step being made, which ends a step of his time after his clock)
    return channel.holding || (channel.busy && (off === undefined || off <= this.body.time() + tick(this.body.size) + EXACT))
  }

  /** whether it is where it was last sent, as near as an end counts as there */
  get there() {
    const { channel } = this
    const bound = channel.busy && !channel.frames.length
    return (channel.holding || bound) && this.gap <= SLACK.place * this.body.size.leg
  }

  /** sends the end somewhere: in `seconds`, by a moment, or at the first moment the body lets it be there */
  send(place: Xyz | Grip, how: Reaching = {}, when?: { seconds?: number; by?: number }): Story<boolean> {
    // a foot sent to rest on the ground, or on a thing, stands there: the body steps there with it
    const moving = how.velocity && new Vector3().copy(how.velocity).lengthSq() > 0
    const ground = !how.on && 'y' in place && place.y <= this.body.carrier.ground + this.body.size.ankle + EXACT
    if (this.kind === 'foot' && 'y' in place && !moving && (ground || (how.on && how.on !== this.body.him))) {
      return this.step(this.scene(place, how.on as Object3D | undefined), when?.seconds)
    }
    const frame = this.frame(place, how)
    const after = Math.max(this.body.time(), ...this.channel.frames.filter((one) => one.by === 'story').map((one) => one.at ?? 0))
    frame.at = when?.by !== undefined ? Math.max(when.by, after) : when?.seconds !== undefined ? after + when.seconds : this.first(frame, after)
    frame.leaves = this.leaves(frame, when?.by !== undefined)
    // (a grip is handed over whole: the fingers close as it has them, by the moment the hand is on the thing)
    if ('target' in place) this.close(place.pose, frame.at - this.body.time())
    return this.write(frame)
  }

  /**
   * when it sets off for a frame: a fast arrival by a moment given well ahead swings for as long as the limb sways
   * there and back, drawn back first; one at the first moment it can for half that, a short wind-up; a foot steps
   * off for half that; and one at rest as late as it can at its ease
   */
  leaves(frame: Frame, given: boolean) {
    const velocity = new Vector3().copy(frame.velocity ?? { x: 0, y: 0, z: 0 })
    const at = frame.at ?? 0
    if (velocity.lengthSq() === 0 && this.kind === 'hand') return undefined
    let swing = sway(this.limb) * (given && this.kind === 'hand' ? SWING : 0.5)
    // (a hand swings round its shoulder as far as it likes, but draws in along its arm only so far: it sets off no
    // sooner than draws it back so far either way, `velocity × swing × 4/27`)
    const [root, moving, place, into] = [new Vector3(), new Vector3(), new Vector3(), new Quaternion()]
    this.root.state(at, root, moving)
    if (frame.on) frame.on.state(at, place, new Vector3(), into)
    place.add(new Vector3().copy(frame.place ?? { x: 0, y: 0, z: 0 }).applyQuaternion(into))
    const out = place.sub(root)
    const far = Math.max(out.length(), 1e-6)
    velocity.sub(moving)
    const along = Math.abs(velocity.dot(out)) / far
    const round = Math.sqrt(Math.max(0, velocity.lengthSq() - along * along))
    const { length } = this.limb
    if (along > 0) swing = Math.min(swing, (DRAW * DRAWS.in * length) / along)
    if (round > 0) swing = Math.min(swing, (DRAW * DRAWS.round * far) / round)
    return at - swing
  }

  /** writes a frame the story has sent: it is the story's from when it sets off; tells whether it was there at its moment */
  write(frame: Frame): Story<boolean> {
    const written = this.channel.by(frame)
    const tip = this.tips.get(frame)
    if (tip) this.tips.set(written, tip)
    const moving = frame.velocity && new Vector3().copy(frame.velocity).lengthSq() > 0
    if (this.kind === 'foot') this.body.carrier.take(this.side, { from: frame.leaves ?? this.body.time(), until: moving ? (frame.at ?? Infinity) : Infinity })
    this.body.carrier.stale()
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

  /** the body steps with the foot to a place it stands on, in so many `seconds` or as soon as it can, and stands over it there: over once it is down there */
  private step(place: Vector3, seconds?: number): Story<boolean> {
    this.cancel()
    const { carrier } = this.body
    const put = carrier.put(this.side, place, seconds)
    carrier.stale()
    const foot = carrier.foot(this.side)
    return waits(
      () => foot.put === put,
      () => foot.down && put !== undefined && foot.at.distanceTo(put) < EXACT,
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
    return this.channel.met(frame) && this.gap <= SLACK.place * this.body.size.leg
  }

  /** the part of the hand it was last sent with, if not its wrist: the arm puts that part where the wrist's plan has it */
  part?: Touch

  /** where the part it was sent with is from the wrist now, in the frame of the hand: none, sent with the wrist */
  offset() {
    return this.part ? this.fingers().tip(this.part, 0) : undefined
  }

  /** the frames it was sent with a fingertip, the palm or the knuckles: that part, where it is to be and how the hand is turned */
  private readonly tips = new WeakMap<Frame, { part: Touch; at: Vector3; turn: Quaternion }>()

  /** the wrist of every frame sent with a part of the hand is where that part will be at the frame's moment, the fingers as they will be then */
  retip() {
    for (const frame of this.channel.frames) {
      const tip = this.tips.get(frame)
      if (!tip || !frame.place) continue
      const offset = this.fingers().tip(tip.part, Math.max(0, (frame.at ?? 0) - this.body.time()))
      ;(frame.place as Vector3).copy(tip.at).sub(offset.applyQuaternion(tip.turn))
    }
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
    if (this.kind === 'foot' && !mover) there.y = Math.max(there.y, this.body.carrier.ground + this.body.size.ankle)
    const ways = [palm, pointing].map((way) => way && new Vector3().copy(way))
    if (ways.some((way) => way && way.lengthSq() < EXACT)) throw new Error(`the ${this.name} is turned a way that leads nowhere`)
    // (said in the frame of what the place is on: the hand as it is now, told the same way)
    const into = new Quaternion()
    if (mover) mover.state(this.body.time(), new Vector3(), new Vector3(), into)
    const now = into.clone().invert().multiply(this.channel.turn)
    // (told nothing of how it is turned, or only how the palm faces, the fingers point on along the arm, as from its shoulder to the place)
    const along = !ways[1] ? this.along(there, mover, into) : undefined
    const turn = hand ? turnOf(ways[0], ways[1] ?? along, hand.palm, now) : undefined
    // (sent with a part of the hand, or what sits in it by a grip, the wrist is where that has it there)
    const offset = part && hand ? (typeof part === 'string' ? this.fingers().tip(part, 0) : this.sits(part).at) : undefined
    const at = there.clone()
    if (offset) there.sub(offset.applyQuaternion(turn ?? now))
    const frame: Frame = { on: mover, place: there, turn, velocity, by: 'story' }
    // (sent with a fingertip, the wrist is put anew each step for where that finger will be at the moment)
    if (typeof part === 'string') this.tips.set(frame, { part, at, turn: (turn ?? now).clone() })
    this.part = typeof part === 'string' ? part : undefined
    const speed = velocity ? new Vector3().copy(velocity) : undefined
    if (speed && speed.lengthSq() > 0) {
      // a fast end swings round where its limb starts, and a hand's wrist whips on with it: the fingers led into the way it goes
      frame.about = this.root
      if (hand) {
        const fingers = DOWN.clone().applyQuaternion(into.clone().multiply(turn ?? now))
        frame.spin = fingers.cross(speed).divideScalar(this.body.size.forearm)
      }
    }
    return frame
  }

  /** the fingers take a pose in so many seconds, or as soon as they can if that is too soon */
  private close(pose: Pose, seconds: number) {
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
    const at = mover ? new Vector3().copy(place).applyQuaternion(into).add(this.moverAt(mover)) : place.clone()
    const way = at.sub(root)
    return way.lengthSq() > EXACT ? way.applyQuaternion(into.clone().invert()).normalize() : undefined
  }

  private moverAt(mover: Mover) {
    const at = new Vector3()
    mover.state(this.body.time(), at, new Vector3())
    return at
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
    // (at its ease: pushed a sixth as hard as it can be, which an arm sways in)
    const strength = this.channel.strength / 6
    const soonest = Math.max(after, now + Math.max(0.5 * body.size.beat, Math.sqrt((6 * place(now).distanceTo(this.value)) / strength)))
    let best = { t: soonest, far: Infinity }
    for (let t = soonest; t < now + LOOK.far * body.size.beat; t += LOOK.fine * body.size.beat) {
      this.root.state(t, root, unused)
      // (along the ground: how low it is he gets down for)
      const far = Math.hypot(place(t).x - root.x, place(t).z - root.z) - EASE * limb.length
      const spared = this.kind === 'hand' || body.carrier.spare(this.side, Math.max(0, t - now - sway(limb) / 2), t - now)
      if (far <= 0 && spared) return t
      if (far < best.far) best = { t, far }
    }
    return best.t
  }

  /** cancels what it was sent to: it goes on from the state it is in, a hand swinging on and then the body's */
  cancel() {
    this.on.clear()
    this.part = undefined
    // (one the story does not have yet is only told to set off for nothing)
    if (this.held) this.channel.cancel()
    else this.channel.set(this.channel.value, this.channel.turn)
    if (this.kind === 'foot') this.body.carrier.take(this.side, undefined)
    this.body.carrier.stale()
    this.body.changed()
  }

  free() {
    this.cancel()
  }

  shape(pose?: Pose, { by }: { by?: number } = {}): Story<boolean> {
    return this.fingers('are to take a pose').shape(pose, by === undefined ? undefined : by - this.body.time())
  }
}
