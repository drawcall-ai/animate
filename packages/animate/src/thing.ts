import { type Grip } from './rig/fingers'
import { type Story, waits } from './story'
import { NEAR } from './rig/limb'
import { Channel, type Frame, type Mover, type Xyz } from '@drawcall/plan'
import { Matrix4, type Object3D, Quaternion, Vector3 } from 'three'
import type { Arriving, End, Hand } from './ends'
import { Watched } from './movers'

/** how a thing is sent: as a hand is, its place and velocity its middle's, `pointing` the way its z goes, and `palm` the way the palm of the first hand on it faces, all counted as its place is */
export type Sending = Arriving & { pointing?: Xyz; palm?: Xyz }

/**
 * What a story or a game has of a thing bound to him: hands go `on` it by grips, as hands are sent, and come `off` it, or it is put `in` a hand at once; it is sent
 * somewhere, or to be somewhere by a moment, as a hand is, and the hands on it come with it; `cancel` stops it where
 * it is; whether it is moved from `outside`, which hands it over to the game or back to the body; whether every hand
 * on it is where it is to be; how fast it moves; and `free` lets it go, every hand on it going on as it was moving,
 * telling how fast it was moving.
 */
export type Thing = Readonly<{
  on(hand: Hand, grip: Grip): Story<boolean>
  in(hand: Hand, grip: Grip): void
  off(hand: Hand): void
  to(place: Xyz, how?: Sending & { seconds?: number }): Story<boolean>
  by(when: number, place: Xyz, how?: Sending): Story<boolean>
  cancel(): void
  readonly there: boolean
  readonly velocity: Vector3
  free(): Vector3
}> & { outside: boolean }

const scale = new Vector3()
const Z = new Vector3(0, 0, 1)

/**
 * A thing bound to him, as a channel: moved by the body, the story writes it frames and every hand on it goes with it,
 * bound where its grip has it; moved from outside, it is watched where the game puts it, and the hands go with that.
 */
export class Bound {
  readonly channel: Channel
  readonly hands: { end: End; grip: Grip }[] = []

  constructor(
    readonly mesh: Object3D,
    outside: boolean,
    private readonly frame: Matrix4,
    private readonly ends: (hand: Hand) => End,
    /** a hand goes onto one thing at a time: what comes off the others as it goes onto this */
    private readonly others: (end: End) => void,
    private readonly him: object,
    private readonly watch: (thing: Object3D) => Mover,
    private readonly now: () => number,
    /** a thing as it is seen to move, looked at only when it is asked to be */
    seen: (thing: Object3D) => Watched,
    private readonly changed: () => void,
    /** has a story played beside the others */
    private readonly play: (story: Story<unknown>) => void,
    /** how hard the arm that moves it pushes, and how far it draws it back */
    { strength, draw }: { strength: number; draw: number },
  ) {
    this.channel = new Channel(mesh.name || 'thing', strength, draw)
    this.watched = seen(mesh)
    this.look()
    this.channel.outside = outside
  }

  /** where it is in the scene, read into its channel in the frame of the body: or where a part of it is */
  look(part = this.mesh, at = new Vector3(), turn = new Quaternion()) {
    part.updateWorldMatrix(true, false)
    part.matrixWorld.clone().premultiply(this.frame).decompose(at, turn, scale)
    if (part !== this.mesh) return
    if (this.channel.outside) {
      this.channel.value.copy(at)
      this.channel.turn.copy(turn)
    } else this.channel.set(at, turn)
  }

  private readonly watched: Watched

  /**
   * moved from outside, it is told where it is a step of his time at a time: looked at once an update, at the moment
   * `time`, and on as it was seen to move until `now`
   */
  follow(time: number, now: number, frame: boolean) {
    if (frame) this.watched.look(time)
    this.watched.state(now, this.channel.value, this.channel.velocity, this.channel.turn)
  }

  /** where its channel has it, written to it in the scene, moved so far `off` that, for where the hand holding it is */
  write(off?: Vector3) {
    if (this.channel.outside) return
    const { mesh } = this
    const at = this.channel.value.clone().add(off ?? new Vector3())
    const world = new Matrix4().compose(at, this.channel.turn, mesh.getWorldScale(scale)).premultiply(this.frame.clone().invert())
    if (mesh.parent) world.premultiply(mesh.parent.matrixWorld.clone().invert())
    world.decompose(mesh.position, mesh.quaternion, mesh.scale)
    mesh.updateMatrixWorld()
  }

  /** the first hand on it: what a place on him and its palm are counted from */
  private get lead() {
    return this.hands[0]
  }

