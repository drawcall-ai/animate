import type { Story } from '@drawcall/animate'
import { flat } from '@drawcall/hand'
import type { PhysicsWorld } from '@drawcall/physics'
import { type Object3D, Vector3 } from 'three'
import { Character } from '../character'
import type { Game, Input } from '../play'
import { NET, RADIUS } from './ball'
import { Setter } from './setter'

/** how fast he walks and runs, and how fast he runs in to spike (m/s) */
const SPEED = { walk: 1.6, run: 5, approach: 3.5 }
/** how far a spike lifts his hips above standing (m), and how far short of where they are at its top he takes off */
const RISE = 0.75
const TAKEOFF = 0.3
/** how far forward of straight up his arm is as the hand meets the ball in a spike (rad), and how fast the hand goes (m/s) */
const SWING = 0.35
const SPIKE = 12
/** how far from the net a ball is spiked, and how far above its top the spike goes over (m) */
const NEAR = 0.6
const CLEAR = 0.6
/** how long the set is in the air before his hand meets it, and at the least (s) */
const SET = { seconds: 1.3, least: 0.6 }
/** how high a pass meets the ball (of how high his hips stand), how fast the forearms go through it (m/s), and how far down from level they point (rad) */
const PASS = { high: 0.85, speed: 1.5, down: Math.PI / 4 }
/** how far under the ball the platform is held before it swings up (of a forearm's length) */
const READY = 0.6
/** how far past a wrist a hand or forearm meets the ball (of a forearm's length) */
const TOUCH = 0.6
/** the way to the net, which he always faces, and the way the forearms face in a pass: up and toward it */
const NETWARD = { x: 0, z: 1 }
const PLATFORM = new Vector3(0, 3, 1).normalize()

/**
 * The player: he walks and runs as the keys ask, facing the net. Space with no ball in the air has him run in to the
 * net, the setter setting him the ball, and spike it down over it at the top of his jump; with a ball the setter
 * tossed in the air, he passes it up off both forearms. A spike needs his legs, so it is his action and the player
 * leads him again once he has landed; a pass is his hands only, the player getting him under the ball. The ball is
 * always the world's: a hand or the forearms strike it.
 */
export class Spiker implements Game {
  readonly character: Character
  readonly setter: Setter
  private said = ''

  constructor(rig: Object3D, world: PhysicsWorld, scene: Object3D) {
    scene.add(rig)
    this.character = new Character(rig)
    this.setter = new Setter(scene, world)
  }

  update(delta: number, input: Input) {
    const { character, setter } = this
    const { playing } = character.body
    setter.update(delta, !playing)
    if (input.act && !playing) character.tried(() => (setter.live ? character.body.play(this.pass()) : character.act(this.spike())))
    const speed = input.run ? SPEED.run : SPEED.walk
    character.update(delta, { x: input.move.x * speed, z: input.move.z * speed }, NETWARD)
  }

  readout() {
    const { acting, body } = this.character
    const doing = acting ? 'spiking' : body.playing ? 'passing' : this.setter.live ? 'Space: pass' : 'Space: spike'
    return `${doing}  ${this.said}`
  }

  focus() {
    return this.setter.place.clone()
  }

  /**
   * he turns to a spot at the net ahead of him, runs in, takes off short of it, and at the top of the jump swings
   * the right hand through the ball the setter set to be there then, down over the net
   */
  private *spike(): Story {
    const { body } = this.character
    const { stand, trunk, arm } = body.size
    const hand = body.hand.right
    hand.shape(flat)
    // where his hand meets the ball, an arm stretched up and a little forward, and where his hips are then
    const up = trunk + arm * Math.cos(SWING)
    const ball = new Vector3(body.hips.value.x, stand + RISE + up, NET.z - NEAR)
    const hips = ball.clone().add(new Vector3(0, -up, -arm * Math.sin(SWING)))
    const toward = hips.clone().sub(body.hips.value).setY(0)
    const takeoff = hips.clone().addScaledVector(toward.clone().normalize(), -TAKEOFF)
    // (a jump stated straight after a run goes the way he faced as it was stated: he faces the way he runs in first)
    yield* body.face(toward)
    body.face()
    body.run({ speed: SPEED.approach, at: takeoff })
    const landing = body.jump(hips)
    const top = body.highest()
    yield* body.until(top - SET.seconds)
    this.setter.set(ball, Math.max(SET.least, top - body.time))
    const way = new Vector3(ball.x, NET.y + CLEAR, NET.z).sub(ball).normalize()
    const behind = ball.clone().addScaledVector(way, -RADIUS)
    yield* hand.by(top, behind, { velocity: way.clone().multiplyScalar(SPIKE), with: 'palm', palm: way })
    this.strike(hand.value, way, hand.velocity, 'spiked')
    hand.cancel()
    hand.shape()
    yield* landing
  }

  /** facing the net, he swings the forearms up through the ball where it comes down */
  private *pass(): Story {
    const { body } = this.character
    const { size } = body
    const seconds = this.setter.falls(PASS.high * size.stand)
    const at = body.time + seconds
    // the forearms meet the ball a little short of the wrists, pointing forward and down from the shoulders
    const along = new Vector3(0, -Math.sin(PASS.down), Math.cos(PASS.down))
    const wrists = this.setter
      .at(seconds)
      .addScaledVector(PLATFORM, -RADIUS)
      .addScaledVector(along, 0.4 * size.forearm)
    const apart = new Vector3(0.2 * size.shoulder, 0, 0)
    const velocity = PLATFORM.clone().multiplyScalar(PASS.speed)
    const { left, right } = body.hand
    // the platform held under where the ball comes, and swung up through it
    const ready = wrists.clone().addScaledVector(PLATFORM, -READY * size.forearm)
    // (clasped, the palms facing each other across the way to the net)
    const palms = {
      left: { palm: { x: -1, y: 0, z: 0 }, pointing: along },
      right: { palm: { x: 1, y: 0, z: 0 }, pointing: along },
    }
    left.to(ready.clone().add(apart), palms.left)
    right.to(ready.clone().sub(apart), palms.right)
    left.by(at, wrists.clone().add(apart), { velocity, ...palms.left })
    yield* right.by(at, wrists.clone().sub(apart), { velocity, ...palms.right })
    const middle = left.value.clone().add(right.value).multiplyScalar(0.5)
    this.strike(middle, PLATFORM, left.velocity.clone().add(right.velocity).multiplyScalar(0.5), 'passed')
    left.cancel()
    right.cancel()
  }

  /** the ball is struck if it is at what strikes it (a wrist, or between them), to leave as that hits it */
  private strike(at: Vector3, normal: Vector3, velocity: Vector3, how: string) {
    const off = at.distanceTo(this.setter.place) - RADIUS - TOUCH * this.character.body.size.forearm
    if (off > 0) {
      this.said = `missed by ${off.toFixed(2)} m`
      return
    }
    this.setter.strike(normal, velocity)
    const out = this.setter.ball.getVelocity().linear.length()
    this.said = `${how}: struck at ${velocity.length().toFixed(1)} m/s, off at ${out.toFixed(1)} m/s`
  }
}
