import type { Held, Side, Story } from '@drawcall/animate'
import { flat, type Grip, grip, Hand } from '@drawcall/hand'
import type { PhysicsWorld } from '@drawcall/physics'
import { Matrix4, type Object3D, Quaternion, Vector3 } from 'three'
import { Character } from '../character'
import type { Game, Input } from '../play'
import { BOX, Box, boards, boxes, room, SHELF, shelved, slot } from './store'

/** how fast he walks and runs, and how fast he steps up to where he is to stand (m/s) */
const SPEED = { walk: 1.4, run: 3.5, step: 0.8 }
/** how fast his hands move a held box from place to place, and how long they take at least (m/s, s) */
const LIFT = { speed: 0.6, least: 0.5 }
/** how near a box is for him to take it, and how far its near side is from where he stands to (m) */
const NEAR = { box: 1.2, standoff: 0.22 }
/**
 * how far from the shelf's front he stands to reach onto a board, and to have a box before him clear of the shelf (m)
 */
const AT_SHELF = { near: 0.32, clear: 0.8 }
/** how far above a board a box is moved in over it (m) */
const CLEARANCE = 0.08
/** how long a hand short of a box at its moment may reach on for it (s) */
const REACH = 1
/** how long he steps up to a place at most (s) */
const LONGEST = 3
/** how far a box is raised off the floor before it comes up to him (m) */
const RAISE = 0.08
/** how far above the floor his hands let go of a box they set down: they come down no further (m) */
const DROP = 0.06
/** where the palms are on a box's sides: low, under its weight (m, from its middle) */
const PALMS = new Vector3(0, -BOX.high / 4, 0)
/** what of a hand is on a box's side: the palm and the fingers, flat */
const FLAT = ['palm', 'index', 'middle', 'ring', 'little'] as const
/** how far below ahead the fingers on a box's sides point, as one carries a box before one (rad) */
const FINGERS = 0.5
const UP = new Vector3(0, 1, 0)
const Z = new Vector3(0, 0, 1)
const SHELFWARD = { x: 0, z: 1 }

const yaw = (way: { x: number; z: number }) => Math.atan2(way.x, way.z)

/** a grip turned in its palm's plane, about the palm, for the fingers to point as near a way as they lie: in the target's frame */
function pointed(held: Grip, hand: Hand, way: Vector3): Grip {
  const inHand = new Matrix4().compose(held.position, held.quaternion, new Vector3(1, 1, 1))
  const turn = held.quaternion.clone().invert()
  const handed = hand.side === 'right' ? -1 : 1
  const fingers = new Vector3().crossVectors(hand.thumbward, hand.normal).multiplyScalar(handed).applyQuaternion(turn)
  const normal = hand.normal.clone().applyQuaternion(turn)
  const flat = (v: Vector3) => v.clone().addScaledVector(normal, -v.dot(normal)).normalize()
  const roll = new Quaternion().setFromUnitVectors(flat(fingers), flat(way))
  const palm = held.contacts.palm.at
  const about = new Matrix4().makeTranslation(palm).multiply(new Matrix4().makeRotationFromQuaternion(roll))
  about.multiply(new Matrix4().makeTranslation(palm.clone().negate()))
  const [position, quaternion] = [new Vector3(), new Quaternion()]
  inHand.multiply(about.invert()).decompose(position, quaternion, new Vector3())
  return { ...held, position, quaternion }
}

/**
 * The warehouse worker: he walks where he is led, takes up a box near him by its sides and carries it before him, puts
 * it on the lowest free board when he is at the shelf or else down on the floor, and takes one down off the shelf.
 */
export class Worker implements Game {
  readonly character: Character
  private readonly hands: Record<Side, Hand>
  private readonly boxes: Box[]
  private readonly tops: number[]
  /** the box in his hands, it as he holds it, and which way its side under his left hand faces in its own frame */
  private held?: { box: Box; thing: Held; left: Vector3 }
  /** where he is to step to before his hands go, and the way he faces while they do */
  private spot?: Vector3
  private way?: { x: number; z: number }
  private doing = 'walking'

  constructor(rig: Object3D, world: PhysicsWorld, scene: Object3D) {
    scene.add(rig)
    // (the hands are read while the rig is at rest, before the body poses it)
    this.hands = { left: new Hand(rig, 'left'), right: new Hand(rig, 'right') }
    this.character = new Character(rig, world)
    this.tops = boards(this.character.body.size)
    scene.add(room(this.tops))
    this.boxes = boxes(scene)
  }

