import type { Story, Thing } from '@drawcall/animate'
import { grip, Hand, type Statement } from '@drawcall/hand'
import type { PhysicsWorld } from '@drawcall/physics'
import { Group, type Object3D, Vector3 } from 'three'
import { Character, inHand } from '../character'
import type { Game, Input } from '../play'
import { POST } from './game'

/** how fast he walks and runs, and goes behind his raised shield (m/s) */
const SPEED = { walk: 1.4, run: 4.2, guard: 0.9 }
/** the key held to raise the shield */
const GUARD = 'KeyE'
/** how far along the blade from the middle of the grip the part is that lands (m) */
const BLADE = 0.35
/** how fast the blade goes through what it meets (m/s) */
const BLOW = 7
/** how long from the press until the blow lands, which gives it the whole body's swing (s) */
const WIND = 0.7
/** how far he steps into a blow with his front foot, and how far ahead of the middle of his shoulders his hand has the sword as a blow lands (of his leg, of his arm) */
const STEP = 0.4
const AHEAD = 0.75
/** how near ahead of him the post must be for a blow at it (cos of the angle off his facing) */
const FACING = 0.7
/**
 * the raised shield: where its middle is, from his left shoulder, in toward his middle and down, ahead of his front
 * (of his arm); its top up and leaning ahead over his forearm, and its face, which his palm faces, ahead and a little in
 */
const RAISED = { inward: 0.3, down: 0.05, ahead: 0.15, top: { x: 0, y: 1, z: 0.4 }, face: { x: -0.4, y: 0, z: 1 } }
/** the lowered shield, at his left side: its middle out from his left shoulder and down (of his arm), its top up, its face out */
const LOWERED = { place: new Vector3(0.35, -0.8, 0.15), top: { x: 0, y: 1, z: 0 }, face: { x: 1, y: 0, z: 0.3 } }

/**
 * The blows he gives in turn, by the way the blade goes through what it meets, as he faces (+x his left, +y up, +z
 * ahead): cuts across and down, the edge leading, and a thrust, the point leading.
 */
const BLOWS = [
  { name: 'cut from the right', moving: new Vector3(1, -0.4, 0) },
  { name: 'cut from the left', moving: new Vector3(-1, -0.4, 0) },
  { name: 'cut from above', moving: new Vector3(0, -1, 0.2) },
  { name: 'thrust', moving: new Vector3(0, 0, 1) },
]

/**
 * where the sword and the shield are taken hold of (m): the sword's grip on its side, mid-way between the pommel and
 * the guard, the palm on the blade's flat; the shield by the upper of the two bars across its back, in a frame whose
 * z is its top and whose -y its face
 */
const GRIP = {
  gladius: { at: new Vector3(0.021, 0, -0.01), from: new Vector3(1, 0, 0) },
  // (the thumb left out: it would go into the board)
  scutum: { at: new Vector3(0, 0.025, 0.062), from: new Vector3(0, 1, 0), using: ['palm', 'index', 'middle', 'ring', 'little'] },
} satisfies Record<string, Statement>

const UP = new Vector3(0, 1, 0)

/**
 * A gladiator led by the keys: he walks and runs with sword and shield, cuts and thrusts at the air ahead of him or at
 * the post he stands before, stepping into each blow, and raises his shield while the guard key is held, going slower
 * behind it. The sword is bound to his right hand and the shield to his left.
 */
export class Gladiator implements Game {
  readonly character: Character
  readonly buttons = [{ code: GUARD, label: 'shield' }]
  private readonly sword: Thing
  private readonly shield: Thing
  /** the blow he gives, while he gives it, the next he is to give, and how many landed on the post */
  private blow?: string
  private next = 0
  hits = 0
  private guarding?: boolean

