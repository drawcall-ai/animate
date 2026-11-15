import { Body } from '@drawcall/animate'
import type { Grip, Hand } from '@drawcall/hand'
import type { PhysicsWorld } from '@drawcall/physics'
import { Matrix4, Object3D, Vector3 } from 'three'
import { Capsule } from './capsule'

/** how high and how wide the capsule the world moves him as is (of how high his hips stand) */
const CAPSULE = { high: 1.9, radius: 0.32 }

/**
 * A game's character: a rigged body led by a capsule the physics world moves. Each frame the capsule goes as the game
 * asks, and the body is told how it goes and where it is by then; what the body could not do it says, once, here.
 */
export class Character {
  readonly body: Body
  readonly capsule: Capsule
  /** what the body could not do, as it said so, the latest last */
  readonly errors: string[] = []

  /** `rig` is his rigged body at rest, standing where the `world` is to move him from */
  constructor(
    readonly rig: Object3D,
    private readonly world: PhysicsWorld,
  ) {
    this.body = new Body(rig)
    const { stand } = this.body.size
    this.capsule = new Capsule(world, new Object3D(), CAPSULE.radius * stand, CAPSULE.high * stand)
  }

  /** how fast he goes along the ground (m/s) */
  get speed() {
    const { x, z } = this.capsule.velocity
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
   * he jumps, leaving the ground so fast (m/s), if he stands on it: the body drops and pushes off, and the capsule leaves
   * the ground as the body does. Tells the moment he is highest, or NaN if he cannot jump now
   */
  jump(up: number) {
    const { body, capsule } = this
    if (!capsule.grounded || body.highest() > body.time) return Number.NaN
    const gravity = -this.world.gravity[1]
    const top = capsule.position.clone().setY(capsule.floor + body.size.stand + (up * up) / (2 * gravity))
    this.tried(() => body.jump(top))
    const highest = body.highest()
    capsule.jump(up, highest - up / gravity - body.time)
    return highest
  }

  /**
   * a frame: the capsule goes for `delta` seconds toward going as `asked` along the ground (m/s), and the body is led
   * so, facing `way` if that is said, else the way he goes; what else the body is to do this frame is stated before
   */
  update(delta: number, asked: { x: number; z: number }, way?: { x: number; z: number }) {
    const { body, capsule } = this
    capsule.asked.set(asked.x, 0, asked.z)
    capsule.update(delta)
    const { x, z } = capsule.velocity
    const { position, floor } = capsule
    this.tried(() => {
      body.go({ x, z })
      body.face(way)
      body.hips.at({ x: position.x, y: floor, z: position.z })
    })
    this.tried(() => body.update(delta))
  }
}

/**
 * A body holds a thing in a hand from the start: it is put where the grip has its part in the hand as the hand is
 * now, and the hand takes hold of it there. Tells the thing as he holds it.
 */
export function holds(body: Body, hand: Hand, held: Grip, thing = held.target) {
  hand.bone.updateWorldMatrix(true, false)
  thing.updateWorldMatrix(true, true)
  const part = thing.matrixWorld.clone().invert().multiply(held.target.matrixWorld)
  const large = held.target.getWorldScale(new Vector3()).divide(hand.bone.getWorldScale(new Vector3()))
  const placed = new Matrix4().compose(held.position, held.quaternion, large)
  const world = hand.bone.matrixWorld.clone().multiply(placed).multiply(part.invert())
  if (thing.parent) world.premultiply(thing.parent.matrixWorld.clone().invert())
  world.decompose(thing.position, thing.quaternion, thing.scale)
  const holding = body.hold(thing)
  body.hand[hand.side].to(held)
  return holding
}
