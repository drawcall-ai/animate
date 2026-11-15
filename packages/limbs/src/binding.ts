import { Matrix4, type Object3D, Quaternion, Vector3 } from 'three'
import type { Bones } from './bones'
import type { End } from './end'
import type { Grip } from './fingers'
import type { Limb } from './limb'
import type { Side } from './size'
import { NUDGE } from './world'

/**
 * how a thing goes with a hand: by a grip, `turning` with the hand as the grip seats it in it, or only by the `point`
 * of it, in its frame, that the grip has at the middle of the palm, `palm` in the frame of the hand as it hangs
 */
type Bond = { hand: End; grip: Grip; turning: boolean; seat: Seat; point: Vector3; palm: Vector3 }
/** where a thing sits in a hand by a grip, from the wrist, and how it is turned, in the frame of the hand as it hangs */
type Seat = { at: Vector3; turn: Quaternion }
/**
 * a thing bound to a hand, or by points to two: the hands it goes with, the first leading; how large it is in the frame
 * of the body; how it is turned against the leading hand, with two, or in the scene, with one by a point; how far it
 * was from where they have it as the last of them took it or let go, and when, for it to ease into it; and how it moves
 */
type Bound = {
  thing: Object3D
  bonds: Bond[]
  scale: Vector3
  turn: Quaternion
  off: { at: Vector3; turn: Quaternion; since: number }
  velocity: Vector3
  ahead?: Vector3
}

/** how long a thing taken from where it is eases into where its hands have it (in his beats) */
const EASE = 1
const at = new Vector3()
const other = new Vector3()
const turned = new Quaternion()
const matrix = new Matrix4()
const into = new Matrix4()
const easing = new Matrix4()
const scaled = new Vector3()
const ONE = new Vector3(1, 1, 1)

/** whether a thing is another, or a part of it, that goes with it */
function within(part: Object3D, thing: Object3D) {
  for (let on: Object3D | null = part; on; on = on.parent) if (on === thing) return true
  return false
}

/**
 * The things bound to his hands, which go with them, written where the hands have them each time the body is posed:
 * by a grip, turning with the hand, a ball, a racket, a box that the other hand follows; or by a point of it to each of
 * two hands, a bar, a spear, set between them and turned along the line through them, its roll the leading hand's.
 * A hand follows a thing by being sent onto it (`End`); a thing is never moved by what it moves, and goes with one hand
 * turning, or with two by a point each. A thing taken eases from where it is into where its hands have it, and one let
 * go is the scene's again, where it is, moving as it was.
 */
export class Bindings {
  private readonly all = new Map<Object3D, Bound>()

  /** `bones` are those of the body whose hands, at the ends of its `arms`, have the things */
  constructor(
    private readonly bones: Bones,
    private readonly arms: Record<Side, Limb>,
  ) {}

  /** what is bound to which hands, and whether it turns with the hand */
  get bound() {
    return [...this.all.values()].map(({ thing, bonds }) => ({
      thing,
      hands: bonds.map(({ hand }) => hand.side),
      turning: bonds[0].turning,
    }))
  }

  /**
   * The thing a grip holds goes with a hand from now on, from where it is, at the moment `now`: turning with it, or by
   * a point alone. A hand that follows it lets it be and is the body's, as the thing now goes with it.
   */
  take(hand: End, grip: Grip, turning: boolean, now: number) {
    const thing = grip.target
    const bound = this.all.get(thing)
    const others = bound?.bonds.filter((bond) => bond.hand !== hand) ?? []
    if (others.length > 0 && (turning || others[0].turning)) {
      throw new Error(
        `the ${hand.name} takes what the ${others[0].hand.name} has: one hand has a thing turning with it, or two by a point each (\`turning: false\`)`,
      )
    }
    if (hand.follows.some((on) => within(on, thing))) hand.free()
    const { hangs, large } = this.bones.lies('hand', hand.side)
    const seat = {
      at: new Vector3().copy(grip.position).multiplyScalar(large).applyQuaternion(hangs),
      turn: new Quaternion().copy(grip.quaternion).premultiply(hangs),
    }
    const scale = new Vector3()
    this.placed(thing, matrix).decompose(at, turned, scale)
    const palm = this.arms[hand.side].hand?.fingers?.tip('palm', 0) ?? new Vector3()
    const point = palm.clone().sub(seat.at).applyQuaternion(seat.turn.clone().invert()).divide(scale)
    const bond = { hand, grip, turning, point, palm, seat }
    const was = bound?.bonds ?? []
    const off = { at: new Vector3(), turn: new Quaternion(), since: now }
    const taken: Bound = bound ?? { thing, bonds: [], scale, turn: new Quaternion(), off, velocity: new Vector3() }
    taken.bonds = [...others, bond]
    this.all.set(thing, taken)
    if (this.loops(hand, hand.follows)) {
      taken.bonds = was
      if (!was.length) this.all.delete(thing)
      throw new Error(`the ${hand.name} takes a thing that moves it, through what it follows`)
    }
    this.seated(taken, now)
  }

