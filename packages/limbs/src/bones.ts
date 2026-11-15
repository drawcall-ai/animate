import { Euler, Bone as Joint, Line3, Matrix4, type Object3D, Quaternion, Vector3 } from 'three'
import type { State } from './curve'
import { Bone, above } from './bone'
import { DOWN, FINGERS, type Finger, each } from './fingers'
import { type Joints, RANGE } from './joints'
import { type Band, type Shape, deep, measure } from './shape'
import { SIDES, SIGN, SOLE, type Side, type Size, both } from './size'
import { GRAVITY, clamp, UP } from './world'

/**
 * how much of its length a line across a rig at rest runs along what it is to run along, at the least: from right to
 * left along +x, from the hips up to the shoulders, and from an ankle up to its hip, by the length of a leg
 */
const SQUARE = 0.97
/**
 * where an eye is from the joint of the head, upright: out to its side, up and ahead (in lengths of his trunk, not of
 * the head's skin, which a helmet or hair makes larger)
 */
const EYE = { aside: 0.065, up: 0.146, ahead: 0.146 }
const euler = new Euler()
const swivel = new Euler(0, 0, 0, 'YZX')
const matrix = new Matrix4()
const scale = new Vector3()
const along = new Vector3()
const thigh = new Line3()
const at = new Vector3()
const trunk = new Quaternion()
const pelvis = new Quaternion()
const turned = new Quaternion()
const folded = new Quaternion()
const round = new Quaternion()
const twist = new Quaternion()
const spun = new Quaternion()
const tipped = new Quaternion()
const ACROSS = new Vector3(1, 0, 0)

/** how the pelvis is turned: about the vertical and listing as the hips have it, and about the line between the hips as far as the trunk leans further than the back curves */
function tilt(turn: number, list: number, lean: number, to: Quaternion) {
  const [back, forth] = RANGE.back.x
  to.setFromEuler(swivel.set(0, turn, list))
  return to.multiply(tipped.setFromAxisAngle(ACROSS, lean - clamp(lean, back, forth)))
}

/** a band of the trunk as a shoulder has it, the trunk upright: how far it is from the shoulder along x and z to the line up through its joint, and along y to where it starts and ends (m) */
export type Beside = Band & { x: number; z: number }
/** the two parts of each leg and arm and what is at its end, from the trunk out */
type Limbs = Record<Side, Bone[]>
/** what the bones of a finger are named after its side and its own name, from the knuckle out */
const DIGIT = { finger: ['Proximal', 'Intermediate', 'Distal'], thumb: ['Metacarpal', 'Proximal', 'Distal'] }

/**
 * The bones of a rig as the body turns them, found under it by the names a body asks of a humanoid: `hips`, `spine`
 * and `head`, and on each side `UpperLeg`, `LowerLeg`, `Foot`, `UpperArm`, `LowerArm` and `Hand` after `left` or
 * `right`, each hanging from the one before it; and `chest` and `neck` between, if the rig has them, which then share
 * the turns of the trunk and of the head. How they stand when the body is made is the rest pose, which it is
 * measured by: facing +z, its left at +x, upright on y = 0, in the frame the body's places are told in. That is where
 * the rig is, turned as it is, in the lengths of what holds it: the rig's own scale is part of how large he is. A hand
 * may have fingers: `Thumb`, `Index`, `Middle`, `Ring` and `Little`, each three bones hanging from one another,
 * `Proximal`, `Intermediate` and `Distal`, a thumb's `Metacarpal`, `Proximal` and `Distal`, with something hanging
 * from the last where the fingertip is. A bone the body does not turn stays as it is against the bone it hangs from.
 */
export class Bones {
  readonly size: Size
  /** what he is like about his bones, as measured on the rig's skin */
  readonly shape: Shape
  /** how much of a turn to look somewhere the trunk makes, its neck and head the rest */
  readonly looks: number
  /** where the ankles and the wrists are, in that frame, and how the hands are turned there from hanging straight down */
  readonly ankle: Record<Side, Vector3>
  readonly wrist: Record<Side, Vector3>
  readonly hand: Record<Side, Quaternion>
  /** (the joint of the hips is counted from the middle between the hips) */
  private readonly hips: Bone
  /**
   * the bones of the trunk from the hips up, and the neck, if there is one, under the head; and how much of the trunk's
   * turn against the pelvis each bone of it has made, and the neck of the head's against the trunk: a joint makes the
   * more of a turn the higher up he it is, as the less of him it has to move. The last, which the arms hang from, has
   * made all of it
   */
  private readonly trunk: Bone[]
  private readonly neck?: Bone
  private readonly head: Bone
  private readonly shares: number[]
  private readonly bows: number
  private readonly legs: Limbs
  private readonly arms: Limbs
  /** the bones of the fingers of a hand that has them, from the knuckle out, and the fingertip last */
  private readonly fingers: Record<Side, Record<Finger, Bone[]> | undefined>
  /** what takes a place in the scene to that frame */
  readonly frame: Matrix4
  /** the bone each leg and each arm starts at, which all of it hangs from */
  readonly starts: Record<'foot' | 'hand', Record<Side, Object3D>>
  /** what takes a place in that frame to the frame the bone of the hips hangs in */
  private readonly into: Matrix4

