import { Object3D, Quaternion, Vector3 } from 'three'
import { Ahead, carrier, flat, Going, type Ground, Mover, Reactions, type Run, Stance, Stoops, type Walk } from '@drawcall/locomotion'
import { type Band, Bindings, Bones, both, type Carrying, due, End, Gives, joints, type Part, parts, type Side, SIDES, SIGN, type Size, type Story, UP, type Xyz } from '@drawcall/limbs'
import { Clock, type Workings } from './clock'
import { type Intent, intent } from './intent'
import { type Binder, type Foot, type Hand, hand as handOf, type On, type Thing, thing } from './ends'

/**
 * where the pocket of a shoulder is that a stock rests in, from its joint: so far above it (of his trunk) and in
 * toward his middle (of how far out a shoulder is), on his front
 */
const POCKET = { up: 0.1, inward: 0.25 }

/**
 * A thing he holds, which the hands that hold it move: sent to a place, it is there, turned as said, as near as the
 * right hand can have it if that holds it, else the left, the other on it going with it; `free` has the hand on a side let go of it, or
 * with none every hand, and he holds it no more.
 */
export type Held = {
  to(place: Xyz, how?: Carrying & On & { seconds?: number }): Story<boolean>
  by(when: number, place: Xyz, how?: Carrying & On): Story<boolean>
  free(side?: Side): void
}

/** the body made for each rig */
const rigs = new WeakMap<Object3D, Body>()

/**
 * A person as joints that turn, which turn the bones of a rigged humanoid. The hips are given somewhere to go, and the
 * feet step under them; the feet and the hands can be sent to places, the trunk, the head and the arms to rotations
 * against what they hang on, rest being none. Every part has its strength, so it takes the time it needs and moves
 * like a thing with weight, and every joint turns only as far as joints do. What is not sent anywhere reacts to what
 * the rest of the body does: the trunk leans into a push and winds up for a fast hand, the arms swing against the legs.
 */
export class Body {
  /** how large he is, as the rig is at rest */
  readonly size: Size
  private readonly bones: Bones
  private readonly mover: Mover
  private readonly going: Going
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
  private readonly hands: Record<Side, End>
  private readonly gives: Gives
  private readonly bindings: Bindings
  private readonly binder: Binder
  /** what he is made of, for telling what he means to do */
  private readonly workings: Workings

  /** the body of a rigged humanoid, as it is posed now: its rest pose. Places are told from where the `rig` is, along its axes */
  constructor(rig: Object3D) {
    const bones = (this.bones = new Bones(rig))
    const size = (this.size = bones.size)
    const turning = joints(bones)
    const mover = (this.mover = new Mover(size, new Stoops(size, turning.trunk)))
    const ahead = new Ahead(this, mover, turning, bones)
    const reactions = new Reactions(mover, turning, ahead)
    const carried = carrier(mover, ahead)
    const { trunk, shoulder: wide } = size
    const pocket = (side: Side) => {
      const [up, inward] = [POCKET.up * trunk, POCKET.inward * wide]
      return new Vector3(-SIGN[side] * inward, up, this.front(side, up, inward))
    }
    const gives = (this.gives = new Gives(bones, carried, both(pocket)))
    const rigged = (end: 'foot' | 'hand', side: Side) => ({
      frame: bones.frame,
      rig,
      limb: bones.starts[end][side],
      body: this,
      ...bones.lies(end, side),
      held: (part: Object3D) => gives.held(part),
    })
    const foot = both(
      (side) => new End(`${side} foot`, 'foot', side, turning.legs[side], carried, size, rigged('foot', side)),
    )
    const hand = both(
      (side) => new End(`${side} hand`, 'hand', side, turning.arms[side], carried, size, rigged('hand', side)),
    )
    const bindings = (this.bindings = new Bindings(bones))
    this.foot = foot
    this.hands = hand
    const ends = new Map<Hand, End>()
    this.binder = {
      bindings,
      clock: this,
      end: (of) => {
        const found = ends.get(of)
        if (!found) throw new Error('a thing is bound to a hand that is not his')
        return found
      },
      ways: (on) => this.ways(on),
    }
    this.hand = both((side) => handOf(hand[side], this.binder))
    for (const side of SIDES) ends.set(this.hand[side], hand[side])
    const stance = both((side) => new Stance(size, side, turning.legs[side], foot[side], mover.foot[side]))
    const at = { value: new Vector3(), velocity: new Vector3() }
    const going = (this.going = new Going(this, size, mover, ahead, turning, { foot, hand }, reactions, at))
    this.hips = { ...at, to: (target, way) => going.to(target, way), at: (place) => going.at(place) }
    this.trunk = turning.trunk
    this.head = turning.head
    this.arm = both((side) => turning.arms[side].first)
    this.forearm = both((side) => turning.arms[side].second)
    for (const part of parts(turning)) part.free()
    const stood = both(() => new Vector3())
    for (const side of SIDES) foot[side].anchor = stood[side].copy(mover.foot[side].at)
    const all = { size, bones, mover, joints: turning, ahead, reactions, gives, bindings, going, ends: { foot, hand }, stance, stood, hips: at }
    this.clock = new Clock((this.workings = all))
    rigs.set(rig, this)
    this.clock.pose(0)
  }

