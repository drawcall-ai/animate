import { Matrix4, type Object3D, Quaternion, Vector3 } from 'three'
import type { Bones } from './bones'
import type { End } from './end'
import type { Grip } from './fingers'
import { NUDGE } from './world'

/**
 * a hand on a thing by a grip, `turning` it with the hand or not, and where the grip seats the thing in the hand: its
 * origin from the wrist and how it is turned, in the frame of the hand as it hangs
 */
type Bond = { hand: End; grip: Grip; turning: boolean; seat: { at: Vector3; turn: Quaternion } }
/**
 * a thing bound to his hands: whether it is moved from `outside`, the hands on it, the first leading; how large it is
 * in the frame of the body; how it is turned there when its leading hand does not turn it, and how it turns on its way
 * to a way it is sent to point; how far it was from where its hand has it as it was taken, and when, for it to ease
 * into it; and how it moves, and where it was a nudge on, or last frame
 */
type Bound = {
  thing: Object3D
  outside: boolean
  bonds: Bond[]
  scale: Vector3
  turn: Quaternion
  turns?: { from: Quaternion; to: Quaternion; leaves: number; when: number }
  off: { at: Vector3; turn: Quaternion; since: number }
  velocity: Vector3
  ahead?: Vector3
  seen?: { at: Vector3; time: number }
}

/** how long a thing taken from where it is eases into where its hand has it (in his beats) */
const EASE = 1
const at = new Vector3()
const scaled = new Vector3()
const turned = new Quaternion()
const matrix = new Matrix4()
const into = new Matrix4()
const easing = new Matrix4()
const ONE = new Vector3(1, 1, 1)

/** whether a thing is another, or a part of it, that goes with it */
function within(part: Object3D, thing: Object3D) {
  for (let on: Object3D | null = part; on; on = on.parent) if (on === thing) return true
  return false
}

const eased = (share: number) => {
  const s = Math.min(1, Math.max(0, share))
  return s * s * (3 - 2 * s)
}

/**
 * The things bound to his hands. A thing is moved by one owner at a time: the body, or from `outside`, by the game or
 * physics setting where it is. Moved by the body, it is the end of the arm of the hand that leads it, the first bound,
 * offset by the grip: wherever that hand goes it goes, turning with it if bound `turning`; bound by a point, its origin
 * goes where the grip seats it in the hand, a ball's middle, and it keeps its own turn, or turns as it is sent to point. Every other hand on it follows it, sent onto its grip, as near as the arm reaches, and never
 * moves it. Moved from outside, every hand on it follows it. Taken from where it is, it eases into where its hand has
 * it; freed, it is the scene's again, where it is, moving as it was.
 */
export class Bindings {
  private readonly all = new Map<Object3D, Bound>()

  /** `bones` are those of the body whose hands have the things */
  constructor(private readonly bones: Bones) {}

  /** what is bound: each thing, the sides of the hands on it, the leading one first, whether it turns with that, and whether it is moved from outside */
  get bound() {
    return [...this.all.values()]
      .filter(({ bonds }) => bonds.length > 0)
      .map(({ thing, bonds, outside }) => ({
        thing,
        hands: bonds.map(({ hand }) => hand.side),
        turning: !outside && bonds[0].turning,
        outside,
      }))
  }

  /** a thing is bound to him from now on, moved by the body or from `outside`, as of the moment `now` */
  bind(thing: Object3D, outside: boolean, now: number) {
    const bound = this.all.get(thing)
    if (bound?.outside === outside) return
    if (!bound) {
      const off = { at: new Vector3(), turn: new Quaternion(), since: now }
      this.all.set(thing, { thing, outside, bonds: [], scale: new Vector3(1, 1, 1), turn: new Quaternion(), off, velocity: new Vector3() })
      return
    }
    // (handed over: moved by the body, it leads with its first hand from where it is, the others following)
    bound.outside = outside
    for (const bond of bound.bonds) if (bond.hand.follows.some((on) => within(on, thing))) bond.hand.free()
    for (const bond of outside ? bound.bonds : bound.bonds.slice(1)) void bond.hand.to(bond.grip)
    if (!outside && bound.bonds.length) this.seated(bound, now)
  }

  /** the hand leading a thing the body moves, and by which grip, if one does */
  lead(thing: Object3D) {
    const bound = this.all.get(thing)
    return bound && !bound.outside ? bound.bonds[0] : undefined
  }

