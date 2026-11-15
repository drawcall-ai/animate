import type { Held, Story } from '@drawcall/animate'
import { flat, grip, Hand } from '@drawcall/hand'
import { type Object3D, Vector3 } from 'three'
import { Character } from '../character'
import type { Game, Input } from '../play'
import { field, GRIP } from './field'
import { Javelin } from './javelin'

/** how fast he walks and runs (m/s) */
const SPEED = { walk: 1.4, run: 6 }
/** how far from his hips, along the ground, a javelin is for Space to fetch it (of his arm) */
const NEAR = 4
/** how long his hand takes to the javelin to take it (s) */
const REACH = 0.8
/** the throw: how slow he runs into it at the least, how long his last strides take, how fast he arrives on the front foot (m/s, s, m/s) */
const RUNUP = { least: 3, strides: 0.5, arrive: 3 }
/** how fast it leaves the hand, and how steeply up from level (m/s, rad) */
const THROW = 20
const UP = (30 * Math.PI) / 180

/** places of his right hand, counted from his right shoulder as he faces: +x his left, +y up, +z ahead (of his arm) */
const OVER = { x: -0.15, y: 0.45, z: -0.15 }
const LOW = { x: -0.15, y: -0.65, z: 0.45 }
const RELEASE = { x: 0, y: 0.8, z: -0.3 }
/** how the javelin is turned over his shoulder and low, as he faces: pointing ahead and a little up, his palm up under it */
const SHOULDERED = { pointing: { x: 0, y: 0.15, z: 1 }, palm: { x: 0, y: 1, z: 0 } }
const LOWERED = { pointing: { x: 0, y: 0.25, z: 1 }, palm: { x: 0, y: 1, z: -0.25 } }

const scaled = (place: { x: number; y: number; z: number }, by: number) => new Vector3(place.x, place.y, place.z).multiplyScalar(by)
const along = (from: Vector3, to: Vector3) => new Vector3(to.x - from.x, 0, to.z - from.z)

/**
 * A javelin thrower led by the keys: he walks and runs, and carries a javelin over his shoulder at a run and low at
 * his side otherwise. Fetching one from the rack and throwing it are his actions: Space walks him up to the nearest and
 * takes it, or throws the one he carries the way he faces, braking onto the front foot out of how he runs. The javelin
 * is his from when his hand takes it until it leaves the hand, the world's after.
 */
export class Thrower implements Game {
  readonly character: Character
  readonly javelins: Javelin[]
  /** his right hand, read from the rig at rest */
  private readonly hand: Hand
  /** the javelin he carries or last threw, and it as he holds it while he does */
  private javelin?: Javelin
  private held?: Held
  /** how he carries it as last told, over his shoulder or not, and whether he is running */
  private over?: boolean
  private running = false

  constructor(rig: Object3D, scene: Object3D) {
    this.hand = new Hand(rig, 'right')
    this.character = new Character(rig)
    // the rack holds them where his hand carries one low, as he stands beside it
    const { stand, trunk, arm } = this.character.body.size
    const { drawn, rack } = field(stand + trunk + LOW.y * arm)
    scene.add(drawn, rig)
    this.javelins = rack.map((place) => new Javelin(scene, place))
  }

  update(delta: number, input: Input) {
    const { character } = this
    this.running = input.run && Math.hypot(input.move.x, input.move.z) > 0
    if (input.act && !character.acting) this.act()
    if (this.held && !character.acting && this.over !== this.running) this.carry()
    const speed = input.run ? SPEED.run : SPEED.walk
    character.update(delta, { x: input.move.x * speed, z: input.move.z * speed })
    for (const javelin of this.javelins) javelin.update()
  }

  readout() {
    const thrown = this.held ? undefined : this.javelin
    const doing = this.character.acting ? 'acting' : this.held ? 'carrying' : 'empty'
    const flight = thrown ? `   javelin ${thrown.state}` : ''
    const far = thrown?.distance === undefined ? '' : `   ${thrown.distance.toFixed(1)} m`
    return `${doing}${flight}${far}   ${this.character.speed.toFixed(1)} m/s`
  }

  /** the javelin he threw last, while he has not gone for another */
  focus() {
    return this.held ? undefined : this.javelin?.grip
  }

  /** Space: throw the javelin he carries, or fetch the nearest he can take */
  private act() {
    const { character } = this
    if (this.held) return character.act(this.throw(this.held))
    const hips = character.feet.position
    const far = (javelin: Javelin) => along(hips, javelin.grip).length()
    const near = this.javelins.filter((javelin) => javelin.free && far(javelin) < NEAR * character.body.size.arm)
    near.sort((a, b) => far(a) - far(b))
    if (near[0]) character.act(this.fetch(near[0]))
  }

  /** he walks up to where the javelin is by his right hand as he carries it low, facing the way it points, and takes it */
  private *fetch(javelin: Javelin): Story {
    const { body } = this.character
    const ahead = javelin.pointing.setY(0).normalize()
    const left = new Vector3(ahead.z, 0, -ahead.x)
    const { arm, shoulder } = body.size
    const spot = javelin.grip.addScaledVector(left, shoulder - LOW.x * arm).addScaledVector(ahead, -LOW.z * arm)
    body.face(ahead)
    yield* body.walk(spot)
    this.javelin = javelin
    javelin.take()
    const held = body.hold(javelin.mesh)
    body.face()
    // (a hand that never got there drops it)
    if (!(yield* body.hand.right.to(grip(this.hand, javelin.mesh, GRIP), { seconds: REACH }))) {
      held.free()
      return javelin.release(new Vector3())
    }
    this.held = held
    this.carry()
  }

  /** his hand carries the javelin over his shoulder at a run, low at his side otherwise */
  private carry() {
    const { body } = this.character
    const over = this.running
    this.over = over
    const place = scaled(over ? OVER : LOW, body.size.arm)
    this.held?.to(place, { on: body, ...(over ? SHOULDERED : LOWERED) })
  }

  /**
   * out of how he runs, he brakes onto his left foot a couple of strides ahead the way he faces, and as he comes over
   * it the javelin leaves his hand above and behind the shoulder: the run, the trunk and the arm make up its speed
   */
  private *throw(held: Held): Story {
    const { body, feet } = this.character
    const way = body.facing
    const speed = Math.max(this.character.speed, RUNUP.least)
    const at = feet.position.clone().addScaledVector(way, speed * RUNUP.strides)
    body.run({ speed, plant: 'left', at, arrive: RUNUP.arrive })
    const flying = way.clone().multiplyScalar(THROW * Math.cos(UP)).setY(THROW * Math.sin(UP))
    const release = body.when(at)
    body.hand.right.shape(flat, { by: release })
    const pointing = { x: 0, y: Math.sin(UP), z: Math.cos(UP) }
    yield* held.by(release, scaled(RELEASE, body.size.arm), { velocity: flying, on: body, pointing })
    held.free()
    this.javelin?.release(flying)
    this.held = this.over = undefined
    body.hand.right.shape()
    yield* body.stand()
  }
}
