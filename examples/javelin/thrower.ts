import type { Story, Thing } from '@drawcall/animate'
import { grip, Hand } from '@drawcall/hand'
import { type Object3D, Vector3 } from 'three'
import { Character } from '../character'
import type { Game, Input } from '../play'
import { field, GRIP } from './field'
import { Javelin } from './javelin'
import { javelinThrow } from './throw'

/** how fast he walks and runs (m/s) */
const SPEED = { walk: 1.4, run: 6 }
/** how far from his hips, along the ground, a javelin is for Space to fetch it (of his arm) */
const NEAR = 4
/** the throw: how slow he runs into it at the least (m/s), and how long before he plants his front foot it is asked (s) */
const RUNUP = { least: 3, ahead: 1 }

/**
 * how he carries it, from his right shoulder as he faces (+x his left, +y up, +z ahead; of his arm): over the
 * shoulder at a run, its point ahead and the palm up under it, and low at his side otherwise, the palm in toward him
 */
const CARRY = {
  over: { place: { x: 0, y: 0.35, z: -0.1 }, pointing: { x: 0, y: 0.1, z: 1 }, palm: { x: 0, y: 1, z: 0 } },
  low: { place: { x: -0.1, y: -0.5, z: 0.5 }, pointing: { x: 0, y: 0.25, z: 1 }, palm: { x: 1, y: 1, z: 0 } },
}

const along = (from: Vector3, to: Vector3) => new Vector3(to.x - from.x, 0, to.z - from.z)

/**
 * A javelin thrower led by the keys: he walks and runs, and carries a javelin over his shoulder at a run and low at
 * his side otherwise. Fetching one from the rack and throwing it are his actions: Space walks him up to the nearest and
 * takes it, or throws the one he carries the way he faces, braking onto the front foot out of how he runs. The javelin
 * is bound to his right hand from when it takes it until it lets go, and the world's after.
 */
export class Thrower implements Game {
  readonly character: Character
  readonly javelins: Javelin[]
  /** his right hand, read from the rig at rest */
  private readonly hand: Hand
  /** the javelin he carries or last threw, and it as bound to him while he carries it */
  private javelin?: Javelin
  private held?: Thing
  /** how he carries it as last told, over his shoulder or not, and whether he is running */
  private over?: boolean
  private running = false

  constructor(rig: Object3D, scene: Object3D) {
    this.hand = new Hand(rig, 'right')
    this.character = new Character(rig)
    // the rack holds them where his hand carries one low, as he stands beside it
    const { stand, trunk, arm } = this.character.body.size
    const { drawn, rack } = field(stand + trunk + CARRY.low.place.y * arm)
    scene.add(drawn, rig)
    this.javelins = rack.map((place) => new Javelin(scene, place))
  }

  update(delta: number, input: Input) {
    const { character } = this
    this.running = input.run && Math.hypot(input.move.x, input.move.z) > 0
    if (input.act && !character.acting) this.act()
    if (this.held && !character.acting && this.over !== this.running) this.carry(this.held)
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
    const { x, z } = CARRY.low.place
    body.face(ahead)
    yield* body.walk(javelin.grip.addScaledVector(left, shoulder - x * arm).addScaledVector(ahead, -z * arm))
    body.face()
    const seat = grip(this.hand, javelin.mesh, GRIP)
    const held = body.bind(javelin.mesh)
    // (a hand that never got there leaves it lying)
    if (!(yield* held.on(body.hand.right, seat))) return
    this.javelin = javelin
    javelin.take()
    this.held = held
    this.carry(this.held)
  }

  /** his hand carries the javelin over his shoulder at a run, low at his side otherwise */
  private carry(held: Thing) {
    const { body } = this.character
    this.over = this.running
    const { place, ...turned } = this.over ? CARRY.over : CARRY.low
    const at = new Vector3(place.x, place.y, place.z).multiplyScalar(body.size.arm)
    void held.to(at, { on: body, ...turned })
  }

  /** out of how he runs, he brakes onto his left foot a little ahead the way he faces, and throws as he comes over it */
  private *throw(held: Thing): Story {
    const { body, feet } = this.character
    const speed = Math.max(this.character.speed, RUNUP.least)
    const at = feet.position.clone().addScaledVector(body.facing, speed * RUNUP.ahead)
    this.held = this.over = undefined
    yield* javelinThrow(body, held, speed, at, (velocity) => this.javelin?.release(velocity))
  }
}
