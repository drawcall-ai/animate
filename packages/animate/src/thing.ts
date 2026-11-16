import { type Grip, type Story, type Xyz } from '@drawcall/limbs'
import { Channel, type Frame, type Mover } from '@drawcall/plan'
import { Matrix4, type Object3D, Quaternion, Vector3 } from 'three'
import type { Arriving, End, Hand } from './ends'
import { Watched } from './movers'

/** how a thing is sent: as a hand is, its place and velocity its middle's, `pointing` the way its z goes, and `palm` the way the palm of the first hand on it faces, all counted as its place is */
export type Sending = Arriving & { pointing?: Xyz; palm?: Xyz }

/**
 * What a story or a game has of a thing bound to him: hands go `on` it by grips and come `off` it; it is sent
 * somewhere, or to be somewhere by a moment, as a hand is, and the hands on it come with it; `cancel` stops it where
 * it is; whether it is moved from `outside`, which hands it over to the game or back to the body; whether every hand
 * on it is where it is to be; how fast it moves; and `free` lets it go, every hand on it going on as it was moving,
 * telling how fast it was moving.
 */
export type Thing = Readonly<{
  on(hand: Hand, grip: Grip): void
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
    private readonly changed: () => void,
    /** how hard the arm that moves it pushes, and how far it draws it back */
    { strength, draw }: { strength: number; draw: number },
  ) {
    this.channel = new Channel(mesh.name || 'thing', strength, draw)
    this.watched = new Watched(mesh, frame)
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

  on(hand: Hand, grip: Grip) {
    const end = this.ends(hand)
    this.others(end)
    const seat = end.seats(grip)
    // (a grip on a part of it is a grip on it, where that part is on it)
    const [part, partTurn] = [new Vector3(), new Quaternion()]
    this.look(grip.target, part, partTurn)
    const back = this.channel.turn.clone().invert()
    const place = seat.place.clone().applyQuaternion(partTurn).add(part).sub(this.channel.value).applyQuaternion(back)
    const turn = back.multiply(partTurn).multiply(seat.turn)
    // (the first hand on a thing the body moves has it where the grip seats it, and every other goes onto its grip on it)
    if (!this.channel.outside && this.hands.length === 0) {
      const thing = end.channel.turn.clone().multiply(turn.clone().invert())
      this.channel.set(end.channel.value.clone().sub(place.clone().applyQuaternion(thing)), thing)
      this.write()
    }
    end.channel.set(place.clone().applyQuaternion(this.channel.turn).add(this.channel.value), this.channel.turn.clone().multiply(turn))
    end.channel.bind(this.channel)
    this.hands.push({ end, grip })
    void end.limb.hand?.fingers?.shape(grip.pose)
    this.changed()
  }

  off(hand: Hand) {
    const end = this.ends(hand)
    const k = this.hands.findIndex((one) => one.end === end)
    if (k < 0) return
    this.hands.splice(k, 1)
    end.channel.unbind()
    this.changed()
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
    const frame: Frame = { on: mover, place, turn, velocity, by: 'story' }
    // (a fast thing swings round the shoulder of the arm that leads it; it is turned as it is sent, the wrist turning it there)
    if (velocity && new Vector3().copy(velocity).lengthSq() > 0 && lead) frame.about = lead.root
    return frame
  }

  /** sends it: as the first hand on it would be sent, so it is planned as the end of that arm */
  send(place: Xyz, how: Sending, when: { seconds?: number; by?: number }): Story<boolean> {
    const lead = this.lead?.end
    if (!lead || this.channel.outside) return nothing()
    const frame = this.framed(place, how)
    const after = Math.max(this.now(), ...this.channel.frames.map((one) => one.at ?? 0))
    frame.at = lead.moment(when.by !== undefined ? Math.max(when.by, after) : when.seconds !== undefined ? after + when.seconds : lead.first(frame, after))
    frame.leaves = lead.leaves(frame, when.by !== undefined)
    const written = this.channel.by(frame)
    this.changed()
    return this.met(written)
  }

  private *met(frame: Frame): Story<boolean> {
    while (this.channel.frames.includes(frame)) yield
    return this.channel.met(frame) && this.there
  }

  /** it stops where it is, held there on him as he goes */
  cancel() {
    this.channel.set(this.channel.value.clone(), this.channel.turn.clone())
    this.stay()
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
    return this.hands.every(({ end }) => end.gap <= 0.05)
  }

  get velocity() {
    return this.channel.velocity.clone().transformDirection(this.frame.clone().invert()).multiplyScalar(this.channel.velocity.length())
  }

  /** let go: every hand on it goes on as it was moving, and it is moved from outside from now. Tells how fast it moves */
  free() {
    for (const { end } of this.hands.splice(0)) end.channel.unbind()
    this.channel.outside = true
    this.changed()
    return this.velocity
  }

  /** what a story or a game has of it */
  facade(): Thing {
    const self = this
    return {
      on: (hand, grip) => this.on(hand, grip),
      off: (hand) => this.off(hand),
      to: (place, { seconds, ...how } = {}) => this.send(place, how, { seconds }),
      by: (when, place, how = {}) => this.send(place, how, { by: when }),
      cancel: () => this.cancel(),
      get there() {
        return self.there
      },
      get velocity() {
        return self.velocity
      },
      free: () => this.free(),
      get outside() {
        return self.outside
      },
      set outside(to) {
        self.outside = to
      },
    }
  }
}

/** a story over at once that came to nothing */
function* nothing(): Story<boolean> {
  return false
}
