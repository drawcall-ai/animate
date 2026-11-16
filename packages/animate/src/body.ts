import { Object3D, Vector3 } from 'three'
import { type Side, SIDES, SIGN, UP, wrap } from '@drawcall/gait'
import { type Xyz } from '@drawcall/plan'
import { Bones } from './rig/bones'
import { type Part } from './rig/goal'
import { joints, parts } from './rig/joints'
import { type Band } from './rig/shape'
import { both, type Size } from './rig/size'
import { due, type Story, waits } from './story'
import type { Mover } from '@drawcall/plan'
import { Clock, type Workings } from './clock'
import { End, type Foot, type Hand } from './ends'
import { type Intent, intent } from './intent'
import { OnHim, Watched } from './movers'
import { Asks } from './posture'
import { Free } from './free'
import { Legs } from './legs'
import { Bound, type Thing } from './thing'

/** the body made for each rig */
/** how near the way he is to face counts as facing it (rad), and how far a knock carries him before he steps after it (in legs) */
const [FACED, KNOCK] = [0.02, 0.114]
const rigs = new WeakMap<Object3D, Body>()

/** a place on the ground, or told as a number, so far along z on x = 0; a run to one and a walk */
type Ground = number | { x: number; z: number }
const flat = (to: Ground) => (typeof to === 'number' ? { x: 0, z: to } : to)
type Run = { speed: number; at: Ground; plant?: Side; push?: number; arrive?: number }
type Walk = { speed?: number; plant?: Side }

/**
 * A person as joints that turn, which turn the bones of a rigged humanoid. The hips are given somewhere to go, and the
 * feet step under them; the feet and the hands are channels a story writes frames to, each a place, a velocity and a
 * moment, and every thing bound to him is one too; the trunk, the head and the arms can be sent to rotations against
 * what they hang on, rest being none. Every part has its strength, so it takes the time it needs and moves like a
 * thing with weight, and every joint turns only as far as joints do. What is not sent anywhere reacts to what the rest
 * of the body does: the trunk turns after a hand and his weight goes with it, he gets down for a low one, and the arms
 * swing against the legs.
 */
export class Body {
  /** how large he is, as the rig is at rest */
  readonly size: Size
  private readonly bones: Bones
  private readonly legs: Legs
  private readonly free: Free
  private readonly clock: Clock
  /**
   * the hips: where they are and how they move, `to` a place they go at a walk, or to a height alone, which they are
   * held at wherever he goes, and `at` the place on the ground the world has them at by the end of the next update,
   * the ground there as high as its y: standing between feet the story has put down, he keeps to them, as near it as
   * they let him
   */
  readonly hips: Readonly<Record<'value' | 'velocity', Vector3>> & {
    to(target: Xyz | { y: number }, way?: Walk): Story<boolean>
    at(place: { x: number; y?: number; z: number }): void
  }
  /** what a story sends to rotations (rad about x, y and z), against what each hangs on */
  readonly trunk: Part
  readonly head: Part
  readonly arm: Record<Side, Part>
  readonly forearm: Record<Side, Part>
  /** what a story sends to places (m) */
  readonly foot: Record<Side, Foot>
  readonly hand: Record<Side, Hand>
  /** what he is made of, for telling what he means to do */
  private readonly workings: Workings
  private readonly things = new Map<Object3D, Bound>()
  private readonly watched = new Map<Object3D, Watched>()