  /** `rig` is his rigged body at rest, in the `scene` the `world` simulates */
  constructor(rig: Object3D, world: PhysicsWorld, scene: Object3D, things: Record<'gladius' | 'scutum', Object3D>) {
    // (the shield's top along z, for `pointing` to say where its top goes)
    const scutum = new Group().add(things.scutum)
    things.scutum.rotation.x = Math.PI / 2
    scene.add(rig, things.gladius, scutum)
    // (the hands are read while the rig is at rest, before the body poses it)
    const hands = { right: new Hand(rig, 'right'), left: new Hand(rig, 'left') }
    this.character = new Character(rig, world)
    const { body } = this.character
    this.sword = inHand(body, hands.right, grip(hands.right, things.gladius, GRIP.gladius))
    this.shield = inHand(body, hands.left, grip(hands.left, scutum, GRIP.scutum))
  }

  /** a frame: what the keys ask of him, and he goes as he is led */
  update(delta: number, input: Input) {
    if (input.act && !this.character.acting) this.strike()
    this.guard(input.held.has(GUARD))
    const { move } = input
    const speed = this.guarding ? SPEED.guard : input.run ? SPEED.run : SPEED.walk
    this.character.update(delta, { x: move.x * speed, z: move.z * speed })
  }

  readout() {
    const doing = [this.guarding ? 'guarding' : '', this.blow ?? ''].filter(Boolean).join(', ')
    return `speed ${this.character.speed.toFixed(1)} m/s   hits ${this.hits}   ${doing}`
  }

  /** he raises the shield before him, or carries it low at his side again: its face out */
  private guard(up: boolean) {
    if (up === this.guarding) return
    this.guarding = up
    const { body } = this.character
    const { arm } = body.size
    const { inward, down, ahead, top, face } = RAISED
    const raised = new Vector3(-inward * arm, -down * arm, body.front('left', -down * arm, inward * arm) + ahead * arm)
    if (up) void this.shield.to(raised, { on: body, pointing: top, palm: face })
    else void this.shield.to(LOWERED.place.clone().multiplyScalar(arm), { on: body, pointing: LOWERED.top, palm: LOWERED.face })
  }

  /** the next blow, as his action: at the post if he stands before it, else at the air ahead of him */
  private strike() {
    const blow = BLOWS[this.next++ % BLOWS.length]
    const { body } = this.character
    const { arm, trunk } = body.size
    const facing = body.facing
    const from = body.hips.value.addScaledVector(UP, trunk)
    // the near side of the post at his shoulders' height, and the way to it from between them
    const post = new Vector3(POST.x, from.y, POST.z)
    const toPost = post.clone().sub(from).setY(0).normalize()
    post.addScaledVector(toPost, -POST.radius)
    const atPost = toPost.dot(facing) > FACING && post.distanceTo(from) < arm + BLADE + STEP * body.size.leg
    const way = atPost ? toPost : facing
    const at = atPost ? post : from.addScaledVector(way, AHEAD * arm + BLADE)
    this.blow = blow.name + (atPost ? ' at the post' : '')
    this.character.act(this.swing(blow.moving, way, at, atPost))
  }

  /**
   * he steps into the blow toward `at`, and the blade goes through it the way it is `moving` (as he faces `way`),
   * pointing ahead and up: a cut with the edge leading, a thrust with the point
   */
  private *swing(moving: Vector3, way: Vector3, at: Vector3, atPost: boolean): Story {
    const { body } = this.character
    const left = new Vector3(way.z, 0, -way.x)
    const going = left.clone().multiplyScalar(moving.x).addScaledVector(UP, moving.y).addScaledVector(way, moving.z).normalize()
    // (as far up as ahead: a fist turns a blade no nearer along the forearm)
    const pointing = way.clone().add(UP).normalize()
    const palm = new Vector3().crossVectors(pointing, going)
    body.face(way)
    body.foot.left.to(body.ground('left', body.hips.value.addScaledVector(way, STEP * body.size.leg)))
    const place = at.clone().addScaledVector(pointing, -BLADE)
    const landed = yield* this.sword.by(body.time + WIND, place, {
      velocity: going.multiplyScalar(BLOW),
      pointing,
      palm: palm.lengthSq() > 0.01 ? palm : undefined,
    })
    if (landed && atPost) this.hits++
    this.blow = undefined
    body.face()
    yield* body.stand()
  }
}
