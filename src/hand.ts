import { Euler, Line3, Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import { type Range, between, quickest } from './curve'
import { Goal, REST } from './goal'
import { EXACT, type Story, type Xyz, clamp, waits, wrap } from './world'

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'little'] as const
export type Finger = (typeof FINGERS)[number]
export const each = <T>(make: (finger: Finger) => T): Record<Finger, T> => ({
  thumb: make('thumb'),
  index: make('index'),
  middle: make('middle'),
  ring: make('ring'),
  little: make('little'),
})
/** how the fingers of a hand are held: flat, in a fist, pointing with the index, or closed `around` something so thick, a handle or a ball (its radius, m) */
const SHAPES = ['flat', 'fist', 'point'] as const
export type Shape = (typeof SHAPES)[number] | { around: number }
/** what of a hand can be where it is sent instead of its wrist: the tip of a finger, the middle of the palm, or where a handle crosses the palm */
export type Touch = Finger | 'palm' | 'grip'

/** the way a part of a limb hangs, and a hand lies from its wrist in line with a forearm that hangs so */
export const DOWN = new Vector3(0, -1, 0)
/** how far the joints of a finger fold from straight, from the knuckle out; and a thumb stands up in front of the palm, and its two outer joints fold across the hand (rad) */
const FOLDS = {
  finger: { x: [0, Math.PI / 2], y: [0, 2.1], z: [0, 1.4] },
  thumb: { x: [0, 1.1], y: [0, 1], z: [0, 1.4] },
} satisfies Record<string, Range>
/** how they hang, left alone: each finger a little more curled than the one before it, and the thumb against the side of the index (rad) */
const RELAXED = {
  thumb: new Vector3(0.35, 0.8, 0.5),
  index: new Vector3(0.25, 0.35, 0.2),
  middle: new Vector3(0.3, 0.45, 0.25),
  ring: new Vector3(0.35, 0.55, 0.3),
  little: new Vector3(0.4, 0.65, 0.35),
}
/** how strong a finger is: the most its joints can accelerate (rad a beat, a beat), and how many times a beat it comes round to hanging, free */
const FINGER = { strength: 27, rate: 1.8 }
/** how far back from the knuckles what a hand closes around lies in the palm at the most, in shares of how far they are from the wrist: behind it the thumb stands up */
const PALM = 0.25
/** how much further back a handle lies under the little finger than under the index, in shares of how far their knuckles are apart: across the palm toward its heel */
const SLANT = 0.5
/** how thick a finger is, which keeps the bones of a thumb that far off the bones of the finger it closes on: in shares of how far the knuckles are from the wrist */
const THICK = 0.18
/** where along a bone it is looked at for whether it is clear of what the hand closes around, in shares of its length */
const ALONG = [0.25, 0.5, 0.75, 1]
const kind = (finger: Finger) => (finger === 'thumb' ? 'thumb' : 'finger')
const euler = new Euler()
const matrix = new Matrix4()
const across = new Vector3()
const along = new Vector3()
const near = new Vector3()
const spin = new Quaternion()
const still = new Quaternion()

/**
 * How a wrist bends against a forearm turned so, for the `palm` of its hand to face and what lies `along` a way in the
 * hand, the fingers or what they hold, to be `pointing` a way: what is not said lies as near as it can to how it does
 * in line with the forearm. About y, as the forearm twists, then x, toward the little finger, then z, folding (rad).
 * With the palm to face along the forearm, or to point the way the forearm has the palm face, nothing tells: none.
 */
export function bends(forearm: Quaternion, rest: Vector3, palm?: Vector3, pointing?: Vector3, along = DOWN) {
  const lies = (way: Vector3) => way.clone().applyQuaternion(forearm)
  const square = (way: Vector3, to: Vector3) =>
    way.addScaledVector(to, -way.dot(to)).lengthSq() > EXACT ? way.normalize() : undefined
  const point = pointing ?? lies(DOWN)
  const face = palm ?? square(lies(rest), point)
  const long = face && square(point.clone(), face)
  if (!face || !long) return undefined
  const turned = (face: Vector3, long: Vector3, to: Quaternion) =>
    to.setFromRotationMatrix(matrix.makeBasis(face, long, across.crossVectors(face, long)))
  const hand = turned(face, long, new Quaternion()).multiply(turned(rest, along, still).invert())
  return new Vector3().setFromEuler(euler.setFromQuaternion(hand.premultiply(still.copy(forearm).invert()), 'YXZ'))
}

/** a wrist that holds something rests toward the little finger, for what it holds to go on along the forearm */
export function rests({ wrist, fingers }: { wrist: Goal; fingers?: Fingers }, to: Vector3) {
  const held = fingers?.held
  const [least, most] = wrist.range.x ?? [-Infinity, Infinity]
  return to.set(held ? clamp(wrap(Math.PI - Math.atan2(held.z, held.y)), least, most) : 0, 0, 0)
}