  /**
   * A hand goes on a thing by a grip, at the moment `now`, in place of how it was on it: the first on a thing the
   * body moves leads it, which eases into it from where it is; any other follows it.
   */
  on(thing: Object3D, hand: End, grip: Grip, turning: boolean, now: number) {
    const bound = this.found(thing)
    const elsewhere = [...this.all.values()].find((other) => other !== bound && other.bonds.some((bond) => bond.hand === hand))
    if (elsewhere) this.off(elsewhere.thing, hand, now)
    const { hangs, large } = this.bones.lies('hand', hand.side)
    const seat = {
      at: new Vector3().copy(grip.position).multiplyScalar(large).applyQuaternion(hangs),
      turn: new Quaternion().copy(grip.quaternion).premultiply(hangs),
    }
    const bond = { hand, grip, turning, seat }
    const k = bound.bonds.findIndex((one) => one.hand === hand)
    if (k >= 0) bound.bonds[k] = bond
    else bound.bonds.push(bond)
    const leads = !bound.outside && bound.bonds[0] === bond
    if (!leads) return void hand.to(grip)
    if (this.loops(hand, hand.follows.filter((on) => !within(on, thing)))) {
      bound.bonds.splice(bound.bonds.indexOf(bond), 1)
      throw new Error(`the ${hand.name} is to lead a thing that moves it, through what it follows`)
    }
    if (hand.follows.some((on) => within(on, thing))) hand.free()
    this.seated(bound, now)
  }

  /**
   * A hand comes off a thing at the moment `now`: one that followed it is the body's again; the next on it leads it
   * from where it is, if it was led
   */
  off(thing: Object3D, hand: End, now: number) {
    const bound = this.all.get(thing)
    const k = bound?.bonds.findIndex((bond) => bond.hand === hand) ?? -1
    if (!bound || k < 0) return
    bound.bonds.splice(k, 1)
    if (hand.follows.some((on) => within(on, thing))) hand.free()
    const [next] = bound.bonds
    if (k > 0 || bound.outside || !next) return
    if (next.hand.follows.some((on) => within(on, thing))) next.hand.free()
    this.seated(bound, now)
  }

  /** the thing is bound no more: every hand comes off it, and it is the scene's. Tells how fast it was moving, in the scene */
  free(thing: Object3D) {
    const bound = this.all.get(thing)
    if (!bound) return new Vector3()
    for (const { hand } of bound.bonds) if (hand.follows.some((on) => within(on, thing))) hand.free()
    this.all.delete(thing)
    return this.velocity(bound)
  }

  /** how fast a thing moves, in the scene */
  velocity(bound: Bound | Object3D) {
    const of = 'bonds' in bound ? bound : this.all.get(bound)
    // (the frame of the body is the scene's turned and moved, not scaled)
    return (of?.velocity.clone() ?? new Vector3()).applyQuaternion(turned.setFromRotationMatrix(this.bones.frame).invert())
  }

  /** whether every hand on a thing is where it is to be: the leading one, if it is sent anywhere */
  there(thing: Object3D) {
    const bonds = this.all.get(thing)?.bonds ?? []
    return bonds.length > 0 && bonds.every(({ hand }) => hand.there || hand.last === undefined)
  }

  /** a thing a hand leads by a point turns, in the frame of the body, from as it is to `to`, between the moments it `leaves` and is there `when` */
  turn(thing: Object3D, to: Quaternion, leaves: number, when: number) {
    const bound = this.all.get(thing)
    if (!bound) return
    bound.turns = { from: this.turning(bound, leaves).clone(), to: to.clone(), leaves, when }
  }

  /** how a thing is turned, in the frame of the body, as it is now */
  turned(thing: Object3D) {
    this.placed(thing, matrix).decompose(at, turned, scaled)
    return turned.clone()
  }

  /** throws if a hand sent onto a thing would follow what moves it: what it leads, or what follows that */
  follow(hand: End, thing: Object3D) {
    if (this.loops(hand, [thing])) {
      throw new Error(`the ${hand.name} is sent onto a thing it leads: the thing goes with it, and cannot also lead it`)
    }
  }

  /** after a step, every hand that follows a thing is put where it has it on the thing as it is: derived, not planned */
  pin() {
    for (const bound of this.all.values()) {
      const followers = bound.outside ? bound.bonds : bound.bonds.slice(1)
      for (const { hand } of followers) if (hand.follows.some((on) => within(on, bound.thing))) hand.pin()
    }
  }

