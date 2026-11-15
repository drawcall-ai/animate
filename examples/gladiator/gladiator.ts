import type { Held, Story } from '@drawcall/animate'
import { grip, Hand, type Statement } from '@drawcall/hand'
import type { PhysicsWorld } from '@drawcall/physics'
import { type Object3D, Vector3 } from 'three'
import { Character, holds } from '../character'
import type { Game, Input } from '../play'
import { POST } from './game'

/** how fast he walks and runs, and goes behind his raised shield (m/s) */
const SPEED = { walk: 1.4, run: 4.2, guard: 0.9 }
/** the key held to raise the shield */
const GUARD = 'KeyE'
/** how far along the blade from the middle of the grip the part is that lands (m) */
const BLADE = 0.35
/** how long after a blow lands he takes before the next is his to give (s) */
const RECOVER = 0.25
/** how far ahead of his right shoulder the grip of a blow in the air is struck through (of his arm) */
const AHEAD = 0.75
/** how long from the press until the blow lands, which gives it the whole body's swing (s) */
const WIND = 0.5
/** how near ahead of him the post must be for a blow at it (cos of the angle off his facing) */
const FACING = 0.7
/**
 * the raised shield: where it is held, from his left shoulder, in toward his middle, down and ahead past his
 * front (of his arm); which way its face is turned, ahead and a little in; and which way its top points, up and
 * leaning ahead over his forearm, as he faces (+x his left, +y up, +z ahead)
 */
const RAISED = { inward: 0.3, down: 0.05, ahead: 0.15, face: { x: -0.45, y: 0, z: 1 }, top: { x: 0, y: 0.8, z: 0.6 } }

/**
 * The blows he gives in turn: how far below his right shoulder and in from it the grip goes through (of his arm), which way
 * it points as it lands and which way the grip is moving then, as he faces, and how fast (m/s).
 */
const BLOWS = [
  { name: 'cut from the right', down: 0.5, inward: 0.3, pointing: [0.6, 0.8, 1], moving: [1, -0.3, 0], speed: 7 },
  { name: 'cut from the left', down: 0.5, inward: -0.2, pointing: [0.2, 0.8, 1], moving: [-1, -0.3, 0], speed: 6 },
  { name: 'cut from above', down: 0.25, inward: 0.1, pointing: [0, 1.2, 1], moving: [0, -1, 0.2], speed: 7 },
  { name: 'thrust', down: 0.6, inward: 0.1, pointing: [0, 0.6, 1], moving: [0, 0, 1], speed: 4 },
] as const

/**
 * where the sword and the shield are taken hold of, in their frames (m): the sword's grip on its side, mid-way between
 * the pommel and the guard, the palm on the blade's flat; the shield by the upper of the two bars across its back
 */
const GRIP = {
  gladius: { at: new Vector3(0.021, 0, -0.01), from: new Vector3(1, 0, 0) },
  // (the thumb left out: it would go into the board)
  scutum: {
    at: new Vector3(0, 0.062, -0.025),
    from: new Vector3(0, 0, -1),
    using: ['palm', 'index', 'middle', 'ring', 'little'],
  },
} satisfies Record<string, Statement>

const UP = new Vector3(0, 1, 0)

/**
 * A gladiator led by the keys: he walks and runs with sword and shield, cuts and thrusts at the air ahead of him or at
 * the post he stands before, and raises his shield while the guard key is held, going slower behind it.
 */
export class Gladiator implements Game {
  readonly character: Character
  /** the sword in his right hand and the shield, its top its y and its face its z, in his left */
  private readonly sword: Held
  private readonly shield: Held
  /** the blow he gives, while he gives it, the next he is to give, and how many landed on the post */
  private blow?: string
  private next = 0
  hits = 0
  private guarding = false
  private errors = 0

  /** `rig` is his rigged body at rest, in the `scene` the `world` simulates */
  constructor(rig: Object3D, world: PhysicsWorld, scene: Object3D, things: Record<'gladius' | 'scutum', Object3D>) {
    // (the hands are read while the rig is at rest, before the body poses it)
    const hands = { right: new Hand(rig, 'right'), left: new Hand(rig, 'left') }
    scene.add(rig, things.gladius, things.scutum)
    this.character = new Character(rig, world)
    this.sword = holds(this.character.body, hands.right, grip(hands.right, things.gladius, GRIP.gladius))
    this.shield = holds(this.character.body, hands.left, grip(hands.left, things.scutum, GRIP.scutum))
  }