  /** the body of a rigged humanoid, as it is posed now: its rest pose. Places are told from where the rig is, along its axes */
  constructor(rig: Object3D) {
    const bones = (this.bones = new Bones(rig))
    const size = (this.size = bones.size)
    const turning = joints(bones)
    const facing = () => ({ at: legs.hips.value, velocity: legs.hips.velocity, facing: legs.facing, ground: legs.ground })
    const asks = new Asks([], size, both(() => new Vector3()), facing, turning.trunk)
    const legs = (this.legs = new Legs(this, bones, turning, asks))
    const free = (this.free = new Free(legs, turning, size))
    const body = { size, gait: legs.gait, him: this, time: () => this.time, mover: (thing: Object3D) => this.mover(thing), frame: bones.frame, changed: () => asks.forget(), lowering: (side: Side, place: Vector3) => asks.lowering(side, place), rising: () => asks.rising(turning.trunk.value.x, size.stand - (legs.hips.value.y - legs.ground)) }
    const end = (kind: 'hand' | 'foot', side: Side) => {
      const limb = kind === 'hand' ? turning.arms[side] : turning.legs[side]
      const root = new OnHim(legs.gait)
      return new End(kind, side, limb, root, body, bones.lies(kind, side), bones.starts[kind][side])
    }
    const ends = { hand: both((side) => end('hand', side)), foot: both((side) => end('foot', side)) }
    asks.hands.push(ends.hand.left, ends.hand.right)
    this.hand = both((side) => facade(ends.hand[side]) as Hand)
    this.foot = both((side) => facade(ends.foot[side]) as Foot)
    const { hips: at } = legs
    this.hips = { ...at, to: (target, way) => legs.to(target, way), at: (place) => legs.at(place) }
    this.trunk = turning.trunk
    this.head = turning.head
    this.arm = both((side) => turning.arms[side].first)
    this.forearm = both((side) => turning.arms[side].second)
    for (const part of parts(turning)) part.free()
    for (const side of SIDES) ends.foot[side].anchor = legs.stands(side)
    const all = { rig, size, bones, legs, free, joints: turning, ends, things: this.things, watched: this.watched, asks }
    this.clock = new Clock((this.workings = all))
    rigs.set(rig, this)
    this.clock.pose(0)
    for (const side of SIDES) {
      asks.shoulders[side].copy(bones.shouldered(side, new Vector3())).sub(legs.hips.value)
      asks.shoulders[side].applyAxisAngle(UP, -legs.facing)
      ends.hand[side].root.rest.copy(asks.shoulders[side])
      ends.foot[side].root.rest.copy(bones.hip(side)).sub(legs.hips.value).applyAxisAngle(UP, -legs.facing)
    }
  }

  /** a thing as he sees it move */
  private seen(thing: Object3D, carries = true) {
    return new Watched(thing, this.bones.frame, () => ({ at: this.legs.hips.value, facing: this.legs.facing }), carries)
  }

  /** what a frame on a thing moves on: its channel if it is bound to him, or the thing as it is seen to move */
  private mover(thing: Object3D): Mover {
    const bound = this.things.get(thing)
    // (bound with no hand on it yet, it is the world's)
    if (bound?.hands.length) return bound.channel
    let watched = this.watched.get(thing)
    if (!watched) this.watched.set(thing, (watched = this.seen(thing)))
    watched.look(this.time)
    return watched
  }

  /**
   * A thing is bound to him from now on, and moved by one owner: the body, or from `outside`. Hands go `on` it by
   * grips. Moved by the body, the story sends the thing, never a hand on it: every hand on it goes with it, bound
   * where its grip has it, and the body plans it as the end of the first hand's arm. Moved from outside, the game or
   * physics sets where it is every frame, and every hand on it follows it as near as the arm reaches. `free` gives it
   * up, every hand on it going on as it was moving, and tells how fast it was moving.
   */
  bind(object: Object3D, { outside = false }: { outside?: boolean } = {}): Thing {
    const { ends } = this.workings
    const of = (hand: Hand) => {
      const found = SIDES.find((side) => this.hand[side] === hand)
      if (!found) throw new Error('a thing is bound to a hand that is not his')
      return ends.hand[found]
    }
    const { strength, draw } = ends.hand.right.channel
    const others = (end: End) => {
      for (const thing of this.things.values()) {
        const k = thing.hands.findIndex((one) => one.end === end)
        if (k >= 0) thing.hands.splice(k, 1)
      }
    }
    const bound = new Bound(object, outside, this.bones.frame, of, others, this, (thing) => this.mover(thing), () => this.time, (thing) => this.seen(thing, false), () => this.workings.asks.forget(), { strength, draw })
    this.things.set(object, bound)
    return bound.facade()
  }

  /** what is bound to him: each thing, the sides of the hands on it and the grips they hold it by, and whether it is moved from outside */
  get bound() {
    return [...this.things.values()].filter(({ hands }) => hands.length).map(({ mesh, hands, outside }) => ({ thing: mesh, hands: hands.map(({ end }) => end.side), grips: hands.map(({ grip }) => grip), outside }))
  }

  /** the place on the ground where a foot stands under its hip, he over a place, facing as he does: where a story puts one down */
  ground(side: Side, to: Ground) {
    const { x, z } = flat(to)
    const { hip, ankle } = this.size
    const y = this.legs.ground + ankle
    return new Vector3(SIGN[side] * hip, 0, 0).applyAxisAngle(UP, this.legs.facing).add({ x, y, z })
  }