  /** notes where each thing is a nudge on, at the moment `now`, as the bones are posed now: for how it moves */
  measure(now: number) {
    for (const bound of this.all.values()) {
      if (this.leads(bound)) bound.ahead = new Vector3().setFromMatrixPosition(this.where(bound, now, matrix))
    }
  }

  /**
   * each thing the body moves is where its leading hand has it as the bones are posed, at the moment `now`, written in
   * its parent's frame
   */
  write(now: number) {
    const { frame } = this.bones
    for (const bound of this.all.values()) {
      const { thing } = bound
      if (!this.leads(bound)) continue
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

  private found(thing: Object3D) {
    const bound = this.all.get(thing)
    if (!bound) throw new Error('a hand goes on a thing that is not bound to him')
    return bound
  }

  /** whether a hand leads it */
  private leads(bound: Bound) {
    return !bound.outside && bound.bonds.length > 0
  }

  /**
   * as an update for the moment `now` begins: each thing moved from outside, or by no hand, was set where it is to be
   * by then, and how fast it moves is told from where it was set for the update before
   */
  watch(now: number) {
    for (const bound of this.all.values()) {
      if (this.leads(bound)) continue
      this.placed(bound.thing, matrix).decompose(at, turned, scaled)
      const { seen } = bound
      if (seen && now > seen.time) bound.velocity.copy(at).sub(seen.at).divideScalar(now - seen.time)
      bound.seen = { at: at.clone(), time: now }
    }
  }

  /** whether leading a thing, or following these things, leads a hand round to what it leads */
  private loops(hand: End, things: Object3D[], seen = new Set<End>()): boolean {
    return things.some((thing) =>
      this.leaders(thing).some((leader) => {
        if (leader === hand) return true
        if (seen.has(leader)) return false
        seen.add(leader)
        return this.loops(hand, leader.follows, seen)
      }),
    )
  }

  /** the hands that move a thing: the one leading it or what it is part of */
  private leaders(thing: Object3D) {
    return [...this.all.values()].flatMap((bound) => (within(thing, bound.thing) && this.leads(bound) ? [bound.bonds[0].hand] : []))
  }

  /** where a thing is, in the frame of the body */
  private placed(thing: Object3D, to: Matrix4) {
    thing.updateWorldMatrix(true, false)
    return to.multiplyMatrices(this.bones.frame, thing.matrixWorld)
  }

  /** how it is turned at the moment `now`, led by a point: as it was, or on its way to how it is sent to point */
  private turning(bound: Bound, now: number) {
    const { turns } = bound
    if (!turns) return bound.turn
    const share = turns.when > turns.leaves ? (now - turns.leaves) / (turns.when - turns.leaves) : 1
    bound.turn.slerpQuaternions(turns.from, turns.to, eased(share))
    if (share >= 1) bound.turns = undefined
    return bound.turn
  }

  /** its leading hand has changed: it is turned as it is now, and eases from here into where that hand has it */
  private seated(bound: Bound, now: number) {
    const is = this.placed(bound.thing, new Matrix4())
    is.decompose(at, bound.turn, bound.scale)
    bound.turns = undefined
    const { off } = bound
    off.since = now
    off.at.set(0, 0, 0)
    off.turn.identity()
    this.where(bound, now, matrix).invert().multiply(is).decompose(off.at, off.turn, scaled)
  }

  /**
   * where a thing is to be at the moment `now`, as the bones are posed, in the frame of the body: where its leading
   * hand has it, still on its way there from where it was taken
   */
  private where(bound: Bound, now: number, to: Matrix4) {
    const { bonds, scale, off } = bound
    const { hand: { side }, seat, turning } = bonds[0]
    const { wrist, hand } = this.bones
    const pos = new Vector3().copy(seat.at).applyQuaternion(hand[side]).add(wrist[side])
    const turn = turning ? new Quaternion().copy(hand[side]).multiply(seat.turn) : this.turning(bound, now).clone()
    // (easing in: what was off at the start is left off less and less, until none is)
    const left = 1 - eased((now - off.since) / (EASE * this.bones.size.beat))
    easing.compose(off.at.clone().multiplyScalar(left), new Quaternion().slerp(off.turn, left), ONE)
    return to.compose(pos, turn, scale).multiply(easing)
  }
}
