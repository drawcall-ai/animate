import type { Held, Story } from '@drawcall/animate'
import { grip, Hand } from '@drawcall/hand'
import type { PhysicsWorld } from '@drawcall/physics'
import { type Object3D, Vector3 } from 'three'
import { Character } from '../character'
import type { Game, Input } from '../play'
import { field, GRIP } from './field'
import { Javelin } from './javelin'

/** how fast he walks and runs (m/s) */
const SPEED = { walk: 1.4, run: 6 }
/** how far from his hips, along the ground, a javelin is for Space to fetch it (of his arm) */
const NEAR = 4
/** how near the place he takes it from counts as there (m), and how he slows into it (m/s a metre) */
const THERE = 0.1
const EASE = 3
/** how long his hand takes to the javelin to take it (s) */
const REACH = 0.8
/** how slow he is to go to count as having stopped (m/s) */
const STILL = 0.05
/** how fast the arm throws, on top of how fast he goes, and how steeply up from level (m/s, rad) */
const THROW = 16
const UP = (32 * Math.PI) / 180

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
 * A javelin thrower led by the keys: he walks and runs, fetches a javelin with Space and carries it, over his
 * shoulder at a run and low at his side otherwise, and throws it with Space the way he faces, his run in the throw.
 */
export class Thrower implements Game {
  readonly character: Character
  readonly javelins: Javelin[]
  /** his right hand, read from the rig at rest */
  private readonly hand: Hand
  state: 'empty' | 'fetching' | 'picking' | 'carrying' | 'throwing' = 'empty'
  /** the javelin he fetches, carries or last threw, and it as he holds it */
  private javelin?: Javelin
  private held?: Held
  /** how he carries it as last told, over his shoulder or not, and whether he is running */
  private over?: boolean
  private running = false
  /** which way he keeps facing, if not the way he goes */
  private way?: { x: number; z: number }

  constructor(rig: Object3D, world: PhysicsWorld, scene: Object3D) {
    this.hand = new Hand(rig, 'right')
    this.character = new Character(rig, world)
    // the rack holds them where his hand carries one low, as he stands beside it
    const { stand, trunk, arm } = this.character.body.size
    const { drawn, rack } = field(stand + trunk + LOW.y * arm)
    scene.add(drawn, rig)
    this.javelins = rack.map((place) => new Javelin(scene, place))
  }

  update(delta: number, input: Input) {
    this.running = input.run && Math.hypot(input.move.x, input.move.z) > 0
    const speed = input.run ? SPEED.run : SPEED.walk
    let asked = { x: input.move.x * speed, z: input.move.z * speed }
    if (input.act) this.act()
    if (this.state === 'fetching' || this.state === 'picking') asked = this.fetch()
    if (this.state === 'carrying' && this.over !== this.running) this.carry()
    this.character.update(delta, asked, this.way)
    for (const javelin of this.javelins) javelin.update()
  }

  readout() {
    const thrown = this.javelin
    const flight = thrown && this.state === 'empty' ? `   javelin ${thrown.state}` : ''
    const far = thrown?.distance === undefined ? '' : `   ${thrown.distance.toFixed(1)} m`
    return `${this.state}${flight}${far}   ${this.character.speed.toFixed(1)} m/s`
  }

  /** the javelin he threw last, while he has not gone for another */
  focus() {
    return this.state === 'empty' ? this.javelin?.grip : undefined
  }

  /** Space: fetch the nearest javelin he can take, or throw the one he carries */
  private act() {
    if (this.state === 'carrying') {
      this.state = 'throwing'
      this.character.body.play(this.throw())
      return
    }
    if (this.state !== 'empty') return
    const hips = this.character.capsule.position
    const far = (javelin: Javelin) => along(hips, javelin.grip).length()
    const near = this.javelins.filter((javelin) => javelin.free && far(javelin) < NEAR * this.character.body.size.arm)
    near.sort((a, b) => far(a) - far(b))
    if (!near[0]) return
    this.javelin = near[0]
    this.state = 'fetching'
  }

  /** he walks up to where the javelin he fetches is by his hand as he carries it low, facing the way it points, and once there stops and takes it: how he is to go */
  private fetch() {
    const { javelin, character } = this
    if (!javelin) throw new Error('he fetches no javelin')
    const ahead = javelin.pointing.setY(0).normalize()
    this.way = { x: ahead.x, z: ahead.z }
    if (this.state === 'picking') return { x: 0, z: 0 }
    // it is to be by his right hand, as he carries it low
    const left = new Vector3(ahead.z, 0, -ahead.x)
    const { arm, shoulder } = character.body.size
    const spot = javelin.grip.addScaledVector(left, shoulder - LOW.x * arm).addScaledVector(ahead, -LOW.z * arm)
    const way = along(character.capsule.position, spot)
    if (way.length() > THERE) return way.setLength(Math.min(SPEED.walk, EASE * way.length()))
    // (a hand is planned on how he goes as it is sent: he stops first)
    if (character.speed > STILL) return { x: 0, z: 0 }
    this.state = 'picking'
    character.body.play(this.pick(javelin))
    return { x: 0, z: 0 }
  }

  /** his hand goes down to the javelin's grip and takes it, as he is to carry it */
  private *pick(javelin: Javelin): Story {
    const { body } = this.character
    javelin.take()
    this.held = body.hold(javelin.mesh)
    try {
      if (!(yield* body.hand.right.to(grip(this.hand, javelin.mesh, GRIP), { seconds: REACH }))) return
      this.state = 'carrying'
      this.carry()
    } finally {
      this.way = undefined
      if (this.state === 'picking') {
        this.state = 'empty'
        javelin.state = 'down'
      }
    }
  }

  /** his hand carries the javelin over his shoulder at a run, low at his side otherwise */
  private carry() {
    const { body } = this.character
    const over = this.running
    this.over = over
    const place = scaled(over ? OVER : LOW, body.size.arm)
    this.held?.to(place, { on: body, ...(over ? SHOULDERED : LOWERED) })
  }

  /** the javelin leaves his hand above and behind his shoulder the way he faces, his run in it, and flies */
  private *throw(): Story {
    const { body, capsule } = this.character
    const hand = body.hand.right
    const facing = body.facing
    this.way = { x: facing.x, z: facing.z }
    const velocity = facing
      .clone()
      .multiplyScalar(THROW * Math.cos(UP))
      .setY(THROW * Math.sin(UP))
      .add(capsule.velocity.clone().setY(0))
    try {
      const pointing = { x: 0, y: Math.sin(UP), z: Math.cos(UP) }
      if (this.held) yield* this.held.to(scaled(RELEASE, body.size.arm), { velocity, on: body, pointing })
    } finally {
      this.held?.free()
      this.javelin?.release(hand.velocity.clone())
      this.state = 'empty'
      this.way = this.over = undefined
      this.held = undefined
    }
  }
}