  /**
   * The hand lets go of what is bound to it, where it is, at the moment `now`, and tells how fast it was moving then,
   * in the scene: held by no hand it is the scene's; by another by a point, it goes with that one alone.
   */
  letGo(hand: End, now: number) {
    const bound = [...this.all.values()].find(({ bonds }) => bonds.some((bond) => bond.hand === hand))
    if (!bound) throw new Error(`the ${hand.name} lets go, and nothing is bound to it`)
    bound.bonds = bound.bonds.filter((bond) => bond.hand !== hand)
    if (bound.bonds.length) this.seated(bound, now)
    else this.all.delete(bound.thing)
    // (the frame of the body is the scene's turned and moved, not scaled)
    return bound.velocity.clone().applyQuaternion(turned.setFromRotationMatrix(this.bones.frame).invert())
  }

  /** throws if a hand sent onto a thing would follow what moves it: what is bound to it, or what follows that */
  follow(hand: End, thing: Object3D) {
    if (this.loops(hand, [thing])) {
      throw new Error(`the ${hand.name} is sent onto a thing it moves: what is bound to it goes with it, and cannot also lead it`)
    }
  }

  /** notes where each thing is a nudge on, at the moment `now`, as the bones are posed now: for how it moves */
  measure(now: number) {
    for (const bound of this.all.values()) bound.ahead = new Vector3().setFromMatrixPosition(this.where(bound, now, matrix))
  }

  /** each thing is where its hands have it as the bones are posed, at the moment `now`, written in its parent's frame */
  write(now: number) {
    const { frame } = this.bones
    for (const bound of this.all.values()) {
      const { thing } = bound
      const to = this.where(bound, now, matrix)
      if (bound.ahead) {
        bound.velocity.setFromMatrixPosition(to).sub(bound.ahead).divideScalar(-NUDGE)
        bound.ahead = undefined
      }
      thing.parent?.updateWorldMatrix(true, false)
      into.multiplyMatrices(frame, thing.parent?.matrixWorld ?? new Matrix4()).invert()
      to.premultiply(into).decompose(thing.position, thing.quaternion, thing.scale)
      thing.updateMatrix()
    }
  }

  /** whether following these things leads a hand round to what is bound to it */
  private loops(hand: End, things: Object3D[], seen = new Set<End>()): boolean {
    return things.some((thing) =>
      this.holders(thing).some((holder) => {
        if (holder === hand) return true
        if (seen.has(holder)) return false
        seen.add(holder)
        return this.loops(hand, holder.follows, seen)
      }),
    )
  }

  /** the hands that move a thing: those bound to it or to what it is part of */
  private holders(thing: Object3D) {
    return [...this.all.values()].flatMap(({ thing: bound, bonds }) => (within(thing, bound) ? bonds.map(({ hand }) => hand) : []))
  }

  /** where a thing is, in the frame of the body */
  private placed(thing: Object3D, to: Matrix4) {
    thing.updateWorldMatrix(true, false)
    return to.multiplyMatrices(this.bones.frame, thing.matrixWorld)
  }

  /** its hands have changed: it is turned against them as it is now, and eases from here into where they have it */
  private seated(bound: Bound, now: number) {
    const [lead] = bound.bonds
    const is = this.placed(bound.thing, new Matrix4())
    is.decompose(at, bound.turn, scaled)
    if (bound.bonds.length > 1) bound.turn.premultiply(turned.copy(this.bones.hand[lead.hand.side]).invert())
    const { off } = bound
    off.since = now
    off.at.set(0, 0, 0)
    off.turn.identity()
    this.where(bound, now, matrix).invert().multiply(is).decompose(off.at, off.turn, scaled)
  }

  /**
   * where a thing is to be at the moment `now`, as the bones are posed, in the frame of the body: where its hands have
   * it, still on its way there from where it was taken
   */
  private where(bound: Bound, now: number, to: Matrix4) {
    const { bonds, scale, off } = bound
    const [lead, second] = bonds
    const { wrist, hand } = this.bones
    const pos = new Vector3()
    const turn = new Quaternion()
    const palm = (bond: Bond, to: Vector3) => to.copy(bond.palm).applyQuaternion(hand[bond.hand.side]).add(wrist[bond.hand.side])
    if (lead.turning) {
      const { seat } = lead
      turn.copy(hand[lead.hand.side]).multiply(seat.turn)
      pos.copy(seat.at).applyQuaternion(hand[lead.hand.side]).add(wrist[lead.hand.side])
    } else if (!second) {
      turn.copy(bound.turn)
      pos.copy(palm(lead, at)).sub(scaled.copy(lead.point).multiply(scale).applyQuaternion(turn))
    } else {
      // (turned with the leading hand, then the short way for the line through its points to lie along that through the palms)
      turn.copy(hand[lead.hand.side]).multiply(bound.turn)
      const along = scaled.copy(second.point).sub(lead.point).multiply(scale).applyQuaternion(turn).normalize()
      const across = other.copy(palm(second, other)).sub(palm(lead, at)).normalize()
      turn.premultiply(new Quaternion().setFromUnitVectors(along, across))
      const middle = scaled.copy(lead.point).add(second.point).multiplyScalar(0.5).multiply(scale).applyQuaternion(turn)
      pos.copy(palm(lead, at)).add(palm(second, other)).multiplyScalar(0.5).sub(middle)
    }
    // (easing in: what was off at the start is left off less and less, until none is)
    const share = Math.min(1, (now - off.since) / (EASE * this.bones.size.beat))
    const left = 1 - share * share * (3 - 2 * share)
    easing.compose(off.at.clone().multiplyScalar(left), new Quaternion().slerp(off.turn, left), ONE)
    return to.compose(pos, turn, scale).multiply(easing)
  }
}