  constructor(rig: Object3D) {
    rig.updateWorldMatrix(true, true)
    const sits = new Matrix4().compose(rig.position, rig.quaternion, scale.set(1, 1, 1))
    if (rig.parent) sits.premultiply(rig.parent.matrixWorld)
    const frame = (this.frame = sits.clone().invert())
    const find = (name: string, under: Object3D = rig) => {
      const bone = under.getObjectByName(name)
      if (bone) return bone
      throw new Error(`the rig has no bone named ${name}${under === rig ? '' : ` hanging from its ${under.name}`}`)
    }
    const bone = (name: string, on?: Bone, end?: string, twisted?: number) =>
      new Bone(frame, find(name, on?.bone), on, end === undefined ? undefined : find(end), twisted)
    const position = (bone: Object3D) =>
      new Vector3().setFromMatrixPosition(matrix.multiplyMatrices(frame, bone.matrixWorld))
    // a hand hangs in line with its forearm, the palm toward the thigh, as its knuckles tell: a rig may rest its hands
    // bent at the wrist and its forearms turned any way, and the wrist turns from there; a hand without them lies as
    // the rig has it against the forearm, and a foot stands as the rig has it on the ground
    const limb = (names: string[], on: Bone, arm: boolean) =>
      both((side) => {
        const [first, second, end] = names.map((name) => side + name)
        const upper = bone(first, on, second)
        const hand = find(end, find(second, upper.bone))
        const knuckle = (finger: string) => hand.getObjectByName(`${side}${finger}Proximal`)
        const [index, middle, little] = ['Index', 'Middle', 'Little'].map(knuckle)
        if (!arm || !index || !middle || !little) {
          const lower = bone(second, upper, end)
          return [upper, lower, new Bone(frame, hand, lower, arm ? lower : undefined)]
        }
        const hanging = twist.setFromUnitVectors(position(middle).sub(position(hand)).normalize(), DOWN)
        const across = position(index).sub(position(little)).applyQuaternion(hanging)
        const twisted = Math.atan2(across.x, across.z)
        const lower = bone(second, upper, end, twisted)
        return [upper, lower, new Bone(frame, hand, lower, middle, twisted)]
      })
    const named = (side: Side, name: Finger) =>
      DIGIT[name === 'thumb' ? 'thumb' : 'finger'].map(
        (part) => `${side}${name[0].toUpperCase()}${name.slice(1)}${part}`,
      )
    const finger = (side: Side, name: Finger, hand: Bone) => {
      const chain: Bone[] = []
      for (const part of named(side, name)) {
        const on = chain.at(-1) ?? hand
        chain.push(new Bone(frame, find(part, on.bone), on, hand))
      }
      const last = chain[2]
      const [tip, more] = last.bone.children.filter((child) => child instanceof Joint)
      if (tip && !more) return [...chain, new Bone(frame, tip, last, last)]
      throw new Error(
        `the rig's ${last.bone.name} has not the one bone hanging from it that tells where the fingertip is`,
      )
    }
    const hips = (this.hips = bone('hips'))
    const spine = bone('spine', hips)
    const has = (name: string, on: Bone) => (on.bone.getObjectByName(name) ? bone(name, on) : undefined)
    const chest = has('chest', spine)
    const trunk = (this.trunk = chest ? [spine, chest] : [spine])
    const top = trunk[trunk.length - 1]
    const neck = (this.neck = has('neck', top))
    const head = (this.head = bone('head', neck ?? top))
    const legs = (this.legs = limb(['UpperLeg', 'LowerLeg', 'Foot'], hips, false))
    const arms = (this.arms = limb(['UpperArm', 'LowerArm', 'Hand'], top, true))
    this.fingers = both((side) => {
      const hand = arms[side][2]
      const has = FINGERS.some((name) => hand.bone.getObjectByName(named(side, name)[0]))
      return has ? each((name) => finger(side, name, hand)) : undefined
    })
    this.starts = { foot: both((side) => legs[side][0].bone), hand: both((side) => arms[side][0].bone) }
    this.ankle = both((side) => legs[side][2].place)
    this.wrist = both((side) => arms[side][2].place)
    this.hand = both((side) => arms[side][2].turned)
    this.into = above(hips.bone).matrixWorld.clone().invert().multiply(sits)

    // he is as large as his joints are apart at rest, the two sides taken together
    const middle = ({ left, right }: Limbs, part: number) => left[part].rest.clone().lerp(right[part].rest, 0.5)
    const long = ({ left, right }: Limbs, part: number) =>
      (left[part + 1].at.length() + right[part + 1].at.length()) / 2
    const [waist, shoulders, feet] = [middle(legs, 0), middle(arms, 0), middle(legs, 2)]
    const [thigh, shin, upperArm, forearm] = [long(legs, 0), long(legs, 1), long(arms, 0), long(arms, 1)]
    hips.at.copy(hips.rest).sub(waist)
    // nothing in a rig tells how it stood before something posed it, in the frame it is in now: a mesh is bound to
    // its bones wherever they were then. So the pose it is given in is taken for its rest pose, and one that plainly
    // is none is an error: turned round, off the ground, or left as a body before this one moved it
    const askew = (from: Vector3, to: Vector3, axis: 'x' | 'y', long = to.distanceTo(from)) =>
      to[axis] - from[axis] <= SQUARE * long
    const refuse = (what: string) => {
      throw new Error(
        `a body is made of a rig at rest, facing +z, its left at +x, upright on y = 0: of this one ${what}`,
      )
    }
    if (askew(legs.right[0].rest, legs.left[0].rest, 'x') || askew(arms.right[0].rest, arms.left[0].rest, 'x'))
      refuse('the left is not at +x of the right')
    if (askew(waist, shoulders, 'y')) refuse('the shoulders are not above the hips')
    if (SIDES.some((side) => askew(legs[side][2].rest, legs[side][0].rest, 'y', thigh + shin)))
      refuse('a leg is not straight down from its hip to its ankle')
    const [leg, beat] = [thigh + shin, Math.sqrt((thigh + shin) / GRAVITY)]
    // (a heel comes up to bring its ankle up and nearer the hip: an ankle higher than the ball is ahead of it is carried on instead, and a foot that comes down ahead of him stays out of its leg's reach)
    if (feet.y <= 0 || feet.y >= SOLE.ball * leg)
      refuse(
        `the ankles are ${feet.y.toFixed(2)} m above y = 0, and he stands on feet whose ankles are above it, lower than the ball of the foot is ahead of them, ${(SOLE.ball * leg).toFixed(2)} m on legs this long: a heel comes up to bring its ankle up, not on`,
      )
    this.size = {
      ankle: feet.y,
      shin,
      thigh,
      hip: (legs.left[0].rest.x - legs.right[0].rest.x) / 2,
      trunk: shoulders.y - waist.y,
      shoulder: (arms.left[0].rest.x - arms.right[0].rest.x) / 2,
      upperArm,
      forearm,
      leg,
      arm: upperArm + forearm,
      stand: feet.y + leg,
      beat,
      pace: leg / beat,
    }
    const high = (bone: Bone) => bone.rest.y - waist.y
    const [bent, bowed] = [trunk, neck ? [neck, head] : [head]].map((bones) => bones.map(high))
    const sum = (heights: number[]) => heights.reduce((sum, height) => sum + height)
    this.shares = bent.map((_, k) => sum(bent.slice(0, k + 1)) / sum(bent))
    this.bows = high(neck ?? head) / sum(bowed)
    this.looks = sum(bent) / (sum(bent) + sum(bowed))
    const part = (bone: Bone, end: Vector3) => ({ bone: bone.bone, at: bone.rest, end })
    const limbs = (from: Limbs, k: number) => SIDES.map((side) => part(from[side][k], from[side][k + 1].rest))
    const ends = [...trunk.slice(1).map(({ rest }) => rest), shoulders]
    const bones = SIDES.flatMap((side) => {
      const hand = this.fingers[side]
      return hand
        ? FINGERS.flatMap((name) => hand[name].slice(0, 3).map((bone, k) => part(bone, hand[name][k + 1].rest)))
        : []
    })
    this.shape = measure(
      rig,
      frame,
      {
        trunk: [hips, ...trunk].map((bone, k) => part(bone, k ? ends[k - 1] : trunk[0].rest)),
        head: [part(head, head.rest)],
        thighs: limbs(legs, 0),
        upperArms: limbs(arms, 0),
        forearms: limbs(arms, 1),
        fingers: bones,
      },
      this.size,
    )
  }

