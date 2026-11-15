import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { quickest } from './curve'
import { Goal, REST } from './goal'
import { EXACT, type Story, type Xyz, waits } from './world'

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'little'] as const
export type Finger = (typeof FINGERS)[number]
export const each = <T>(make: (finger: Finger) => T): Record<Finger, T> => ({
  thumb: make('thumb'),
  index: make('index'),
  middle: make('middle'),
  ring: make('ring'),
  little: make('little'),
})
/**
 * How the fingers of a hand are held, finger by finger (rad): `spread` turns a finger at its knuckle toward the
 * thumb's side, and `bend` folds its three joints toward the palm, from the knuckle out. The thumb's first bend lifts
 * it to stand in front of the palm, its other two fold it toward the fingers. A left and a right hand in one pose
 * mirror each other. The poses `@drawcall/hand` makes are such.
 */
export type Pose = Record<Finger, { spread: number; bend: readonly [number, number, number] }>
/** a thing as it sits in a hand: where it is and how it is turned in the frame of the rig's hand bone */
export type Held = { position: Xyz; quaternion: Xyz & { w: number } }
/** what of a hand can be where it is sent instead of its wrist: the tip of a finger, the middle of the palm, or a thing it carries, as it sits in the hand */
export type Touch = Finger | 'palm' | Held

/** the way a part of a limb hangs, and a hand lies from its wrist in line with a forearm that hangs so */
export const DOWN = new Vector3(0, -1, 0)
/** how far a finger is spread, and each of its joints bends, from the knuckle out (rad): as far as a person's go */
const RANGE = {
  finger: { spread: [-0.35, 0.35], bend: [-0.35, 1.55], middle: [0, 1.9], end: [-0.1, 1.4] },
  thumb: { spread: [-0.4, 0.5], bend: [-0.2, 1.5], middle: [-0.2, 1], end: [-0.3, 1.4] },
} satisfies Record<string, Record<string, [number, number]>>
/** what a pose's angles turn, as an error names them */
const ANGLES = ['spread', 'bent at the knuckle', 'bent at the middle joint', 'bent at the last joint']
/**
 * how the fingers hang, left alone: each a little more curled than the one before it, and the thumb turned in to
 * rest by the index
 */
const RELAXED: Pose = {
  thumb: { spread: -0.35, bend: [0.15, 0, 0.4] },
  index: { spread: 0.04, bend: [0.2, 0.3, 0.15] },
  middle: { spread: 0, bend: [0.28, 0.4, 0.2] },
  ring: { spread: -0.04, bend: [0.36, 0.5, 0.25] },
  little: { spread: -0.08, bend: [0.44, 0.6, 0.3] },
}
/** how strong a finger is: the most its joints can accelerate (rad a beat, a beat), and how many times a beat it comes round to hanging, free */
const FINGER = { strength: 27, rate: 1.8 }
const near = new Vector3()
const turn = new Quaternion()
const euler = new Euler()
const matrix = new Matrix4()
const across = new Vector3()
const still = new Quaternion()

/**
 * How a wrist bends against a forearm turned so, for the `palm` of its hand to face and what lies `along` a way in the
 * hand, the fingers or what it carries, to be `pointing` a way: what is not said lies as near as it can to how it does
 * in line with the forearm. About y, as the forearm twists, then x, toward the little finger, then z, folding (rad).
 * With the palm to face along the forearm, or to point the way the forearm has the palm face, nothing tells: none.
 */
export function bends(forearm: Quaternion, rest: Vector3, palm?: Vector3, pointing?: Vector3, along = DOWN) {
  const lies = (way: Vector3) => way.clone().applyQuaternion(forearm)
  const square = (way: Vector3, to: Vector3) =>
    way.addScaledVector(to, -way.dot(to)).lengthSq() > EXACT ? way.normalize() : undefined
  const point = pointing ?? lies(along)
  const face = palm ?? square(lies(rest), point)
  const long = face && square(point.clone(), face)
  // said a palm, the palm faces as said; else what lies along the way in the hand points as said
  const [mine, lying] = palm ? [rest, square(along.clone(), rest)] : [square(rest.clone(), along), along]
  if (!face || !long || !mine || !lying) return undefined
  const turned = (face: Vector3, long: Vector3, to: Quaternion) =>
    to.setFromRotationMatrix(matrix.makeBasis(face, long, across.crossVectors(face, long)))
  const hand = turned(face, long, new Quaternion()).multiply(turned(mine, lying, still).invert())
  return new Vector3().setFromEuler(euler.setFromQuaternion(hand.premultiply(still.copy(forearm).invert()), 'YXZ'))
}