  private get body() {
    return this.character.body
  }

  update(delta: number, input: Input) {
    const { body, character } = this
    if (input.act && !body.playing) this.act()
    const speed = input.run && !this.held ? SPEED.run : SPEED.walk
    const asked = body.playing ? this.stepping() : { x: input.move.x * speed, z: input.move.z * speed }
    character.update(delta, asked, body.playing ? this.way : undefined)
  }

  /** what Space does: puts the box he holds on the shelf or the floor, or takes one up */
  private act() {
    const at = this.character.capsule.position
    if (this.held) {
      const before = Math.abs(at.x - SHELF.x) < SHELF.wide / 2 && at.z < SHELF.front && SHELF.front - at.z < 1.2
      const top = this.tops.find((y) => !this.boxes.some((box) => box.free && box.place.distanceTo(slot(y)) < BOX.high))
      this.character.tried(() => this.body.play(before && top !== undefined ? this.shelve(top) : this.setDown()))
      return
    }
    const near = this.boxes
      .map((box) => ({ box, far: box.place.setY(0).distanceTo(at.clone().setY(0)) }))
      .filter(({ far }) => far < NEAR.box)
      .sort((a, b) => a.far - b.far)[0]
    if (near) this.character.tried(() => this.body.play(this.takeUp(near.box)))
  }

  /** how he is led toward the spot he is to stand at (m/s) */
  private stepping() {
    if (!this.spot) return { x: 0, z: 0 }
    const off = this.spot.clone().sub(this.character.capsule.position).setY(0)
    return off.multiplyScalar(4).clampLength(0, SPEED.step)
  }

  /** how a held box is to be turned, he facing a way: its side facing `left` in its frame to his left, upright */
  private square(left: Vector3, facing: { x: number; z: number } = this.body.facing) {
    const turned = new Quaternion().setFromAxisAngle(UP, yaw(facing) + Math.PI / 2 - yaw(left))
    return { pointing: Z.clone().applyQuaternion(turned), up: UP }
  }

  /**
   * where a box is before him, its near side against his front: low before his belly as it rides, or so high (m); from
   * his right shoulder, as he faces
   */
  private before(high?: number) {
    const { body } = this
    const { trunk, shoulder, stand } = body.size
    const up = high === undefined ? -0.55 * trunk : high - this.character.capsule.floor - stand - trunk
    return new Vector3(shoulder, up, body.front('left', up, shoulder) + BOX.side / 2)
  }

  /** where a box is before him, as `before` has it, in the scene */
  private carried(high?: number) {
    const { x, y, z } = this.before(high)
    const { body } = this
    const { stand, trunk, shoulder } = body.size
    const { x: ahead, z: across } = body.facing
    return this.body.hips.value
      .clone()
      .setY(this.character.capsule.floor + stand + trunk + y)
      .add(new Vector3(ahead * z + across * (x - shoulder), 0, across * z - ahead * (x - shoulder)))
  }

  /** he steps to a spot, facing a way, and stands there */
  private *stepTo(spot: Vector3, way: { x: number; z: number }): Story {
    const to = spot.clone().setY(0)
    this.spot = to
    this.way = way
    const end = this.body.time + LONGEST
    const facing = () => this.body.facing.x * way.x + this.body.facing.z * way.z > 0.97
    const at = () => this.character.capsule.position.clone().setY(0).distanceTo(to) < 0.04
    while (!(at() && facing() && this.character.speed < 0.1) && this.body.time < end) yield
    this.spot = undefined
  }

  /** where he stands before the shelf, so far from its front, before a box at `x` */
  private atShelf(x: number, far: number) {
    return new Vector3(x, 0, SHELF.front - far)
  }

  /** his hands move the held box through places in the scene in turn, at a pace of its own: whether it got to the last */
  private *move(path: Vector3[]): Story<boolean> {
    if (!this.held) return false
    const { thing, left, box } = this.held
    let [from, there] = [box.place, false]
    for (const place of path) {
      const seconds = Math.max(LIFT.least, place.distanceTo(from) / LIFT.speed)
      from = place
      there = yield* thing.to(place, { ...this.square(left), seconds })
    }
    return there
  }

  /** the held box rides before him as he goes, so high or low before his belly */
  private ride(high?: number) {
    if (!this.held) return
    this.held.thing.to(this.before(high), { on: this.body, ...this.square(this.held.left, SHELFWARD) })
  }