/** how a hand is turned in the frame of the body, its wrist bent so against a forearm */
export const bent = (forearm: Quaternion, wrist: Xyz, to: Quaternion) =>
  to.setFromEuler(euler.set(wrist.x, wrist.y, wrist.z, 'YXZ')).premultiply(forearm)

/**
 * a finger, the hand lying as it rests against a forearm that hangs straight down: where its knuckle is from the wrist,
 * where each of its bones ends from where it starts, the last at the fingertip (m), and what each turns about to fold
 */
type Digit = { knuckle: Vector3; bones: Vector3[]; axes: Vector3[] }

/** a bone of a finger, from the wrist in the frame of the hand, its joints folded so */
function span({ knuckle, bones, axes }: Digit, curl: Vector3, bone: number) {
  const [line, turned] = [new Line3(undefined, knuckle.clone()), new Quaternion()]
  for (let k = 0; k <= bone; k++) {
    turned.multiply(spin.setFromAxisAngle(axes[k], curl.getComponent(k)))
    line.start.copy(line.end)
    line.end.add(along.copy(bones[k]).applyQuaternion(turned))
  }
  return line
}

/**
 * The fingers of a hand: each folds at up to three joints, from the knuckle out, and the thumb stands up in front of
 * the palm at its first. A shape they are given they hold until they are given another, whatever the hand does.
 */
export class Fingers {
  /** how far the joints of each are folded (rad): x, y and z from the knuckle out */
  readonly curl: Record<Finger, Goal>
  readonly digits: Record<Finger, Digit>
  /** how far the joints of each are to fold, for the shape they were last given */
  private shaped?: Record<Finger, Vector3>
  /** a shape they are to have at a moment: how far each joint is to fold, how thick what they close around is, and how long until then (s) */
  private due?: { curls: Record<Finger, Vector3>; thick: number; left: number }
  /**
   * where what the hand holds lies, for what the fingers last set off to close around: in the middle of the handle,
   * its z along it the way it leaves the hand past the thumb and the index, its y out of the palm
   */
  readonly grip = new Object3D()
  private readonly handle = new Line3()
  private thick = 0
  /** the middle of the palm: halfway from the wrist to the knuckles */
  private readonly centre: Vector3

  /** `chains` tell each finger's knuckle and bones, and `palm` the way the palm faces, the forearm hanging down */
  constructor(
    private readonly name: string,
    private readonly palm: Vector3,
    chains: Record<Finger, Vector3[]>,
    beat: number,
  ) {
    this.digits = each((finger) => {
      const [knuckle, ...bones] = chains[finger]
      const out = bones[0].clone().normalize()
      // a finger folds toward the palm; a thumb stands up in front of the palm so, and its outer joints fold across the hand
      const fold = new Vector3().crossVectors(out, palm).normalize()
      const over = new Vector3().crossVectors(out, DOWN).normalize()
      return { knuckle, bones, axes: bones.map((_, k) => (finger === 'thumb' && k > 0 ? over : fold)) }
    })
    const { strength, rate } = FINGER
    this.curl = each(
      (finger) =>
        new Goal(`${name}'s ${finger}`, RELAXED[finger], strength / beat ** 2, FOLDS[kind(finger)], rate / beat),
    )
    const knuckles = FINGERS.slice(1).map((finger) => this.digits[finger].knuckle)
    this.centre = knuckles.reduce((sum, knuckle) => sum.add(knuckle), new Vector3()).divideScalar(2 * knuckles.length)
    this.hold(0)
  }

  /** the way the handle the fingers are closed around leaves the hand, if they are */
  get held() {
    return this.thick > 0 ? this.handle.delta(new Vector3()).normalize() : undefined
  }

  /** a handle lies across the palm toward its heel, for it to leave the hand nearer along the forearm than straight across */
  private lie(thick: number) {
    const { index, little } = this.digits
    const lies = ({ knuckle }: Digit, back: number) =>
      knuckle
        .clone()
        .addScaledVector(DOWN, -Math.min(thick, PALM * knuckle.dot(DOWN)) - back)
        .addScaledVector(this.palm, thick)
    return new Line3(lies(little, SLANT * little.knuckle.distanceTo(index.knuckle)), lies(index, 0))
  }

  private hold(thick: number) {
    const { handle, grip } = this
    handle.copy(this.lie(thick))
    const long = handle.delta(along).normalize()
    grip.quaternion.setFromRotationMatrix(matrix.makeBasis(across.crossVectors(this.palm, long), this.palm, long))
    handle.getCenter(grip.position)
  }