  /** a frame: what the keys ask of him, and he goes as he is led */
  update(delta: number, input: Input) {
    // what the body could not do it let go of: a blow is over (it would never end), and a guard still held is raised anew
    if (this.character.errors.length > this.errors) {
      this.blow = undefined
      this.guarding = false
    }
    this.errors = this.character.errors.length
    if (input.act && !this.blow) this.strike()
    this.guard(input.held.has(GUARD))
    const { move } = input
    const speed = this.guarding ? SPEED.guard : input.run ? SPEED.run : SPEED.walk
    this.character.update(delta, { x: move.x * speed, z: move.z * speed })
  }

  readout() {
    const doing = [this.guarding ? 'guarding' : '', this.blow ?? ''].filter(Boolean).join(', ')
    return `speed ${this.character.speed.toFixed(1)} m/s   hits ${this.hits}   ${doing}`
  }

  /** he raises the shield before him, or lets it hang at his side again */
  private guard(up: boolean) {
    if (up === this.guarding) return
    this.guarding = up
    const { body } = this.character
    const { arm } = body.size
    const { inward, down, ahead, face, top } = RAISED
    const place = new Vector3(-inward * arm, -down * arm, body.front('left', -down * arm, inward * arm) + ahead * arm)
    this.character.tried(() => {
      if (up) this.shield.to(place, { on: body, pointing: face, up: top })
      else body.hand.left.free()
    })
  }

  /**
   * the next blow: the blade lands on the post if he stands before it, a place in the scene, else in the air ahead of
   * him, a place on him that goes along with him as he goes
   */
  private strike() {
    const blow = BLOWS[this.next++ % BLOWS.length]
    const { body, capsule } = this.character
    const { arm, shoulder, trunk } = body.size
    const facing = body.facing
    const from = body.hips.value
      .clone()
      .addScaledVector(UP, trunk)
      .addScaledVector(new Vector3(-facing.z, 0, facing.x), shoulder)
    // the near side of the post at the height of the grip, and the way to it
    const post = new Vector3(POST.x, from.y - blow.down * arm, POST.z)
    const toPost = post.clone().sub(from).setY(0).normalize()
    post.addScaledVector(toPost, -POST.radius)
    const atPost = toPost.dot(facing) > FACING && post.distanceTo(from) < arm + BLADE
    const scene = turn(atPost ? toPost : facing)
    // (his own going carries the hand along too)
    const velocity = scene(blow.moving).setLength(blow.speed).add(capsule.velocity.clone().setY(0))
    this.blow = blow.name + (atPost ? ' at the post' : '')
    if (atPost) {
      const pointing = scene(blow.pointing).normalize()
      // (the grip short of the post along the blade, which lands on it higher up)
      const place = post.addScaledVector(pointing.clone().setY(0), -BLADE)
      body.play(this.swing(place, { velocity, pointing }, true))
      return
    }
    const place = new Vector3(blow.inward * arm, -blow.down * arm, AHEAD * arm)
    body.play(this.swing(place, { on: body, velocity, pointing: new Vector3(...blow.pointing).normalize() }, false))
  }

  /** the sword swings so through a place, and he takes a moment after: a hit if it was the post */
  private *swing(place: Vector3, how: Parameters<Held['by']>[2], atPost: boolean): Story {
    const { body } = this.character
    const landed = yield* this.sword.by(body.time + WIND, place, how)
    if (landed && atPost) this.hits++
    yield* body.until(body.time + RECOVER)
    this.blow = undefined
  }
}

/** a way given as he faces `ahead` (+x his left, +y up, +z ahead), in the scene */
const turn =
  (ahead: Vector3) =>
  ([x, y, z]: readonly number[]) =>
    new Vector3(ahead.z, 0, -ahead.x).multiplyScalar(x).addScaledVector(UP, y).addScaledVector(ahead, z)