  /** where an eye is from the joint of the head, the head upright */
  private eyed(side: Side) {
    return new Vector3(SIGN[side] * EYE.aside, EYE.up, EYE.ahead).multiplyScalar(this.size.trunk)
  }

  /**
   * where a place counted from the joint of a shoulder, he upright, is as he was posed last, in the frame of the body:
   * it goes with the top of his trunk
   */
  shouldered(side: Side, place: Vector3) {
    return place.clone().applyQuaternion(this.trunk[this.trunk.length - 1].turned).add(this.arms[side][0].place)
  }

  /** where the joint of a hip is, as he was posed last, in the frame of the body */
  hip(side: Side) {
    return this.legs[side][0].place
  }

  /** where an eye is, as he was posed last, in the frame of the body */
  eye(side: Side) {
    return this.eyed(side).applyQuaternion(this.head.turned).add(this.head.place)
  }

  /** the bands of the trunk as a shoulder has them, upright */
  beside(side: Side): Beside[] {
    const shoulder = this.arms[side][0].rest
    return this.shape.trunk.map((band, k) => {
      const { x, y, z } = [this.hips, ...this.trunk][k].rest.clone().sub(shoulder)
      return { ...band, low: band.low + y, high: band.high + y, x, z }
    })
  }

  /** of the fingers of a hand that has them: where the knuckle is from the wrist, and where each bone ends from where it starts, the hand as it rests against a forearm that hangs straight down */
  chains(side: Side) {
    const hand = this.fingers[side]
    return hand && each((name) => hand[name].map((bone) => bone.at))
  }