  /**
   * how far ahead of a shoulder his front is, so far above it and so far in from it toward his middle, as he stands at
   * rest (m): where his skin or what he wears is, for what is held against his chest or rests in his shoulder. Out past
   * the side of his trunk it is as far ahead as the line up through it
   */
  front(side: Side, up = 0, inward = 0) {
    const off = ({ low, high }: Band) => Math.max(low - up, up - high, 0)
    const bands = this.bones.beside(side).filter(({ low, high }) => high > low)
    const [near] = bands.sort((one, other) => off(one) - off(other))
    if (!near) throw new Error('his trunk has no front to tell')
    // (across from the line up through the band, to his left positive, and as far as its side is that way)
    const across = -SIGN[side] * inward - near.x
    const wide = across > 0 ? near.left : near.right
    return near.z + near.front * Math.sqrt(Math.max(0, 1 - (across / wide) ** 2))
  }

  /** where his eye on a side is, in the scene */
  eye(side: Side) {
    return this.bones.eye(side).applyMatrix4(this.bones.frame.clone().invert())
  }

  /**
   * where a place counted from the joint of a shoulder is, as he was posed last, in the scene: along the axes of his
   * chest, which it goes with, as he faces at rest (+x his left, +y up, +z ahead), so that `front` tells how far ahead
   * his skin is there
   */
  shoulder(side: Side, place: Xyz = { x: 0, y: 0, z: 0 }) {
    return this.bones.shouldered(side, new Vector3().copy(place)).applyMatrix4(this.bones.frame.clone().invert())
  }

  /** the gait he walks and runs by: its hips and feet, and what it means to do */
  get gait() {
    return this.legs.gait
  }

  /** which way he faces along the ground, in the scene: what `face` turns him to */
  get facing() {
    return new Vector3(0, 0, 1).applyAxisAngle(UP, this.legs.facing)
  }

  /** the body made for a rig, if one was */
  static of(rig: Object3D): Body | undefined {
    return rigs.get(rig)
  }

  /** what he means to do, and where he is: for whoever looks, as the debug view does. It costs only when asked and changes nothing of him */
  intent(): Intent {
    return intent(this.workings, this.time)
  }

  /** the seconds it has gone on for */
  get time() {
    return this.clock.time
  }

  /** has a story played, beside whatever is playing */
  play(story: Story<unknown>) {
    this.clock.stories.push(story)
  }

  get playing() {
    return this.clock.stories.length > 0
  }

  /** a story that is over at a moment, on the clock of `time` */
  *until(when: number): Story {
    if (Number.isNaN(when)) throw new Error('he is to wait until a moment that is no number')
    while (!due(this.time, when)) yield
  }

  /** the story of coming to rest where he goes */
  private arrives() {
    return waits(() => true, () => this.gait.arrived)
  }

  /** the moment the hips come by a place on the ground, going as they are, it on their way: or to rest, where they are to come to rest there; NaN if they never do */
  when(to: Ground) {
    return this.gait.when(flat(to))
  }

  /** the moment he is highest in the jump he is making, or in the air, is to make next, on the clock of `time`: with none, now */
  highest() {
    return this.gait.highest()
  }

  /**
   * Walks to a place on the ground: he turns to go there, and the hips speed up, keep to `speed` if the way is long
   * enough to get up to it, and ease to rest there, the feet stepping under them. With a foot to `plant`, the strides
   * come out even onto that foot there, and he stays on it, the other where it was. The story it returns is over when
   * he is there.
   */
  walk(to: Ground, way: Walk = {}) {
    this.gait.walk(flat(to), way)
    return this.arrives()
  }

  /**
   * Runs to where a foot is planted `at` its place on the ground, turning to go there: the `plant` foot, if it
   * matters which. The hips speed up, pushed by each foot on the ground with a `push` (m/s²), and keep to `speed`, and
   * if they are to `arrive` over that foot slower, brake onto the last strides as hard as the legs do. The story it
   * returns is over when the hips are over that foot: `when(at)` tells that moment.
   */
  run(run: Run): Story {
    const { gait } = this
    const comes = gait.run({ ...run, at: flat(run.at) })
    return (function* () {
      while (gait.time < comes - 1e-9) yield
    })()
  }

  /**
   * He is to be going so: `velocity` is how fast and which way along the ground, in the scene (m/s). He gets up to it
   * and round to it by his own gait, walking or running by how fast it is, and keeps to it until he is told otherwise:
   * at none, he comes to rest where his speed carries him. It takes the place of a walk or a run he is on, a jump he
   * is making he still makes, and he is not brought to a stand for want of a story.
   */
  go(velocity: { x: number; z: number }) {
    this.legs.go(velocity)
  }

