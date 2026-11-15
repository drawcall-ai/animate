import { Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import type { Carrier } from './carrier'
import { DOWN, FINGERS, type Grip, type Touch } from './fingers'
import { REST } from './goal'
import type { Give } from './give'
import type { Limb } from './limb'
import type { Side, Size } from './size'
import { EXACT, UP, type Xyz } from './world'

/**
 * where an end is sent, and how it is to move there: a place `on` him is counted from where its limb starts, as he
 * faces, and one on a thing in its frame. A hand may be turned for its `palm` to face and its fingers to be `pointing`
 * a way, and be sent to be there `with` a part of it other than the wrist: a fingertip, the palm, the knuckles or a
 * point of what it carries, from the wrist in the frame of the hand as it hangs. A
 * hand may be sent by a `grip` to hold what it is on, which `gives` way to it if he holds that; or to have what he
 * holds, which it `carries`, at a `pose`: its origin at a place and turned so, counted as the place is
 */
export type Target = {
  place: Vector3
  velocity: Vector3
  on?: 'him' | Object3D
  palm?: Vector3
  pointing?: Vector3
  with?: Touch | Vector3
  grip?: Grip
  gives?: Give
  carries?: Give
  pose?: { at: Vector3; turn: Quaternion }
}
/**
 * what a body's places are told against: what takes the scene to the frame they are told in, the rig, and the bone the
 * limb starts at; the body, which a place is on that is on him; how the bone at the limb's end is turned as the limb
 * hangs straight down, and how large it is; and the thing he holds that a part is, or is part of, if he holds one
 */
export type Rigged = {
  frame: Matrix4
  rig: Object3D
  limb: Object3D
  body: object
  hangs: Quaternion
  large: number
  held(part: Object3D): Give | undefined
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
const FORWARD = new Vector3(0, 0, 1)

/**
 * how an end is to arrive: moving so, in the scene, and at a place counted `on` him, from where its limb starts and as
 * he faces, or on a thing, in its frame as it moves; or in the scene
 */
export type Arriving = { velocity?: Xyz; on?: object }
/**
 * and a hand: turned for its `palm` to face and for the fingers to be `pointing` a way, counted as its place is; the
 * place being that of what it is there `with`, if not its wrist: a part of it, or what sits in it by a grip
 */
export type Reaching = Arriving & { palm?: Xyz; pointing?: Xyz; with?: Touch | Grip }
/**
 * how a thing he holds is to arrive: as a hand does, its z `pointing` a way and its y `up`, or the `palm` of the hand
 * that carries it facing a way, counted as its place is
 */
export type Carrying = Arriving & { pointing?: Xyz; up?: Xyz; palm?: Xyz }

/** how a thing was seen at a moment: from where the limb starts, and in the scene */
type Pose = { at: Vector3; turned: Quaternion }
type Look = Pose & { large: Vector3; time: number; scene: Pose }
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
   * a `limb`, on a body of a `size` whose places are told against its `rig`, which the rest of the body,
   * its `carrier`, carries
   */
  constructor(
    readonly name: string,
    protected readonly kind: 'foot' | 'hand',
    readonly side: Side,
    protected readonly limb: Limb,
    protected readonly carrier: Carrier,
    protected readonly size: Size,
    protected readonly rig: Rigged,
  ) {}

  /** where the limb starts `seconds` from now, its hip or its shoulder, and how that is turned */
  protected root(seconds: number, at: Vector3, turned: Quaternion) {
    const { carrier, side } = this
    return this.kind === 'foot' ? carrier.hip(side, seconds, at, turned) : carrier.shoulder(side, seconds, at, turned)
  }

  /**
   * where a target is `seconds` from now, and how what is said of it is turned, `ways`: a place on him goes with the
   * way he faces, and one on a thing is where the thing is, moving on as it was seen to until now: in the scene, or
   * from where the limb starts if it moved less so, as what he carries does, and for an end that stays on it on until then. What gives way to the hands may be told where it is
   * `drawn` instead
   */
  protected where(target: Target & { there?: boolean }, seconds: number, ways = framed, drawn = false) {
    const { place, on } = target
    if (on instanceof Object3D && target.gives?.held) {
      // (what gives way to the hands is where they are sent to have it, carried on with him: or where it is drawn)
      ;(drawn ? target.gives.drawn(on, matrix) : target.gives.at(on, seconds, matrix)).decompose(now, ways, scaled)
      return there.copy(place).applyMatrix4(matrix)
    }
    if (on instanceof Object3D) {
      const { at, turned: held, large, time, was, scene } = this.seen?.thing === on ? this.seen : this.see(on)
      // (on as it went from how it was seen before to how it is: for as long again as that took, as far again)
      const gone = this.carrier.now - time + (target.there ? seconds : 0)
      const again = was.time < time ? 1 + gone / (time - was.time) : 1
      if (was.scene.at.distanceTo(scene.at) <= was.at.distanceTo(at)) {
        now.lerpVectors(was.scene.at, scene.at, again)
        ways.slerpQuaternions(was.scene.turned, scene.turned, again)
        return there.copy(place).applyMatrix4(matrix.compose(now, ways, large))
      }
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
    ways.setFromAxisAngle(UP, this.carrier.facing(seconds))
    return this.root(seconds, there, turned).add(carried.copy(place).applyQuaternion(ways))
  }

  /**
   * Looks at a thing from where the limb starts now, and in the scene, and tells how it was seen before: as long ago as it has been
   * watched for, back to a watch ago, as updates tell how it moves no finer
   */
  protected see(thing: Object3D) {
    for (let on: Object3D | null = thing; on; on = on.parent) {
      if (on === this.rig.limb) throw new Error(`the ${this.name} is sent to a thing that hangs from its own limb`)
    }
    thing.updateWorldMatrix(true, false)
    this.root(0, start, turned)
    const scene = { at: new Vector3(), turned: new Quaternion() }
    const look = { at: new Vector3(), turned: new Quaternion(), large: new Vector3(), time: this.carrier.now, scene }
    matrix.multiplyMatrices(this.rig.frame, thing.matrixWorld).decompose(scene.at, scene.turned, scaled)
    matrix.compose(start, turned, ONE).invert().multiply(this.rig.frame).multiply(thing.matrixWorld)
    matrix.decompose(look.at, look.turned, look.large)
    const before = this.seen?.thing === thing ? this.seen.past : []
    const past = before.filter(({ time }) => time >= look.time - WATCH * this.size.beat)
    return (this.seen = { ...look, thing, was: past[0] ?? before.at(-1) ?? look, past: [...past, look] })
  }

  /** a thing is in his scene by the time he moves, whenever it was added to it */
  protected inScene(thing: Object3D) {
    const top = (on: Object3D): Object3D => (on.parent ? top(on.parent) : on)
    if (top(thing) !== top(this.rig.rig)) {
      throw new Error(`the ${this.name} is to be on a thing that is not in the scene he is in`)
    }
  }

  protected fingers(asked: string) {
    const fingers = this.limb.hand?.fingers
    if (fingers) return fingers
    throw new Error(`the fingers of the ${this.name} ${asked}, and its rig has no finger bones`)
  }

  protected target(at: Xyz | Grip, { velocity: moving = REST, on: told, palm, pointing, with: touch }: Reaching): Target {
    const grip = 'target' in at ? at : undefined
    const on = grip ? grip.target : told === this.rig.body ? 'him' : told
    if (on !== undefined && on !== 'him' && !(on instanceof Object3D)) {
      throw new Error(`the ${this.name} is sent to a place on something that is neither him nor a thing`)
    }
    if (on instanceof Object3D) this.see(on)
    if (grip && (palm || pointing || touch)) {
      throw new Error(
        `the ${this.name} is sent to hold something by a grip, which says where it is and how it is turned: leave out \`palm\`, \`pointing\` and \`with\``,
      )
    }
    const sits = 'target' in at ? this.gripped(at, at.target) : { place: new Vector3().copy(at), palm, pointing }
    const [place, velocity] = [sits.place, new Vector3().copy(moving)]
    const ways = [sits.palm, sits.pointing].map((way) => way && new Vector3().copy(way))
    const [faces, points] = ways.map((way) => way?.normalize())
    const across = faces && points ? faces.clone().cross(points).lengthSq() : 1
    if (![place, velocity, ...ways].every((one) => !one || one.toArray().every(Number.isFinite))) {
      throw new Error(`the ${this.name} is sent to a place, to move there, or turned a way, as no numbers say`)
    }
    if (ways.some((way) => way?.lengthSq() === 0) || across < EXACT) {
      throw new Error(
        `the ${this.name} is turned a way that leads nowhere, or to point the way its palm faces: the palm is kept, and the fingers point as near where they are to as is square to it`,
      )
    }
    // (a foot goes no lower than it stands on the ground)
    if (this.kind === 'foot' && !on) place.y = Math.max(place.y, this.size.ankle)
    // (with a grip, the place is that of what sits in the hand by it: where it is from the wrist)
    const part = typeof touch === 'object' ? this.framed(touch).at : touch
    if (typeof part === 'string' && ![...FINGERS, 'palm', 'knuckles'].includes(part)) {
      throw new Error(
        `the ${this.name} is sent to be somewhere with its ${part}, and that is the tip of the ${FINGERS.join(', ')}, the palm or the knuckles, or what sits in it by a grip`,
      )
    }
    if (typeof part === 'string') this.fingers(`are to have the hand somewhere with its ${part}`)
    if (grip && velocity.lengthSq() > 0) {
      throw new Error(`the ${this.name} is to take hold of something moving past it: send what he holds instead`)
    }
    const gives = grip && this.rig.held(grip.target)
    return { place, velocity, on, palm: faces, pointing: points, with: part, grip, gives }
  }

  /**
   * where a hand is sent to have a thing it holds by a `grip`, for the thing to be at a place: its origin there, turned
   * from how it is to be now the short way for its z to be `pointing` a way, its y `up`, or the palm of the hand
   * facing a way, rolled about the one of those said for the palm to face as near that; with its z and y both said,
   * turned so. The place and the ways are counted alike, and its velocity
   * is the thing's
   */
  protected carrying(give: Give, grip: Grip, place: Xyz, { pointing, up, palm, ...arriving }: Carrying): Target {
    const hand = this.limb.hand
    if (!hand) throw new Error(`the ${this.name} is to carry something, and is no hand`)
    const target = this.target(place, arriving)
    const { at, turned } = this.framed(grip)
    // (how it is turned now, counted as the place is)
    this.where(target, 0, framed)
    const now = framed.clone().invert().multiply(give.turned())
    const ways = [pointing, up, palm].map((way) => way && new Vector3().copy(way).normalize())
    if (!ways.every((way) => !way || way.toArray().every(Number.isFinite))) {
      throw new Error(`the ${this.name} is to carry something turned a way that no numbers say`)
    }
    const [z, y, faces] = ways
    const sits = turned.clone().invert()
    const mine = hand.palm.clone().applyQuaternion(sits)
    const along = (z && y && basis(y, z)) || shortest(now, z ? FORWARD : y ? UP : mine, z ?? y ?? faces)
    // (said how the palm faces as well as one way of it, it is rolled about that way for the palm to face as near so)
    const about = z && y ? undefined : (z ?? y)
    const turn = faces && about ? rolled(along, about, mine, faces) : along
    // (the hand turned as has it so, there with the thing's origin)
    const held = turn.clone().multiply(sits)
    // (said only how the palm faces, the hand is turned no further than that)
    const palmed = hand.palm.clone().applyQuaternion(held)
    const ends = faces && !z && !y ? { palm: palmed } : { palm: palmed, pointing: DOWN.clone().applyQuaternion(held) }
    return { ...target, ...ends, with: at, carries: give, pose: { at: target.place.clone(), turn } }
  }

  /** a thing as it sits in the hand: where it is from the wrist and the way its z goes, in the frame of the hand as it hangs */
  protected framed({ position, quaternion }: Grip) {
    const { hangs, large } = this.rig
    const turned = new Quaternion().copy(quaternion).premultiply(hangs)
    const at = new Vector3().copy(position).multiplyScalar(large).applyQuaternion(hangs)
    return { at, turned, along: new Vector3(0, 0, 1).applyQuaternion(turned) }
  }

  /**
   * where the wrist is and how the hand is turned, for what a place is counted on, a thing or the frame of the scene
   * or of him, to sit in the hand so: in that frame, and in its lengths
   */
  private gripped(held: Grip, on: Object3D) {
    const { at, turned } = this.framed(held)
    const hand = this.limb.hand
    if (!hand) throw new Error(`the ${this.name} is sent to hold something, and is no hand`)
    // (a thing's lengths against the body's)
    on.updateWorldMatrix(true, false)
    const large = on.getWorldScale(new Vector3()).x * this.rig.frame.getMaxScaleOnAxis()
    const back = turned.clone().invert()
    return {
      place: at.negate().applyQuaternion(back).divideScalar(large),
      palm: hand.palm.clone().applyQuaternion(back),
      pointing: DOWN.clone().applyQuaternion(back),
    }
  }
}

/** how a thing is turned for its y to be `up`, as near as is square to its z `pointing` that way: or none, if they lie along each other */
function basis(up: Vector3, pointing: Vector3) {
  const y = up.clone().addScaledVector(pointing, -pointing.dot(up))
  if (y.lengthSq() < EXACT) return undefined
  y.normalize()
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3().crossVectors(y, pointing), y, pointing))
}

/** a turn so, turned on the short way for what lies along a way in it to lie along another way: or as it is, with none */
const shortest = (turn: Quaternion, mine: Vector3, way?: Vector3) =>
  way ? new Quaternion().setFromUnitVectors(mine.clone().applyQuaternion(turn).normalize(), way).multiply(turn) : turn.clone()

/** a turn so, turned on about a way as far as has what lies along another way in it come nearest a third */
function rolled(turn: Quaternion, about: Vector3, mine: Vector3, way: Vector3) {
  const flat = (v: Vector3) => v.clone().addScaledVector(about, -v.dot(about))
  const [from, to] = [flat(mine.clone().applyQuaternion(turn)), flat(way)]
  const angle = Math.atan2(about.dot(new Vector3().crossVectors(from, to)), from.dot(to))
  return new Quaternion().setFromAxisAngle(about, angle).multiply(turn)
}