  /**
   * He holds a thing from now on: a hand sent to it by a grip takes hold of it where it is, and the hands that hold it
   * move it, written in its parent's frame, as near where it is set or sent as they can have it, out of him; held by
   * none, it is the scene's. With a point of it, in its frame, that `rests`, that point rests in the pocket of the
   * shoulder of the hand that holds it nearest it, while no hand carries it.
   */
  hold(thing: Object3D, { rests }: { rests?: Xyz } = {}): Held {
    if (rests && !Number.isFinite(rests.x + rests.y + rests.z)) throw new Error('a point rests that no numbers say')
    const give = this.gives.hold(thing, rests && new Vector3().copy(rests))
    // (the right hand carries it if it holds it, or is on its way to: else the left; with neither, it stays)
    const lead = (place: Xyz, how: Carrying & { seconds?: number; by?: number }) => {
      const hand = [this.hands.right, this.hands.left].find((hand) => hand.takes(give))
      return hand ? hand.carry(give, place, how) : (function* (): Story<boolean> { return false })()
    }
    return {
      to: (place, how = {}) => lead(place, how),
      by: (when, place, how = {}) => lead(place, { ...how, by: when }),
      free: (side) => {
        for (const each of side ? [side] : SIDES) if (this.hands[each].takes(give)) this.hands[each].letGo()
        if (!side) this.gives.drop(thing)
      },
    }
  }

  /**
   * A thing is bound to him from now on, and moved by one owner: the body, or from `outside`. Hands go `on` it by
   * grips. Moved by the body, the first hand on it leads it, and the story sends the thing, never that hand: it is the
   * end of that arm, offset by the grip, so the body plans it as it plans a hand, and every other hand on it follows
   * it. Moved from outside, the game or physics sets where it is every frame, and every hand on it follows it as near
   * as the arm reaches. `free` gives it up, telling how fast it was moving.
   */
  bind(object: Object3D, { outside = false }: { outside?: boolean } = {}): Thing {
    return thing(object, outside, this.binder)
  }

  /** what is bound to him: each thing, the sides of the hands on it, the leading one first, whether it turns with that hand, and whether it is moved from outside */
  get bound() {
    return this.bindings.bound
  }

  /** what turns a way counted as a place `on` him, on a thing or in the scene into the frame of the body */
  private ways(on?: Object3D | Body) {
    const turn = new Quaternion().setFromRotationMatrix(this.bones.frame)
    if (on === this) return new Quaternion().setFromAxisAngle(UP, this.mover.facing)
    if (!(on instanceof Object3D)) return turn
    on.updateWorldMatrix(true, false)
    return turn.multiply(on.getWorldQuaternion(new Quaternion()))
  }