/** how a hand is turned in the frame of the body, its wrist bent so against a forearm */
export const bent = (forearm: Quaternion, wrist: Xyz, to: Quaternion) =>
  to.setFromEuler(euler.set(wrist.x, wrist.y, wrist.z, 'YXZ')).premultiply(forearm)

/** `v` made square to the unit direction `to`, as a unit */
const square = (v: Vector3, to: Vector3) => v.clone().addScaledVector(to, -v.dot(to)).normalize()

/**
 * The fingers of a hand, as the rig's bones have them: each is spread at its knuckle and bends at three joints from
 * there out, about axes read from the rig's hand as `@drawcall/hand` reads them, so that a pose from it is had
 * here as it is there. A pose they are given they hold until they are given another, whatever the hand does.
 */
export class Fingers {
  /** how far each is spread, along x, and its joints bent, along x, y and z from the knuckle out (rad) */
  readonly spread: Record<Finger, Goal>
  readonly bend: Record<Finger, Goal>
  /** what each turns about, in the frame of the hand as it lies against a forearm that hangs straight down: its spread, then its bends */
  private readonly axes: Record<Finger, Vector3[]>
  /** what turns each of its bones from the rest to where a pose counts from, there */
  private readonly straight: Record<Finger, Quaternion[]>
  /** the pose they were last given, and when it is for one by a moment, how long until then (s) */
  private posed?: { pose: Pose }
  private due?: { pose: Pose; left: number }
  /** how thick a finger and the palm are about their bones, as measured, or half the least that two knuckles side by side are apart (m) */
  private readonly thick: number
  /** the middle of the palm, on its skin: halfway from the wrist to the knuckles, and out of the palm as thick as it is */
  private readonly centre: Vector3

  /**
   * `chains` tell each finger's knuckle from the wrist and where each of its bones ends from where it starts, the
   * fingertip last, the hand lying against a forearm that hangs straight down; and how `thick` the fingers are, if
   * that is measured
   */
  constructor(
    private readonly name: string,
    side: 'left' | 'right',
    private readonly chains: Record<Finger, Vector3[]>,
    beat: number,
    thick?: number,
  ) {
    const along = chains.middle[0].clone().normalize()
    const thumbward = square(chains.index[0].clone().sub(chains.little[0]), along)
    const normal = new Vector3().crossVectors(along, thumbward).multiplyScalar(side === 'right' ? -1 : 1)
    // a pose counts a finger's angles from it straight in the palm's plane, pointing there as the rig points its first
    // bone: whatever else the rest bends, the thumb lifted in front of the palm or a finger curled, is taken out
    const ways = each((finger) => square(chains[finger][1], normal))
    const from = (finger: Finger) => (step: Vector3) =>
      new Quaternion().setFromUnitVectors(step.clone().normalize(), ways[finger])
    this.straight = each((finger) => chains[finger].slice(1).map(from(finger)))
    this.axes = each((finger) => {
      const way = ways[finger]
      // a spread turns a finger thumbward within the palm, and the thumb, lying out to the side, away from the fingertips
      const outward = square(thumbward.clone().sub(along), way)
      const spread = new Vector3().crossVectors(way, outward)
      // a knuckle lifts its finger out of the palm; the thumb's other joints fold it within the palm toward the fingers
      const lift = new Vector3().crossVectors(way, normal)
      const fold = finger === 'thumb' ? new Vector3().crossVectors(outward, way) : lift
      return [spread, lift, fold, fold]
    })
    const { strength, rate } = FINGER
    const goal = (finger: Finger, what: string, value: Xyz, range: Record<string, [number, number]>) =>
      new Goal(`${name}'s ${finger}${what}`, value, strength / beat ** 2, range, rate / beat)
    this.spread = each((finger) => goal(finger, ' spread', splay(RELAXED[finger]), { x: RANGE[kind(finger)].spread }))
    this.bend = each((finger) => {
      const { bend, middle, end } = RANGE[kind(finger)]
      return goal(finger, '', curl(RELAXED[finger]), { x: bend, y: middle, z: end })
    })
    const knuckles = FINGERS.slice(1).map((finger) => chains[finger][0])
    this.thick = thick ?? Math.min(...knuckles.slice(1).map((knuckle, k) => knuckle.distanceTo(knuckles[k]))) / 2
    const middle = knuckles.reduce((sum, knuckle) => sum.add(knuckle), new Vector3()).divideScalar(2 * knuckles.length)
    this.centre = middle.addScaledVector(normal, this.thick)
  }