  /** how the bone at the end of a leg or an arm is turned in that pose, as its limb hangs straight down, and how large it is */
  lies(end: 'foot' | 'hand', side: Side) {
    const { hangs, large } = (end === 'foot' ? this.legs : this.arms)[side][2]
    return { hangs, large }
  }

  /**
   * where a shoulder is, the hips at a place, he `facing` a way there (rad about y), and against that the pelvis turned
   * and listing, the trunk turned so up to where the arms hang from it, and that `lifted` with his breath (m)
   */
  shoulder(
    side: Side,
    hips: Vector3,
    facing: number,
    turn: number,
    list: number,
    trunk: Quaternion,
    lifted: number,
    to: Vector3,
  ) {
    tilt(turn, list, euler.setFromQuaternion(trunk).x, pelvis)
    at.copy(this.hips.at).applyQuaternion(pelvis)
    spun.copy(pelvis)
    this.trunk.forEach((bone, k) => {
      const last = k === this.trunk.length - 1
      at.add(
        along
          .copy(bone.at)
          .multiplyScalar(last ? 1 + lifted / bone.at.length() : 1)
          .applyQuaternion(spun),
      )
      spun.slerpQuaternions(pelvis, trunk, this.shares[k])
    })
    at.add(along.copy(this.arms[side][0].at).applyQuaternion(trunk))
    return to.copy(hips).add(at.applyAxisAngle(UP, facing))
  }