  /**
   * He faces a way along the ground, in the scene, wherever he goes: backwards or sideways rather than turn from it,
   * at a walk. With none he faces the way he goes again. The story it returns is over when he faces so.
   */
  face(way?: { x: number; z: number }): Story<boolean> {
    const { gait } = this
    gait.face(way)
    return waits(() => true, () => way === undefined || Math.abs(wrap(Math.atan2(way.x, way.z) - gait.lead.facing)) < FACED)
  }

  /**
   * He looks at a place until told otherwise, a way being a place far off along it: the head first and furthest, the
   * trunk round and up or down as far as it leads the pelvis, so aiming what hangs from it, its own leans going on.
   * Standing, he turns to face what the head does not reach, unless he is to `face` a way: then the trunk keeps to that
   * and only the head turns from it; going, he goes his way.
   */
  look(place?: Xyz) {
    this.free.look(place)
  }

  /**
   * He is knocked: the place struck, `at` in the scene or the middle of his chest, is set going at `velocity` (m/s). The
   * further it is from the hips against the trunk's height, the more the trunk turns about them and the less they go;
   * carried further than a step is worth, he steps after them, as far as a step catches, and comes round in a beat or
   * two. A rifle's kick at the shoulder is about 0.5 m/s, a shove 1, a blow that has him step 2 and more.
   */
  knock(velocity: Xyz, at?: Xyz) {
    void at
    // (carried further than a step is worth, he is to rest there and steps after the hips; else he sways back over his feet)
    const by = new Vector3(velocity.x, 0, velocity.z)
    this.gait.hips.velocity.add(by)
    const carries = by.lengthSq() / 6
    if (carries > KNOCK * this.size.leg) this.gait.lead.place.addScaledVector(by, carries / by.length())
  }

  /**
   * Jumps for the hips to be at a place at the top of it, up and on the way he is going by then: `highest()` tells
   * that moment. Going to where a run or a walk ends, he drops on the way in and takes off from the footfall there;
   * nearer than that, standing or led, he drops at once; in the air, once he has come down. Led, he leaves the ground
   * going as he is led, and a top his legs cannot push him to he goes as near as they push. The story it returns is
   * over when he has landed.
   */
  jump(top: Xyz): Story<boolean> {
    this.gait.jump(top)
    return waits(() => true, () => !this.gait.jumps)
  }

  /**
   * Comes to a stand: whatever the story has is let go but the hands on what is bound to him, which stay on it, how he
   * is to face and where to look with it, and the hips come to
   * rest where their speed carries them, the feet stepping under them and together. Out of the air he comes down first. The
   * story it returns is over when he stands.
   */
  stand(): Story<boolean> {
    this.letGo()
    for (const part of [this.trunk, this.head]) part.free()
    this.free.look()
    this.gait.stand()
    this.hold()
    return this.arrives()
  }

  /** whatever the stories have is let go at once, going on from the state it is in, but the hands on what is bound to him, which stay on it as it stays where it is on him: for a game, on fresh input */
  cancel() {
    this.letGo()
    this.hold()
  }

  private letGo() {
    const { ends, things } = this.workings
    const bound = new Set([...things.values()].flatMap(({ hands }) => hands.map(({ end }) => end)))
    for (const side of SIDES) for (const end of [ends.foot[side], ends.hand[side]]) if (!bound.has(end)) end.free()
  }

  /** what the body moves stays where it is on him, and the hands on it stay on it */
  private hold() {
    for (const thing of this.workings.things.values()) if (!thing.outside) thing.cancel()
  }

  /**
   * time goes on by `delta` seconds, a step at a time: the stories go on, the hips and the feet go where they are
   * going, the goals come nearer, the free parts react, and the joints turn to where that puts them
   */
  update(delta: number) {
    this.clock.update(delta)
  }
}

/** what a story has of an end */
function facade(end: End): Hand | Foot {
  return {
    value: end.value,
    velocity: end.velocity,
    get there() {
      return end.there
    },
    get anchor() {
      return end.anchor
    },
    to: (place: never, { seconds, ...how }: { seconds?: number } = {}) => end.send(place, how, { seconds }),
    by: (when: number, place: never, how = {}) => end.send(place, how, { by: when }),
    shape: (pose?: never, how?: { by?: number }) => end.shape(pose, how),
    cancel: () => end.cancel(),
    free: () => end.free(),
  } as unknown as Hand
}