  /**
   * a hand goes onto it by a grip: it is sent to the grip on the thing as the thing is going, arriving as it moves, and
   * from then they are one; one there already is on it at once. Tells whether it got there
   */
  on(hand: Hand, grip: Grip): Story<boolean> {
    const end = this.ends(hand)
    if (this.hands.some((one) => one.end === end && one.grip === grip)) return nothing(true)
    this.others(end)
    // (sent onto it again, it goes there from where it is, not after where it was going)
    if (this.joining.delete(end)) end.channel.cancel('story')
    if (end.channel.bound) end.channel.unbind()
    // (one with no hand on it, not moved from outside, is where it is seen: its grip is counted on it there)
    if (!this.hands.length && !this.channel.outside) this.look()
    const seat = this.seat(end, grip)
    if (end.channel.value.distanceTo(seat.place.clone().applyQuaternion(this.channel.turn).add(this.channel.value)) <= NEAR * end.limb.length) {
      this.bind(end, grip)
      return nothing(true)
    }
    // (on it as the game moves it, it is where it was last told; else as it is seen to go)
    const sent = end.timed({ on: this.channel.outside ? this.channel : this.watch(this.mesh), place: seat.place, turn: seat.turn, by: 'story' }, end.channel)
    void end.write(sent)
    end.close(grip.pose, sent.at - this.now())
    const frame = end.channel.frames.find(({ place }) => place === seat.place)!
    this.joining.set(end, frame)
    const self = this
    this.play(
      (function* () {
        while (end.channel.frames.includes(frame) && self.joining.get(end) === frame) yield
        if (self.joining.get(end) !== frame) return
        self.joining.delete(end)
        if (end.channel.met(frame)) self.bind(end, grip)
      })(),
    )
    return waits(() => this.joining.has(end), () => this.hands.some((one) => one.end === end))
  }

  /** hands on their way to go onto it, and the frames that take them there */
  private readonly joining = new Map<End, Frame>()

  /** where a hand on it by a grip is, and how it is turned, in its frame as it is now: a grip on a part of it is a grip on it, where that part is on it */
  private seat(end: End, grip: Grip) {
    const seat = end.seats(grip)
    const [part, partTurn] = [new Vector3(), new Quaternion()]
    this.look(grip.target, part, partTurn)
    const back = this.channel.turn.clone().invert()
    return { place: seat.place.clone().applyQuaternion(partTurn).add(part).sub(this.channel.value).applyQuaternion(back), turn: back.multiply(partTurn).multiply(seat.turn) }
  }

  /** a hand at its grip is on it from now: the first on a thing the body moves takes it as it is seen to go */
  private bind(end: End, grip: Grip) {
    if (!this.channel.outside && !this.hands.length) {
      this.watched.look(this.now())
      this.watched.state(this.now(), this.channel.value, this.channel.velocity, this.channel.turn)
      this.channel.set(this.channel.value, this.channel.turn)
      this.watched.state(this.now(), new Vector3(), this.channel.velocity)
    }
    const { place, turn } = this.seat(end, grip)
    end.channel.set(place.applyQuaternion(this.channel.turn).add(this.channel.value), this.channel.turn.clone().multiply(turn))
    end.channel.bind(this.channel)
    this.hands.push({ end, grip })
    this.led()
    void end.limb.hand?.fingers?.shape(grip.pose)
    // (and with nowhere to go, it is held where it is, on him as he goes)
    if (!this.channel.busy) this.stay()
    this.changed()
  }

  off(hand: Hand) {
    const end = this.ends(hand)
    if (this.joining.delete(end)) end.cancel()
    const k = this.hands.findIndex((one) => one.end === end)
    if (k < 0) return
    this.hands.splice(k, 1)
    end.channel.unbind()
    this.led()
    this.changed()
  }

  /** it swings round the shoulder of the arm that leads it, as that hand would */
  private led() {
    this.channel.pivot = this.lead?.end.channel.pivot
  }