  /** he steps with the held box before him, so high */
  private *stepWith(spot: Vector3, high: number): Story {
    this.ride(high)
    yield* this.stepTo(spot, SHELFWARD)
  }

  /** he steps up to a box, has its sides between his palms, and lifts it out of where it lies to before him */
  private *takeUp(box: Box): Story {
    this.doing = 'taking'
    const lies = box.place
    const high = shelved(lies)
    const from = this.character.capsule.position
    const way = high ? SHELFWARD : lies.clone().sub(from).setY(0).normalize()
    const spot = high
      ? this.atShelf(lies.x, AT_SHELF.near)
      : lies.clone().addScaledVector(new Vector3(way.x, 0, way.z), -(BOX.side / 2 + NEAR.standoff))
    yield* this.stepTo(spot, way)
    const left = this.side(box, way)
    // (his feet together, to come down to the floor)
    yield* this.body.stand()
    box.take()
    const thing = this.body.hold(box.mesh)
    this.held = { box, thing, left }
    // both palms go flat onto its sides, the left onto the side facing `left` in its frame, the fingers pointing ahead
    // and down
    const ahead = left.clone().cross(UP).applyAxisAngle(left, FINGERS)
    const on = (side: Side, out: Vector3) => {
      const statement = { at: out.clone().multiplyScalar(BOX.side / 2).add(PALMS), from: out, using: FLAT, start: flat }
      return this.body.hand[side].to(pointed(grip(this.hands[side], box.mesh, statement), this.hands[side], ahead))
    }
    const reached = on('left', left)
    const held = (yield* on('right', left.clone().negate())) && (yield* reached)
    // (a hand short of it at its moment reaches on for it as he stays down: with one still short after that, he leaves
    // it where it lies)
    const { hand, time } = this.body
    const both = () => hand.left.there && hand.right.there
    while (!held && !both() && this.body.time < time + REACH) yield
    if (!both()) return this.letGo()
    this.doing = 'lifting'
    // (off a board it is drawn out toward him, off the floor raised a little)
    const carried = this.carried()
    const out = high ? carried.clone().setY(lies.y + CLEARANCE) : lies.clone().setY(lies.y + RAISE)
    yield* this.move([out])
    if (lies.y > carried.y) yield* this.stepWith(this.atShelf(lies.x, AT_SHELF.clear), out.y)
    yield* this.move([this.carried()])
    this.ride()
    this.doing = 'carrying'
  }

  /**
   * he puts the box on the board whose top is so high: it comes up or down before him, in over the board, and he slides
   * it in; to come up over his carrying height he lifts it clear of the shelf and steps in with it
   */
  private *shelve(top: number): Story {
    this.doing = 'shelving'
    const place = slot(top)
    const high = place.y > this.carried().y
    yield* this.stepTo(this.atShelf(place.x, high ? AT_SHELF.clear : AT_SHELF.near), SHELFWARD)
    yield* this.move([this.carried(place.y + CLEARANCE)])
    if (high) yield* this.stepWith(this.atShelf(place.x, AT_SHELF.near), place.y + CLEARANCE)
    // (he lets go of it only once it rests on the board as it is to)
    if (yield* this.move([place])) return this.letGo()
    this.ride()
    this.doing = 'carrying'
  }

  /** he sets the box down on the floor before him */
  private *setDown(): Story {
    this.doing = 'setting down'
    yield* this.stepTo(this.character.capsule.position, { ...this.body.facing })
    // (his feet together, to come down to the floor)
    yield* this.body.stand()
    yield* this.move([this.carried().setY(BOX.high / 2 + DROP)])
    this.letGo()
  }

  /** the box is let go where it is, and his hands are his own again */
  private letGo() {
    this.held?.thing.free()
    this.held?.box.release()
    this.held = undefined
    this.doing = 'walking'
  }

  /** which side of a box, in its own frame, is most to his left as he faces a way */
  private side(box: Box, way: { x: number; z: number }) {
    const left = new Vector3(way.z, 0, -way.x)
    const turned = box.mesh.getWorldQuaternion(new Quaternion())
    const sides = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)]
    const most = (side: Vector3) => side.clone().applyQuaternion(turned).dot(left)
    return sides.reduce((best, side) => (most(side) > most(best) ? side : best))
  }

  readout() {
    const shelf = this.boxes.filter((box) => box.free && shelved(box.place)).length
    return [`worker    ${this.doing}`, `shelf     ${shelf} of ${this.tops.length} boards`].join('\n')
  }

  focus() {
    return new Vector3(SHELF.x, 1, SHELF.front)
  }
}
