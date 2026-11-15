import { Object3D, Quaternion, Vector3 } from 'three'
import { flat, type Ground, Locomotion, type Run, type Walk } from '@drawcall/locomotion'
import { type Band, Bindings, Bones, both, due, End, joints, type Part, parts, type Side, SIDES, SIGN, type Size, type Story, UP, type Xyz } from '@drawcall/limbs'
import { Clock, type Workings } from './clock'
import { type Intent, intent } from './intent'
import { type Binder, type Foot, type Hand, hand as handOf, stay, type Thing, thing } from './ends'

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
  private readonly locomotion: Locomotion
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
  private readonly bindings: Bindings
  private readonly binder: Binder
  /** what he is made of, for telling what he means to do */
  private readonly workings: Workings

  /** the body of a rigged humanoid, as it is posed now: its rest pose. Places are told from where the `rig` is, along its axes */
  constructor(rig: Object3D) {
    const bones = (this.bones = new Bones(rig))
    const size = (this.size = bones.size)
    const turning = joints(bones)
    const locomotion = (this.locomotion = new Locomotion(this, bones, turning))
    const carried = locomotion.carrier
    const rigged = (end: 'foot' | 'hand', side: Side) => ({
      frame: bones.frame,
      rig,
      limb: bones.starts[end][side],
      body: this,
      ...bones.lies(end, side),
    })
    const foot = both(
      (side) => new End(`${side} foot`, 'foot', side, turning.legs[side], carried, size, rigged('foot', side)),
    )
    const hand = both(
      (side) => new End(`${side} hand`, 'hand', side, turning.arms[side], carried, size, rigged('hand', side)),
    )
    const bindings = (this.bindings = new Bindings(bones, () => locomotion.facing))
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
      body: this,
      onHim: (side, place) =>
        place.clone().applyMatrix4(bones.frame).sub(bones.shouldered(side, new Vector3())).applyAxisAngle(UP, -locomotion.facing),
    }
    this.hand = both((side) => handOf(hand[side], this.binder))
    for (const side of SIDES) ends.set(this.hand[side], hand[side])
    const { going, hips: at } = locomotion
    this.hips = { ...at, to: (target, way) => going.to(target, way), at: (place) => going.at(place) }
    this.trunk = turning.trunk
    this.head = turning.head
    this.arm = both((side) => turning.arms[side].first)
    this.forearm = both((side) => turning.arms[side].second)
    for (const part of parts(turning)) part.free()
    for (const side of SIDES) foot[side].anchor = locomotion.stands(side)
    const all = { size, bones, locomotion, joints: turning, bindings, ends: { foot, hand } }
    this.clock = new Clock((this.workings = all))
    rigs.set(rig, this)
    this.clock.pose(0)
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
    if (on === this) return new Quaternion().setFromAxisAngle(UP, this.locomotion.facing)
    if (!(on instanceof Object3D)) return turn
    on.updateWorldMatrix(true, false)
    return turn.multiply(on.getWorldQuaternion(new Quaternion()))
  }

  /** the place on the ground where a foot stands under its hip, he over a place, facing as he does: where a story puts one down */
  ground(side: Side, to: Ground) {
    const { x, z } = flat(to)
    const { hip, ankle } = this.size
    const y = this.locomotion.ground + ankle
    return new Vector3(SIGN[side] * hip, 0, 0).applyAxisAngle(UP, this.locomotion.facing).add({ x, y, z })
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

  /** which way he faces along the ground, in the scene: what `face` turns him to */
  get facing() {
    return new Vector3(0, 0, 1).applyAxisAngle(UP, this.locomotion.facing)
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
    return this.locomotion.going.when(to)
  }

  /** the moment he is highest in the jump he is making, or in the air, is to make next, on the clock of `time`: with none, now */
  highest() {
    return this.locomotion.going.highest()
  }

  /**
   * Walks to a place on the ground: he turns to go there, and the hips speed up, keep to `speed` if the way is long
   * enough to get up to it, and ease to rest there, the feet stepping under them. With a foot to `plant`, the strides
   * come out even onto that foot there, and he stays on it, the other where it was. The story it returns is over when
   * he is there.
   */
  walk(to: Ground, way: Walk = {}) {
    return this.locomotion.going.walk(to, way)
  }

  /**
   * Runs to where a foot is planted `at` its place on the ground, turning to go there: the `plant` foot, if it
   * matters which. The hips speed up, pushed by each foot on the ground with a `push` (m/s²), and keep to `speed`, and
   * if they are to `arrive` over that foot slower, brake onto the last strides as hard as the legs do. The story it
   * returns is over when the hips are over that foot: `when(at)` tells that moment.
   */
  run(run: Run): Story {
    return this.locomotion.going.run(run)
  }

  /**
   * He is to be going so: `velocity` is how fast and which way along the ground, in the scene (m/s). He gets up to it
   * and round to it by his own gait, walking or running by how fast it is, and keeps to it until he is told otherwise:
   * at none, he comes to rest where his speed carries him. It takes the place of a walk or a run he is on, a jump he
   * is making he still makes, and he is not brought to a stand for want of a story.
   */
  go(velocity: { x: number; z: number }) {
    return this.locomotion.going.go(velocity)
  }

  /**
   * He faces a way along the ground, in the scene, wherever he goes: backwards or sideways rather than turn from it,
   * at a walk. With none he faces the way he goes again. The story it returns is over when he faces so.
   */
  face(way?: { x: number; z: number }): Story<boolean> {
    return this.locomotion.going.face(way)
  }

  /**
   * He looks at a place until told otherwise, a way being a place far off along it: the head first and furthest, the
   * trunk round and up or down as far as it leads the pelvis, so aiming what hangs from it, its own leans going on.
   * Standing, he turns to face what the head does not reach, unless he is to `face` a way: then the trunk keeps to that
   * and only the head turns from it; going, he goes his way.
   */
  look(place?: Xyz) {
    return this.locomotion.going.look(place)
  }

  /**
   * He is knocked: the place struck, `at` in the scene or the middle of his chest, is set going at `velocity` (m/s). The
   * further it is from the hips against the trunk's height, the more the trunk turns about them and the less they go;
   * carried further than a step is worth, he steps after them, as far as a step catches, and comes round in a beat or
   * two. A rifle's kick at the shoulder is about 0.5 m/s, a shove 1, a blow that has him step 2 and more.
   */
  knock(velocity: Xyz, at?: Xyz) {
    return this.locomotion.going.knock(velocity, at)
  }

  /**
   * Jumps for the hips to be at a place at the top of it, up and on the way he is going by then: `highest()` tells
   * that moment. Going to where a run or a walk ends, he drops on the way in and takes off from the footfall there;
   * nearer than that, standing or led, he drops at once; in the air, once he has come down. Led, he leaves the ground
   * going as he is led, and a top his legs cannot push him to he goes as near as they push. The story it returns is
   * over when he has landed.
   */
  jump(top: Xyz): Story<boolean> {
    return this.locomotion.going.jump(top)
  }

  /**
   * Comes to a stand: whatever the story has is let go but the hands on what is bound to him, which stay on it, how he
   * is to face and where to look with it, and the hips come to
   * rest where their speed carries them, the feet stepping under them and together. Out of the air he comes down first. The
   * story it returns is over when he stands.
   */
  stand(): Story<boolean> {
    const stands = this.locomotion.stand(() => {
      for (const side of SIDES) for (const end of [this.foot[side], this.hands[side]]) end.free()
    })
    // (the hands on what is bound to him stay on it: what the body moves stays where it is on him)
    this.bindings.rejoin()
    for (const { thing: object, outside } of this.bindings.bound) if (!outside) stay(object, this.binder)
    return stands
  }

  /**
   * time goes on by `delta` seconds, a step at a time: the stories go on, the hips and the feet go where they are
   * going, the goals come nearer, the free parts react, and the joints turn to where that puts them
   */
  update(delta: number) {
    this.clock.update(delta)
  }
}