  /** how each joint of a finger is turned against the one before it from the rest, spread and bent so (rad) */
  turns(finger: Finger, spread = this.spread[finger].value.x, bend: Xyz = this.bend[finger].value) {
    const [about, lift, ...folds] = this.axes[finger]
    const [first, second, third] = this.straight[finger]
    const by = (axis: Vector3, angle: number) => new Quaternion().setFromAxisAngle(axis, angle)
    return [
      by(about, spread).multiply(turn.setFromAxisAngle(lift, bend.x)).multiply(first),
      first.clone().invert().multiply(by(folds[0], bend.y)).multiply(second),
      second.clone().invert().multiply(by(folds[1], bend.z)).multiply(third),
    ]
  }

  /**
   * Has the fingers take a pose, or with none hang relaxed, in the time fingers take or in so many `seconds` from
   * now: a pose they cannot take is an error.
   */
  shape(pose: Pose | undefined, seconds?: number): Story<boolean> {
    const to = pose ?? RELAXED
    for (const finger of FINGERS) {
      const part = to[finger]
      if (!part) throw new Error(`the ${this.name} is to take a pose that says nothing of its ${finger}`)
      const { spread, bend, middle, end } = RANGE[kind(finger)]
      ;[spread, bend, middle, end].forEach(([least, most], k) => {
        const angle = k ? part.bend[k - 1] : part.spread
        if (angle >= least && angle <= most) return
        throw new Error(
          `the ${this.name}'s ${finger} is to be ${ANGLES[k]} ${angle} rad, and goes only from ${least.toFixed(2)} to ${most.toFixed(2)}`,
        )
      })
    }
    const needs = this.needs(to)
    if (seconds !== undefined && !(seconds >= needs)) {
      throw new Error(
        `the ${this.name} is to take a pose in ${seconds.toFixed(2)} s, and its fingers take ${needs.toFixed(2)} s to: give them that long`,
      )
    }
    const posed = (this.posed = { pose: to })
    this.due = seconds === undefined ? undefined : { pose: to, left: seconds }
    if (!this.due) this.set(to, needs)
    return waits(
      () => this.posed === posed,
      () => !this.due && FINGERS.every((finger) => this.spread[finger].arrived && this.bend[finger].arrived),
    )
  }

  private needs(pose: Pose) {
    const takes = (goal: Goal, value: Xyz) => quickest(goal, { value, velocity: REST }, goal.strength, goal.range)
    return Math.max(
      ...FINGERS.flatMap((finger) => [
        takes(this.spread[finger], splay(pose[finger])),
        takes(this.bend[finger], curl(pose[finger])),
      ]),
    )
  }

  private set(pose: Pose, seconds: number) {
    for (const finger of FINGERS) {
      this.spread[finger].drive({ value: splay(pose[finger]), velocity: REST }, seconds)
      this.bend[finger].drive({ value: curl(pose[finger]), velocity: REST }, seconds)
    }
  }

  react(dt: number) {
    const { due } = this
    // a pose for a moment is set off for as late as the fingers can still take it
    if (due && (due.left -= dt) <= this.needs(due.pose)) {
      this.due = undefined
      this.set(due.pose, Math.max(0, due.left))
    }
    for (const finger of FINGERS) {
      this.spread[finger].react(splay(RELAXED[finger]), dt)
      this.bend[finger].react(curl(RELAXED[finger]), dt)
    }
  }

  /** where the skin of a part of the hand is from the wrist `seconds` from now, in the frame of the hand: a fingertip's at its end */
  tip(touch: Finger | 'palm', seconds: number) {
    if (touch === 'palm') return this.centre.clone()
    const then = (goal: Goal) => (goal.reacts ? goal.value.clone() : goal.ahead(seconds, new Vector3(), near))
    const [knuckle, ...bones] = this.chains[touch]
    const [at, turned, last] = [knuckle.clone(), new Quaternion(), new Vector3()]
    this.turns(touch, then(this.spread[touch]).x, then(this.bend[touch])).forEach((by, k) =>
      at.add(last.copy(bones[k]).applyQuaternion(turned.multiply(by))),
    )
    return at.addScaledVector(last.normalize(), this.thick)
  }
}

const kind = (finger: Finger) => (finger === 'thumb' ? 'thumb' : 'finger')
/** a finger's part of a pose as the values of what turns it */
const splay = ({ spread }: Pose[Finger]) => ({ x: spread, y: 0, z: 0 })
const curl = ({ bend: [x, y, z] }: Pose[Finger]) => ({ x, y, z })