  /** the frame that has it where a statement says: turned for its z to point and the first hand's palm to face as said */
  private framed(place: Xyz, { on, velocity, pointing, palm }: Sending): Frame {
    const lead = this.lead?.end
    const mover = on === this.him ? lead?.root : on ? this.watch(on as Object3D) : undefined
    const into = new Quaternion()
    mover?.state(this.now(), new Vector3(), new Vector3(), into)
    let turn = into.clone().invert().multiply(this.channel.turn)
    if (pointing) turn = new Quaternion().setFromUnitVectors(Z.clone().applyQuaternion(turn), new Vector3().copy(pointing).normalize()).multiply(turn)
    if (palm && lead) {
      const hand = lead.limb.hand!
      const faces = hand.palm.clone().applyQuaternion(turn.clone().multiply(lead.seats(this.lead.grip).turn))
      const want = new Vector3().copy(palm).normalize()
      // (with a way to point said, the palm is turned to face as said about that way)
      const axis = pointing ? new Vector3().copy(pointing).normalize() : undefined
      const flat = (way: Vector3) => (axis ? way.clone().addScaledVector(axis, -way.dot(axis)).normalize() : way)
      turn = new Quaternion().setFromUnitVectors(flat(faces), flat(want)).multiply(turn)
    }
    const frame: Frame = { on: mover, place: new Vector3().copy(place), turn, velocity, by: 'story' }
    // (a fast thing swings round the shoulder of the arm that leads it; it is turned as it is sent, the wrist turning it there)
    if (velocity && new Vector3().copy(velocity).lengthSq() > 0 && lead) frame.about = lead.root
    return frame
  }

  to(place: Xyz, { seconds, ...how }: Sending & { seconds?: number } = {}) {
    return this.send(place, how, { seconds })
  }

  by(when: number, place: Xyz, how: Sending = {}) {
    return this.send(place, how, { by: when })
  }

  /** sends it, the body's from now: as the first hand on it would be sent, so it is planned as the end of that arm; sent while that hand is on its way to it, once it has it */
  private send(place: Xyz, how: Sending, when: { seconds?: number; by?: number }): Story<boolean> {
    // (sent, one moved from outside with a hand on it is the body's from now)
    if (this.hands.length || this.joining.size) this.outside = false
    if (this.channel.outside) return nothing()
    if (this.lead) return this.sent(place, how, when)
    let written: Story<boolean> | undefined
    const self = this
    this.play(
      (function* () {
        while (!self.lead && self.joining.size) yield
        if (self.lead) written = self.sent(place, how, when)
      })(),
    )
    return (function* () {
      while (!written && self.joining.size) yield
      return written ? yield* written : false
    })()
  }

  private sent(place: Xyz, how: Sending, when: { seconds?: number; by?: number }) {
    const written = this.channel.by(this.lead!.end.timed(this.framed(place, how), this.channel, when))
    this.changed()
    return this.met(written)
  }

  /** it is in a hand from now, by a grip, as the hand is, or the hand on it as it is, moved from outside: for a thing he has from the start */
  in(hand: Hand, grip: Grip) {
    const end = this.ends(hand)
    const { place, turn } = this.seat(end, grip)
    if (this.channel.outside) end.channel.set(place.applyQuaternion(this.channel.turn).add(this.channel.value), this.channel.turn.clone().multiply(turn))
    else {
      for (const { end: other } of this.hands.splice(0)) other.channel.unbind()
      const thing = end.channel.turn.clone().multiply(turn.clone().invert())
      this.channel.set(end.channel.value.clone().sub(place.applyQuaternion(thing)), thing)
      this.write()
    }
    void this.on(hand, grip)
  }

  private *met(frame: Frame): Story<boolean> {
    while (this.channel.frames.includes(frame)) yield
    return this.channel.met(frame) && this.there
  }

  /** it goes on from the state it is in: moving, it swings on; at rest, it is held where it is, on him as he goes */
  cancel() {
    this.channel.cancel()
    if (!this.channel.busy) this.stay()
  }

  /** held where it is now, on him as he goes */
  stay() {
    const lead = this.lead?.end
    if (!lead || this.channel.outside) return
    const [at, into] = [new Vector3(), new Quaternion()]
    lead.root.state(this.now(), at, new Vector3(), into)
    const back = into.clone().invert()
    this.channel.by({ at: lead.moment(this.now()), on: lead.root, place: this.channel.value.clone().sub(at).applyQuaternion(back), turn: back.multiply(this.channel.turn), by: 'story' })
    this.changed()
  }

  get outside() {
    return this.channel.outside
  }

  set outside(to: boolean) {
    if (to === this.channel.outside) return
    this.channel.outside = to
    this.look()
    if (!to) this.stay()
    this.changed()
  }

  get there() {
    return !this.joining.size && this.hands.every(({ end }) => end.gap <= 0.05)
  }

  get velocity() {
    return this.channel.velocity.clone().transformDirection(this.frame.clone().invert()).multiplyScalar(this.channel.velocity.length())
  }

  /** let go: every hand on it goes on as it was moving, and it is moved from outside from now. Tells how fast it moves */
  free() {
    for (const end of this.joining.keys()) end.cancel()
    this.joining.clear()
    for (const { end } of this.hands.splice(0)) end.channel.unbind()
    this.channel.outside = true
    this.changed()
    return this.velocity
  }
}

/** a story over at once, that came to something or nothing */
function* nothing(done = false): Story<boolean> {
  return done
}
