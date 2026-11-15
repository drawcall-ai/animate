import { Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import type { Ahead } from './ahead'
import type { Body } from './body'
import { DOWN, FINGERS, type Finger, type Held, type Touch } from './fingers'
import { REST } from './goal'
import type { Give } from './give'
import type { Limb } from './limb'
import type { Mover } from './mover'
import type { Side, Size } from './size'
import { EXACT, UP, type Xyz } from './world'

/**
 * where an end is sent, and how it is to move there: a place `on` him is counted from where its limb starts, as he
 * faces, and one on a thing in its frame. A hand may be turned for its `palm` to face and for what lies `along` a way
 * in it, the fingers unless that is said, to be `pointing` a way, and be sent to be there `with` a part of it other
 * than the wrist: a fingertip, the palm, or a point of what it carries, from the wrist in the frame of the hand. What
 * a hand holds, or what that is part of, may give way to it, a point of that resting in the hand's shoulder
 */
export type Target = {
  place: Vector3
  velocity: Vector3
  on?: 'him' | Object3D
  palm?: Vector3
  pointing?: Vector3
  along?: Vector3
  with?: Finger | 'palm' | Vector3
  gives?: Give
  rests?: Vector3
}
/**
 * what a body's places are told against: what takes the scene to the frame they are told in, the rig, and the bone the
 * limb starts at; the body, which a place is on that is on him; how the bone at the limb's end is turned as the limb
 * hangs straight down, and how large it is; and what a thing that gives way to his hands is to him
 */
export type Rigged = {
  frame: Matrix4
  rig: Object3D
  limb: Object3D
  body: object
  hangs: Quaternion
  large: number
  give(thing: Object3D): Give
}
/** how long a thing is watched for how it moves, at the least (in his beats): updates tell how it moves no finer */
const WATCH = 0.09
const start = new Vector3()
const turned = new Quaternion()
const there = new Vector3()
const carried = new Vector3()
const framed = new Quaternion()
const spun = new Quaternion()
const now = new Vector3()
const matrix = new Matrix4()
const scaled = new Vector3()
const ONE = new Vector3(1, 1, 1)

/**
 * how an end is to arrive: moving so, in the scene, and at a place counted `on` him, from where its limb starts and as
 * he faces, or on a thing, in its frame as it moves; or in the scene
 */
export type Arriving = { velocity?: Xyz; on?: Object3D | Body }
/**
 * and a hand: turned for its `palm` to face and for the fingers, or what it carries, to be `pointing` a way, counted
 * as its place is; the place being that of what it is there `with`, if not its wrist. One that holds a thing has
 * that, or what it is part of, give way to it if it `gives`, and a point of that, in its frame, `rests` in the
 * hand's shoulder
 */
export type Reaching = Arriving & { palm?: Xyz; pointing?: Xyz; with?: Touch; gives?: Object3D; rests?: Xyz }

type Look = { at: Vector3; turned: Quaternion; large: Vector3; time: number }
type Seen = Look & { thing: Object3D; was: Look; past: Look[] }

export const moves = (target: Target) => target.velocity.lengthSq() > 0

/**
 * Where the far end of a limb is sent, as the body will be: from where the limb will start then, its hip or its
 * shoulder, on him as he will face, or on a thing, moving on as it was seen to move.
 */
export class Track {
  /**
   * a thing it is on or sent to, as it was last seen from where its limb starts: where it is there, how it is turned
   * and how large it is, the moment it was seen, and how it was seen before
   */
  protected seen?: Seen

  /**
   * `name` is what it is called when it cannot do what is asked of it: the foot or the hand of a side, at the end of
   * a `limb`, on a body of a `size` whose places are told against its `rig`, which the `mover` carries and is looked
   * ahead along by `ahead`
   */
  constructor(
    protected readonly name: string,
    protected readonly kind: 'foot' | 'hand',
    readonly side: Side,
    protected readonly limb: Limb,
    protected readonly mover: Mover,
    protected readonly ahead: Ahead,
    protected readonly size: Size,
    protected readonly rig: Rigged,
  ) {}

  /** where the limb starts `seconds` from now, its hip or its shoulder, and how that is turned */
  protected root(seconds: number, at: Vector3, turned: Quaternion) {
    const { ahead, side } = this
    return this.kind === 'foot' ? ahead.hip(side, seconds, at, turned) : ahead.shoulder(side, seconds, at, turned)
  }

  /**
   * where a target is `seconds` from now, and how what is said of it is turned, `ways`: a place on him goes with the
   * way he faces, and one on a thing is where the thing is from where the limb starts, moving on there as it was seen
   * to until now, and for an end that stays on it, on until then
   */
  protected where(target: Target & { there?: boolean }, seconds: number, ways = framed) {
    const { place, on } = target
    if (on instanceof Object3D && target.gives) {
      // (what gives way to the hands is where they are sent to have it, carried on with him)
      target.gives.at(on, seconds, matrix).decompose(now, ways, scaled)
      return there.copy(place).applyMatrix4(matrix)
    }
    if (on instanceof Object3D) {
      const { at, turned: held, large, time, was } = this.seen?.thing === on ? this.seen : this.see(on)
      // (on as it went from how it was seen before to how it is: for as long again as that took, as far again)
      const gone = this.ahead.now - time + (target.there ? seconds : 0)
      const again = was.time < time ? 1 + gone / (time - was.time) : 1
      now.lerpVectors(was.at, at, again)
      spun.slerpQuaternions(was.turned, held, again)
      this.root(seconds, start, turned)
      ways.copy(turned).multiply(spun)
      return there
        .copy(place)
        .applyMatrix4(matrix.compose(now, spun, large))
        .applyQuaternion(turned)
        .add(start)
    }
    if (!on) {
      ways.identity()
      return there.copy(place)
    }
    ways.setFromAxisAngle(UP, this.ahead.facing(seconds))
    return this.root(seconds, there, turned).add(carried.copy(place).applyQuaternion(ways))
  }

  /**
   * Looks at a thing from where the limb starts now, and tells how it was seen before: as long ago as it has been
   * watched for, back to a watch ago, as updates tell how it moves no finer
   */
  protected see(thing: Object3D) {
    this.inScene(thing)
    thing.updateWorldMatrix(true, false)
    this.root(0, start, turned)
    const look = { at: new Vector3(), turned: new Quaternion(), large: new Vector3(), time: this.ahead.now }
    matrix.compose(start, turned, ONE).invert().multiply(this.rig.frame).multiply(thing.matrixWorld)
    matrix.decompose(look.at, look.turned, look.large)
    const before = this.seen?.thing === thing ? this.seen.past : []
    const past = before.filter(({ time }) => time >= look.time - WATCH * this.size.beat)
    return (this.seen = { ...look, thing, was: past[0] ?? before.at(-1) ?? look, past: [...past, look] })
  }

  protected inScene(thing: Object3D) {
    let top = thing
    for (; top.parent; top = top.parent) {
      if (top === this.rig.limb) throw new Error(`the ${this.name} is sent to a thing that hangs from its own limb`)
    }
    let mine = this.rig.rig
    while (mine.parent) mine = mine.parent
    if (top !== mine) throw new Error(`the ${this.name} is to be on a thing that is not in the scene he is in`)
  }

  protected spot(target: Target, seconds: number) {
    const places = this.where(target, seconds).toArray()
    return `(${places.map((n) => n.toFixed(2)).join(', ')})`
  }

  protected fingers(asked: string) {
    const fingers = this.limb.hand?.fingers
    if (fingers) return fingers
    throw new Error(`the fingers of the ${this.name} ${asked}, and its rig has no finger bones`)
  }

  protected target(
    at: Xyz | Held,
    { velocity: moving = REST, on: told, palm, pointing, with: touch, gives, rests }: Reaching,
  ): Target {
    const on = told === this.rig.body ? 'him' : told
    if (on !== undefined && on !== 'him' && !(on instanceof Object3D)) {
      throw new Error(`the ${this.name} is sent to a place on something that is neither him nor a thing`)
    }
    if (on instanceof Object3D) this.see(on)
    if ('quaternion' in at && (palm || pointing || touch)) {
      throw new Error(
        `the ${this.name} is sent to hold something, which says where it is and how it is turned: leave out \`palm\`, \`pointing\` and \`with\``,
      )
    }
    const holding = 'quaternion' in at ? this.holding(at, on) : { place: new Vector3().copy(at), palm, pointing }
    const [place, velocity] = [holding.place, new Vector3().copy(moving)]
    const ways = [holding.palm, holding.pointing].map((way) => way && new Vector3().copy(way))
    const [faces, points] = ways.map((way) => way?.normalize())
    const across = faces && points ? faces.clone().cross(points).lengthSq() : 1
    const carried = typeof touch === 'object' ? this.framed(touch) : undefined
    const numbers = [place, velocity, ...ways, carried?.at, carried?.along]
    if (!numbers.every((one) => !one || one.toArray().every(Number.isFinite))) {
      throw new Error(`the ${this.name} is sent to a place, to move there, or turned a way, as no numbers say`)
    }
    if (ways.some((way) => way?.lengthSq() === 0) || across < EXACT) {
      throw new Error(
        `the ${this.name} is turned a way that leads nowhere, or to point the way its palm faces: the palm is kept, and the fingers point as near where they are to as is square to it`,
      )
    }
    if (this.kind === 'foot' && !on && place.y < this.size.ankle - 1e-9) {
      throw new Error(
        `the ${this.name} is sent to ${place.y.toFixed(2)} m up, and stands on the ground at ${this.size.ankle.toFixed(2)}`,
      )
    }
    if (on === 'him' && place.length() > this.limb.length) {
      throw new Error(
        `the ${this.name} is to be ${place.length().toFixed(2)} m from where its limb starts, and the limb is ${this.limb.length.toFixed(2)} m long`,
      )
    }
    if (typeof touch === 'string' && ![...FINGERS, 'palm'].includes(touch)) {
      throw new Error(
        `the ${this.name} is sent to be somewhere with its ${touch}, and that is the tip of the ${FINGERS.join(', ')}, the palm, or a thing as it sits in the hand`,
      )
    }
    if (typeof touch === 'string') this.fingers(`are to have the hand somewhere with its ${touch}`)
    if (gives && !(on instanceof Object3D && velocity.lengthSq() === 0 && gives.getObjectById(on.id) === on)) {
      throw new Error(
        `the ${this.name} is to have something give way to it: send it to hold that, or a part of it, and stay there`,
      )
    }
    if (rests && !(gives && this.kind === 'hand')) {
      throw new Error(`the ${this.name} is to have something rest in its shoulder: have that give way to it, a hand`)
    }
    return {
      place,
      velocity,
      on,
      palm: faces,
      pointing: points,
      along: carried?.along,
      with: typeof touch === 'object' ? carried?.at : touch,
      gives: gives && this.rig.give(gives),
      rests: rests && new Vector3().copy(rests),
    }
  }

  /** a thing as it sits in the hand: where it is from the wrist and the way its z goes, in the frame of the hand as it hangs */
  private framed({ position, quaternion }: Held) {
    const { hangs, large } = this.rig
    const turned = new Quaternion().copy(quaternion).premultiply(hangs)
    const at = new Vector3().copy(position).multiplyScalar(large).applyQuaternion(hangs)
    return { at, turned, along: new Vector3(0, 0, 1).applyQuaternion(turned) }
  }

  /**
   * where the wrist is and how the hand is turned, for what a place is counted on, a thing or the frame of the scene
   * or of him, to sit in the hand so: in that frame, and in its lengths
   */
  private holding(held: Held, on?: 'him' | Object3D) {
    const { at, turned } = this.framed(held)
    const hand = this.limb.hand
    if (!hand) throw new Error(`the ${this.name} is sent to hold something, and is no hand`)
    // (a thing's lengths against the body's)
    if (on instanceof Object3D) on.updateWorldMatrix(true, false)
    const large = on instanceof Object3D ? on.getWorldScale(new Vector3()).x * this.rig.frame.getMaxScaleOnAxis() : 1
    const back = turned.clone().invert()
    return {
      place: at.negate().applyQuaternion(back).divideScalar(large),
      palm: hand.palm.clone().applyQuaternion(back),
      pointing: DOWN.clone().applyQuaternion(back),
    }
  }
}
