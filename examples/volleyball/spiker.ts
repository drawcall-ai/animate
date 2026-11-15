import type { Story } from '@drawcall/animate'
import { flat } from '@drawcall/hand'
import type { PhysicsWorld } from '@drawcall/physics'
import { type Object3D, Vector3 } from 'three'
import { Character } from '../character'
import type { Game, Input } from '../play'
import { NET, RADIUS } from './ball'
import { Setter } from './setter'

/** how fast he walks and runs (m/s) */
const SPEED = { walk: 1.6, run: 5 }
/** how hard he brakes onto a place he is to be at (m/s²) */
const BRAKE = 5
/** how far a spike lifts his hips above standing (m), and how long he drops before he leaves the ground, as the body takes it (s) */
const RISE = 0.75
const DROP = 0.5
/** how far forward of straight up his arm is as the hand meets the ball in a spike (rad), and how fast the hand goes (m/s) */
const SWING = 0.35
const SPIKE = 12
/** how long the arm takes to swing through the ball (s) */
const STRIKE = 0.35
/** how far from the net a ball is spiked at most, and how far above its top the spike goes over (m) */
const NEAR = 1.6
const CLEAR = 0.6
/** how high a pass meets the ball (of how high his hips stand), how fast the forearms go through it (m/s), and how far down from level they point (rad) */
const PASS = { high: 0.85, speed: 1.5, down: Math.PI / 4 }
/** how far under the ball the platform is held before it swings up (of a forearm's length) */
const READY = 0.6
/** how long before a pass he is to be in place (s) */
const SETTLE = 0.35
/** how far past a wrist a hand or forearm meets the ball (of a forearm's length) */
const TOUCH = 0.6
/** the way to the net, which he faces as he plays the ball, and the way the forearms face in a pass: up and toward it */
const NETWARD = { x: 0, z: 1 }
const PLATFORM = new Vector3(0, 3, 1).normalize()

/** where he is to be on the ground, and by when, on his clock (m, s) */
type Goal = { x: number; z: number; at: number }

/**
 * The player: he walks and runs as the keys ask, and Space plays the ball the setter tossed, by where it will be: high
 * near the net he runs in, jumps and spikes it down over it at the top of the jump, otherwise he gets under it and
 * passes it up off both forearms.
 */
export class Spiker implements Game {
  readonly character: Character
  readonly setter: Setter
  private state: 'free' | 'spiking' | 'passing' = 'free'
  private said = ''
  private goal?: Goal

  constructor(rig: Object3D, world: PhysicsWorld, scene: Object3D) {
    scene.add(rig)
    this.character = new Character(rig, world)
    this.setter = new Setter(scene, world)
  }

  update(delta: number, input: Input) {
    const { character, setter } = this
    setter.update(delta, this.state === 'free')
    if (input.act && this.state === 'free' && setter.live) character.tried(() => this.play())
    const speed = input.run ? SPEED.run : SPEED.walk
    const asked = this.goal ? this.steer(this.goal) : { x: input.move.x * speed, z: input.move.z * speed }
    character.update(delta, asked, this.state === 'free' ? undefined : NETWARD)
  }

  readout() {
    return `${this.state}  ${this.said}`
  }

  focus() {
    return this.setter.place.clone()
  }

  /** a spike if the ball comes down high near the net and he can get under it in time, else a pass */
  private play() {
    const { body, capsule } = this.character
    const { size } = body
    const up = size.trunk + size.arm * Math.cos(SWING)
    const seconds = this.setter.falls(size.stand + RISE + up)
    const contact = this.setter.at(seconds)
    const hips = contact.clone().add(new Vector3(0, -up, -size.arm * Math.sin(SWING)))
    const far = Math.hypot(hips.x - capsule.position.x, hips.z - capsule.position.z)
    const spike = Math.abs(contact.z - NET.z) < NEAR && far < SPEED.run * seconds
    body.play(spike ? this.spike(hips, seconds) : this.pass())
  }

  private *spike(hips: Vector3, seconds: number): Story {
    const { body } = this.character
    const hand = body.hand.right
    this.state = 'spiking'
    this.goal = { x: hips.x, z: hips.z, at: body.time + seconds }
    hand.shape(flat)
    yield* body.until(this.goal.at - DROP - Math.sqrt((2 * RISE) / this.setter.gravity))
    const landing = body.jump(hips)
    const top = body.highest()
    this.goal.at = top
    const ball = this.setter.at(top - body.time)
    const way = new Vector3(ball.x, NET.y + CLEAR, NET.z).sub(ball).normalize()
    const behind = ball.clone().addScaledVector(way, -RADIUS)
    yield* body.until(top - STRIKE)
    yield* hand.by(top, behind, { velocity: way.clone().multiplyScalar(SPIKE), with: 'palm', palm: way })
    this.strike(hand.value, way, hand.velocity)
    hand.free()
    hand.shape()
    this.goal = undefined
    yield* landing
    this.state = 'free'
  }

  private *pass(): Story {
    const { body } = this.character
    const { size } = body
    this.state = 'passing'
    const seconds = this.setter.falls(PASS.high * size.stand)
    const at = body.time + seconds
    // the forearms meet the ball a little short of the wrists, pointing forward and down from the shoulders
    const along = new Vector3(0, -Math.sin(PASS.down), Math.cos(PASS.down))
    const wrists = this.setter
      .at(seconds)
      .addScaledVector(PLATFORM, -RADIUS)
      .addScaledVector(along, 0.4 * size.forearm)
    this.goal = { x: wrists.x, z: wrists.z - size.arm * Math.cos(PASS.down), at: at - SETTLE }
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
    this.strike(middle, PLATFORM, left.velocity.clone().add(right.velocity).multiplyScalar(0.5))
    left.free()
    right.free()
    this.goal = undefined
    this.state = 'free'
  }

  /** the ball is struck if it is at what strikes it (a wrist, or between them), to leave as that hits it */
  private strike(at: Vector3, normal: Vector3, velocity: Vector3) {
    const off = at.distanceTo(this.setter.place) - RADIUS - TOUCH * this.character.body.size.forearm
    if (off > 0) {
      this.said = `missed by ${off.toFixed(2)} m`
      return
    }
    this.setter.strike(normal, velocity)
    const out = this.setter.ball.getVelocity().linear.length()
    this.said = `${this.state === 'spiking' ? 'spiked' : 'passed'}: struck at ${velocity.length().toFixed(1)} m/s, off at ${out.toFixed(1)} m/s`
  }

  /** how he is to go to be at a goal by its moment, no faster than he runs or can stop there (m/s) */
  private steer(goal: Goal) {
    const { body, capsule } = this.character
    const [x, z] = [goal.x - capsule.position.x, goal.z - capsule.position.z]
    const far = Math.hypot(x, z)
    if (far < 0.02) return { x: 0, z: 0 }
    const speed = Math.min(SPEED.run, far / Math.max(goal.at - body.time, 0.1), Math.sqrt(2 * BRAKE * far))
    return { x: (x / far) * speed, z: (z / far) * speed }
  }
}