  /** Has the fingers take a shape, or with none relax, in the time fingers take or in so many `seconds` from now. */
  shape(shape: Shape | undefined, seconds?: number): Story<boolean> {
    // (a caller without types can say anything)
    const thick =
      shape === undefined ? 0 : typeof shape === 'string' ? (SHAPES.includes(shape) ? 0 : NaN) : shape?.around
    if (!(thick >= 0 && thick < Infinity)) {
      throw new Error(
        `the ${this.name} is to take the shape ${JSON.stringify(shape)}, and a shape is 'flat', 'fist', 'point', { around: a radius of 0 m or more }, or none to relax`,
      )
    }
    const curls = each((finger) => (shape === undefined ? RELAXED[finger].clone() : new Vector3()))
    // the thumb closes last, onto what the fingers have closed on, or onto them
    const [handle, closed]: [Line3, Line3[]] = [this.lie(thick), []]
    for (const finger of shape === 'flat' || shape === undefined ? [] : [...FINGERS.slice(1), FINGERS[0]]) {
      if (finger === 'index' && shape === 'point') continue
      curls[finger] = this.close(finger, thick, handle, closed)
      closed.push(...this.digits[finger].bones.map((_, k) => span(this.digits[finger], curls[finger], k)))
    }
    const needs = this.needs(curls)
    if (seconds !== undefined && !(seconds >= needs)) {
      throw new Error(
        `the ${this.name} is to take a shape in ${seconds.toFixed(2)} s, and its fingers take ${needs.toFixed(2)} s to: give them that long`,
      )
    }
    this.shaped = curls
    this.due = seconds === undefined ? undefined : { curls, thick, left: seconds }
    if (!this.due) this.set(curls, thick)
    return waits(
      () => this.shaped === curls,
      () => !this.due && FINGERS.every((finger) => this.curl[finger].arrived),
    )
  }

  private needs(curls: Record<Finger, Vector3>) {
    const takes = (curl: Goal, value: Vector3) => quickest(curl, { value, velocity: REST }, curl.strength, curl.range)
    return Math.max(...FINGERS.map((finger) => takes(this.curl[finger], curls[finger])))
  }

  private set(curls: Record<Finger, Vector3>, thick: number, seconds = this.needs(curls)) {
    for (const finger of FINGERS) this.curl[finger].drive({ value: curls[finger], velocity: REST }, seconds)
    // (what was held stays where it was as the fingers open to let it go)
    if (thick > 0) this.hold(thick)
    this.thick = thick
  }

  react(dt: number) {
    const { due } = this
    // a shape for a moment is set off for as late as the fingers can still take it
    if (due && (due.left -= dt) <= this.needs(due.curls)) {
      this.due = undefined
      this.set(due.curls, due.thick, Math.max(0, due.left))
    }
    for (const finger of FINGERS) this.curl[finger].react(RELAXED[finger], dt)
  }

  /** where a part of the hand is from the wrist `seconds` from now, in the frame of the hand */
  tip(touch: Touch, seconds: number) {
    if (touch === 'palm') return this.centre.clone()
    if (touch === 'grip') return this.grip.position.clone()
    const [digit, curl] = [this.digits[touch], this.curl[touch]]
    const folded = curl.reacts ? curl.value : curl.ahead(seconds, new Vector3(), near)
    return span(digit, folded, digit.bones.length - 1).end
  }

  /**
   * How far the joints of a finger fold to close on a `handle` so thick: one after another from the knuckle, each as
   * far as keeps its bones off the handle and out of the palm; the thumb also a finger's thickness off the bones of the
   * fingers that have `closed`, and folding over no further than it stands up.
   */
  private close(finger: Finger, thick: number, handle: Line3, closed: Line3[]) {
    const { palm } = this
    const digit = this.digits[finger]
    const { knuckle } = this.digits[finger === 'thumb' ? 'index' : finger]
    const [ahead, level] = [knuckle.dot(DOWN), knuckle.dot(palm)]
    const low = Math.min(level, digit.knuckle.dot(palm)) - EXACT
    const off = finger === 'thumb' ? THICK * ahead : 0
    const range = FOLDS[kind(finger)]
    const most = [range.x[1], range.y[1], range.z[1]]
    const curl = new Vector3()
    digit.bones.forEach((_, k) => {
      const far = finger === 'thumb' && k > 0 ? (curl.x / most[0]) * most[k] : most[k]
      /** what a bone of it is in, the joint folded so far, and what would help: the back of the hand, what the hand closes around, or a finger that has closed */
      const meets = (angle: number) => {
        curl.setComponent(k, angle)
        for (let bone = 0; bone < digit.bones.length; bone++) {
          const line = span(digit, curl, bone)
          for (const share of ALONG) {
            line.at(share, along)
            if (along.dot(palm) < low)
              return 'behind the palm: a rig rests its fingers level with the palm or in front of it'
            if (handle.closestPointToPoint(along, false, near).distanceTo(along) < thick - EXACT)
              return `in the ${thick} m thick thing the hand closes around: ask for something thinner`
            if (closed.some((by) => by.closestPointToPoint(along, true, near).distanceTo(along) < off))
              return `nearer than a finger is thick, ${off.toFixed(3)} m, to the bones of the fingers closed under it: a rig rests its thumb further from its index`
          }
        }
        return undefined
      }
      const clear = (angle: number) => !meets(angle)
      if (clear(far) || clear(between(0, far, clear)[0])) return
      throw new Error(
        `the ${this.name} takes a shape, and its ${finger}, as far open as it rests in the rig, is ${meets(0)}`,
      )
    })
    return curl
  }
}
