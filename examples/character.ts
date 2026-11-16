import { Body, type Story } from '@drawcall/animate'
import type { Grip, Hand } from '@drawcall/hand'
import type { PhysicsWorld } from '@drawcall/physics'
import { Object3D, Vector3 } from 'three'
import { Capsule } from './capsule'

/** how high and how wide the capsule the world moves him as is (of how high his hips stand) */
const CAPSULE = { high: 1.9, radius: 0.32 }
/** how fast his going changes toward what the player asks on open ground (m/s²) */
const PUSH = 8
const GRAVITY = 9.81
/** how much the player's ask has to change from what it was when an action began for him to take his character back from it (m/s) */
const TURNED = 0.5

/** where he stands on open, flat ground and how he goes there, as the player moves him: nothing to bump into */
export class Ground {
  /** how he is asked to go along the ground (m/s), and how he goes */
  readonly asked = new Vector3()
  readonly velocity = new Vector3()
  readonly position = new Vector3()
  readonly grounded = true

  /** how high the ground under him is */
  get floor() {
    return this.position.y
  }

  update(delta: number) {
    this.velocity.add(this.asked.clone().sub(this.velocity).clampLength(0, PUSH * delta))
    this.position.addScaledVector(this.velocity, delta)
  }
}

/**
 * A game's character: a rigged body and what moves him along the ground. His going has one owner at a time. The
 * player owns it: each frame the feet go as the game asks and the body is led after them. Or an action owns it, a
 * story played by `act` that needs his legs: the player has no say, the feet follow the body, and when it is over the
 * player leads him on from where he stands. What the body could not do it says, once, here.
 */
export class Character {
  readonly body: Body
  /** what moves him for the player: open ground, or with a physics world a capsule that it moves */
  readonly feet: Ground | Capsule
  /** what the body could not do, as it said so, the latest last */
  readonly errors: string[] = []
  /** whether an action owns his going */
  acting = false
  private readonly gravity: number

  /** `rig` is his rigged body at rest, standing where he is to start; with a `world`, a capsule moves him through it */
  constructor(
    readonly rig: Object3D,
    world?: PhysicsWorld,
  ) {
    this.body = new Body(rig)
    const { stand } = this.body.size
    this.feet = world ? new Capsule(world, new Object3D(), CAPSULE.radius * stand, CAPSULE.high * stand) : new Ground()
    this.gravity = world ? -world.gravity[1] : GRAVITY
  }

  /** the capsule that moves him, for a game on a physics world */
  get capsule() {
    if (!(this.feet instanceof Capsule)) throw new Error('he goes on open ground, with no capsule')
    return this.feet
  }

  /** how fast he goes along the ground (m/s) */
  get speed() {
    const { x, z } = this.feet.velocity
    return Math.hypot(x, z)
  }

  /** has the body do something, noting what it could not */
  tried(act: () => void) {
    try {
      act()
    } catch (error) {
      this.note(error)
    }
  }

  note(error: unknown) {
    const said = error instanceof Error ? error.message : String(error)
    if (said === this.errors[this.errors.length - 1]) return
    console.warn(said)
    this.errors.push(said)
  }

  /**
   * An action that needs his legs, written as a story: a walk or a run, a foot placed, a hand by a moment. It owns his
   * going until it is over.
   */
  act(story: Story<unknown>) {
    this.cancel()
    this.acting = true
    this.action = this.owned(story)
    this.body.play(this.action)
    this.led.copy(this.feet.asked)
  }

  /** the action going on, if any, and how the player asked him to go when it began */
  private action?: Story
  private readonly led = new Vector3()

  /** the action going on is over at once: what it had of him goes on from the state it is in, and the player leads him from there */
  cancel() {
    if (!this.action) return
    this.action.return(undefined)
    this.action = undefined
    this.body.cancel()
  }

  private *owned(story: Story<unknown>): Story {
    try {
      yield* story
    } finally {
      this.acting = false
      this.action = undefined
    }
  }

  /**
   * he jumps, leaving the ground so fast (m/s), if he stands on it: the body drops and pushes off, and a capsule leaves
   * the ground as the body does. Tells the moment he is highest, or NaN if he cannot jump now
   */
  jump(up: number) {
    const { body, feet } = this
    if (!feet.grounded || body.highest() > body.time) return Number.NaN
    const top = feet.position.clone().setY(feet.floor + body.size.stand + (up * up) / (2 * this.gravity))
    this.tried(() => body.jump(top))
    const highest = body.highest()
    if (feet instanceof Capsule) feet.jump(up, highest - up / this.gravity - body.time)
    return highest
  }

  /**
   * a frame of `delta` seconds. The player owning his going, the feet go toward going as `asked` along the ground
   * (m/s), and the body is led so, facing `way` if that is said, else the way he goes; an action owning it, the feet
   * follow where the body takes him. What else the body is to do this frame is stated before
   */
  update(delta: number, asked: { x: number; z: number }, way?: { x: number; z: number }) {
    const { body, feet } = this
    // (asked to go another way than when it began, the player takes him back from an action at once: letting go of the keys is no such ask)
    const now = new Vector3(asked.x, 0, asked.z)
    if (this.acting && now.length() > TURNED && this.led.distanceTo(now) > TURNED) this.cancel()
    if (this.acting) {
      this.tried(() => body.update(delta))
      const { value, velocity } = body.hips
      feet.position.set(value.x, feet.position.y, value.z)
      feet.velocity.set(velocity.x, feet.velocity.y, velocity.z)
      return
    }
    feet.asked.set(asked.x, 0, asked.z)
    feet.update(delta)
    const { velocity, position, floor } = feet
    this.tried(() => {
      body.go({ x: velocity.x, z: velocity.z })
      body.face(way)
      body.hips.at({ x: position.x, y: floor, z: position.z })
    })
    this.tried(() => body.update(delta))
  }
}

/**
 * which way a hand's palm faces on a thing it holds by a grip, in the thing's frame, and which way the thing points its
 * z there: what turns a hand sent `with` the grip for the thing to be turned so, once it is bound to the hand
 */
export function lying(hand: Hand, held: Grip) {
  return { palm: hand.normal.clone().applyQuaternion(held.quaternion.clone().invert()), pointing: new Vector3(0, 0, 1) }
}

/** a hand has a thing from the start: it is bound to him where the grip seats it in the hand as the hand is now. Tells the thing as bound */
export function inHand(body: Body, hand: Hand, held: Grip) {
  const thing = body.bind(held.target)
  thing.on(body.hand[hand.side], held)
  return thing
}