  /** the place on the ground where a foot stands under its hip, he over a place, facing as he does: where a story puts one down */
  ground(side: Side, to: Ground) {
    const { x, z } = flat(to)
    const { hip, ankle } = this.size
    const y = this.mover.origin.y + ankle
    return new Vector3(SIGN[side] * hip, 0, 0).applyAxisAngle(UP, this.mover.facing).add({ x, y, z })
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
   * where the pocket of a shoulder is, as he was posed last, in the scene: where the butt of a stock rests, so far above
   * the joint and in toward his middle, on his front, going with his chest
   */
  pocket(side: Side) {
    const { trunk, shoulder: wide } = this.size
    const [up, inward] = [POCKET.up * trunk, POCKET.inward * wide]
    const at = new Vector3(-SIGN[side] * inward, up, this.front(side, up, inward))
    return this.bones.shouldered(side, at).applyMatrix4(this.bones.frame.clone().invert())
  }

  /** which way he faces along the ground, in the scene: what `face` turns him to */
  get facing() {
    return new Vector3(0, 0, 1).applyAxisAngle(UP, this.mover.facing)
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

  /** the moment the hips come by a place on the ground, going as they are, it on their way: or to rest, where they are to come to rest there; NaN if they never do */
  when(to: Ground) {
    return this.going.when(to)
  }

  /** the moment he is highest in the jump he is making, or in the air, is to make next, on the clock of `time`: with none, now */
  highest() {
    return this.going.highest()
  }

  /**
   * Walks to a place on the ground: he turns to go there, and the hips speed up, keep to `speed` if the way is long
   * enough to get up to it, and ease to rest there, the feet stepping under them. With a foot to `plant`, the strides
   * come out even onto that foot there, and he stays on it, the other where it was. The story it returns is over when
   * he is there.
   */
  walk(to: Ground, way: Walk = {}) {
    return this.going.walk(to, way)
  }

  /**
   * Runs to where a foot is planted `at` its place on the ground, turning to go there: the `plant` foot, if it
   * matters which. The hips speed up, pushed by each foot on the ground with a `push` (m/s²), and keep to `speed`, and
   * if they are to `arrive` over that foot slower, brake onto the last strides as hard as the legs do. The story it
   * returns is over when the hips are over that foot: `when(at)` tells that moment.
   */
  run(run: Run): Story {
    return this.going.run(run)
  }

  /**
   * He is to be going so: `velocity` is how fast and which way along the ground, in the scene (m/s). He gets up to it
   * and round to it by his own gait, walking or running by how fast it is, and keeps to it until he is told otherwise:
   * at none, he comes to rest where his speed carries him. It takes the place of a walk or a run he is on, a jump he
   * is making he still makes, and he is not brought to a stand for want of a story.
   */
  go(velocity: { x: number; z: number }) {
    return this.going.go(velocity)
  }

  /**
   * He faces a way along the ground, in the scene, wherever he goes: backwards or sideways rather than turn from it,
   * at a walk. With none he faces the way he goes again. The story it returns is over when he faces so.
   */
  face(way?: { x: number; z: number }): Story<boolean> {
    return this.going.face(way)
  }

  /**
   * He looks at a place until told otherwise, a way being a place far off along it: the head first and furthest, the
   * trunk round and up or down as far as it leads the pelvis, so aiming what hangs from it, its own leans going on.
   * Standing, he turns to face what the head does not reach, unless he is to `face` a way: then the trunk keeps to that
   * and only the head turns from it; going, he goes his way. Looking `over` a point `on` a thing his hands hold, as a
   * rifle's sight, which rests in his shoulder, he has it on the line from his eye there, the head coming down to it:
   * the eye on the side of that shoulder.
   */
  look(place?: Xyz, how: { over?: Xyz; on?: Object3D } = {}) {
    return this.going.look(place, how)
  }

  /**
   * He is knocked: the place struck, `at` in the scene or the middle of his chest, is set going at `velocity` (m/s). The
   * further it is from the hips against the trunk's height, the more the trunk turns about them and the less they go;
   * carried further than a step is worth, he steps after them, as far as a step catches, and comes round in a beat or
   * two. A rifle's kick at the shoulder is about 0.5 m/s, a shove 1, a blow that has him step 2 and more.
   */
  knock(velocity: Xyz, at?: Xyz) {
    return this.going.knock(velocity, at)
  }

  /**
   * Jumps for the hips to be at a place at the top of it, up and on the way he is going by then: `highest()` tells
   * that moment. Going to where a run or a walk ends, he drops on the way in and takes off from the footfall there;
   * nearer than that, standing or led, he drops at once; in the air, once he has come down. Led, he leaves the ground
   * going as he is led, and a top his legs cannot push him to he goes as near as they push. The story it returns is
   * over when he has landed.
   */
  jump(top: Xyz): Story<boolean> {
    return this.going.jump(top)
  }

  /**
   * Comes to a stand: whatever the story has is let go, how he is to face and where to look with it, and the hips come to
   * rest where their speed carries them, the feet stepping under them and together. Out of the air he comes down first. The
   * story it returns is over when he stands.
   */
  stand(): Story<boolean> {
    return this.going.stand()
  }

  /**
   * time goes on by `delta` seconds, a step at a time: the stories go on, the hips and the feet go where they are
   * going, the goals come nearer, the free parts react, and the joints turn to where that puts them
   */
  update(delta: number) {
    this.clock.update(delta)
  }
}