  /**
   * Turns the bones to where the hips and the joints are `seconds` on, going as they go now. The hips are at a place in
   * the scene, he `facing` a way there and turning round as he `spins`, and each leg faces as its foot points, its
   * `toes` (rad about y); the top of the trunk is `lifted` with his breath (m).
   */
  pose(
    hips: State &
      Record<'turn' | 'turning' | 'list' | 'listing' | 'facing' | 'spins' | 'lifted', number> & {
        toes: Record<Side, number>
      },
    joints: Joints,
    seconds: number,
  ) {
    const on = ({ value, velocity }: State) => euler.setFromVector3(at.copy(value).addScaledVector(velocity, seconds))
    const fold = (by: State) => folded.setFromEuler(euler.set(on(by).x, 0, 0))
    const lean = on(joints.trunk).x
    trunk.setFromEuler(euler)
    tilt(hips.turn + hips.turning * seconds, hips.list + hips.listing * seconds, lean, pelvis)
    round.setFromAxisAngle(UP, hips.facing + hips.spins * seconds)
    pelvis.premultiply(round)
    trunk.premultiply(round)
    const { place, bone } = this.hips
    place.copy(this.hips.at).applyQuaternion(pelvis).add(at.copy(hips.value).addScaledVector(hips.velocity, seconds))
    this.hips.turn(pelvis)
    bone.position.copy(place).applyMatrix4(this.into)
    // the trunk's turn is shared up it, and the head's down the neck
    const last = this.trunk.length - 1
    this.trunk.forEach((bone, k) =>
      bone.turn(spun.slerpQuaternions(pelvis, trunk, this.shares[k]), k === last ? hips.lifted : undefined),
    )
    turned.setFromEuler(on(joints.head)).premultiply(trunk)
    this.neck?.turn(spun.slerpQuaternions(trunk, turned, this.bows))
    this.head.turn(turned)
    for (const side of SIDES) {
      const [thigh, shin, foot] = this.legs[side]
      thigh.turn(
        turned.setFromEuler(on(joints.legs[side].first)).premultiply(round.setFromAxisAngle(UP, hips.toes[side])),
      )
      shin.turn(turned.multiply(fold(joints.legs[side].second)))
      foot.carry(shin)
      const [upper, fore, hand] = this.arms[side]
      upper.turn(turned.setFromEuler(on(joints.arms[side].first)).premultiply(trunk))
      // the forearm twists about its length as far as the hand is turned about it, and the hand bends at the wrist
      const { x: aside, y: twist, z: bent } = on(joints.arms[side].hand.wrist)
      fore.turn(turned.multiply(fold(joints.arms[side].second)).multiply(folded.setFromEuler(euler.set(0, twist, 0))))
      hand.turn(turned.multiply(folded.setFromEuler(euler.set(aside, 0, bent))))
    }
  }

  /**
   * How far a place is inside him, as he was posed last: in the trunk, band by band as each goes with its bone, the
   * head round its middle, or a thigh from its hip to its knee (m), below 0 outside. `line` is set to the line in him
   * it is deepest in from: up through the band's joint, the head's middle or the thigh.
   */
  depth(place: Vector3, line: Line3) {
    let deepest = -Infinity
    const found = (by: number, a: Vector3, b: Vector3) => {
      if (by <= deepest) return
      deepest = by
      line.set(a, b)
    }
    const { trunk, head } = this.shape
    trunk.forEach((band, k) => {
      const { place: joint, turned } = [this.hips, ...this.trunk][k]
      const from = at.copy(place).sub(joint).applyQuaternion(spun.copy(turned).invert())
      if (from.y < band.low || from.y > band.high) return
      found(deep(band, from.x, from.z), joint, along.copy(UP).applyQuaternion(turned).add(joint))
    })
    const middle = at.copy(head.middle).applyQuaternion(this.head.turned).add(this.head.place)
    found(head.round - place.distanceTo(middle), middle, middle)
    for (const side of SIDES) {
      const [hip, knee] = [this.legs[side][0].place, this.legs[side][1].place]
      const off = place.distanceTo(thigh.set(hip, knee).closestPointToPoint(place, true, along))
      found(this.shape.thigh - off, hip, knee)
    }
    return deepest
  }

  /** turns the bones of the fingers to how they are spread and bent, on hands turned as they were last */
  grasp({ arms }: Joints) {
    for (const side of SIDES) {
      const [fingers, bones] = [arms[side].hand.fingers, this.fingers[side]]
      if (!fingers || !bones) continue
      for (const name of FINGERS) {
        turned.copy(this.arms[side][2].turned)
        // (what hangs from the last bone, where the fingertip is, goes with it)
        fingers.turns(name).forEach((by, k) => bones[name][k].turn(turned.multiply(by)))
      }
    }
  }

  /** turns a foot against its shin, toe down (rad) */
  pitch(side: Side, angle: number) {
    const [, shin, foot] = this.legs[side]
    foot.turn(turned.copy(shin.turned).multiply(folded.setFromEuler(euler.set(angle, 0, 0))))
  }

  /** lays a foot as it stands or steps: toe down so far (rad), pointing where its `toes` do (rad about y), and level across itself however its leg leans to the side */
  tread(side: Side, angle: number, toes: number) {
    this.legs[side][2].turn(turned.setFromAxisAngle(UP, toes).multiply(folded.setFromEuler(euler.set(angle, 0, 0))))
  }
}
