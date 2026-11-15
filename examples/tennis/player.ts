import type { Held } from '@drawcall/animate'
import { grip, Hand } from '@drawcall/hand'
import { type Object3D, Vector3 } from 'three'
import { Character, holds } from '../character'
import type { Game, Input } from '../play'
import { strings } from './ball'
import { HALF, NET } from './court'
import { type Ball, Machine } from './machine'
import { FOREHAND, RACKET, racket } from './racket'

type Stroke = 'forehand' | 'backhand'

/** how fast he walks and runs (m/s) */
const SPEED = { walk: 1.6, run: 5 }
/** when the machine feeds its first ball, and how often after (s) */
const FEED = { first: 1.5, every: 4 }
/** where on the far side a return is aimed: so far beyond the net, on the middle (m) */
const AIM = new Vector3(0, 0, NET.z + 0.6 * HALF.long)
/**
 * a swing: how fast the racket's butt goes the way the ball is to go, and up, as the strings meet it (m/s); how far
 * ahead of him, toward the ball, they meet it (of his arm); how soon at the earliest, how long a swing at the air
 * takes, and how long he stays turned after (s)
 */
const SWING = {
  speed: 15,
  up: 1.5,
  ahead: { forehand: 0.6, backhand: 1.6 } satisfies Record<Stroke, number>,
  soonest: 0.4,
  air: 0.9,
  after: 0.6,
}
/** how far ahead of square to the way the ball is to go the racket points as it meets it (of its length) */
const LEAD: Record<Stroke, number> = { forehand: 0, backhand: 0.4 }
/** how far up the strings face as they meet the ball, for it to rise over the net (of how far they face ahead) */
const OPEN = 0.08
/** how far out past his shoulder a ball is fed to pass him, beyond the racket (of his arm) */
const ASIDE: Record<Stroke, number> = { forehand: 0.6, backhand: 0.4 }
/** the left hand through a stroke, from its shoulder: out ahead for a forehand, back for a backhand (of his arm) */
const LEFT: Record<Stroke, Vector3> = { forehand: new Vector3(0.65, -0.35, 0.5), backhand: new Vector3(0.6, -0.5, 0.1) }

/** his right along the ground, facing a way */
const right = (way: Vector3) => new Vector3(-way.z, 0, way.x)

/**
 * A tennis player led by the keys, a racket in his right hand, and a ball machine on the far side feeding him a ball
 * every few seconds, to his forehand and his backhand by turns. Space swings at the ball fed last, a forehand or a
 * backhand as it is to pass him, the strings meeting it where it will be; with none in reach, at the air.
 */
export class Player implements Game {
  readonly character: Character
  readonly machine: Machine
  private readonly racket = racket()
  private readonly held: Held
  /** the swing he is in: which stroke, at which ball, the way he faces through it, and when it is over */
  private swing?: { stroke: Stroke; ball?: Ball; way: Vector3; over: number }
  /** where the strings and the ball were a frame ago */
  private was?: { strings: Vector3; ball: Vector3 }
  private next = FEED.first
  private fed = 0
  private returns: Ball[] = []
  private over = 0
  private said = ''

  constructor(rig: Object3D, scene: Object3D) {
    this.character = new Character(rig)
    const hand = new Hand(rig, 'right')
    this.held = holds(this.character.body, hand, grip(hand, this.racket, FOREHAND))
    this.machine = new Machine(scene)
    scene.add(rig, this.racket)
  }

  update(delta: number, input: Input) {
    const { body } = this.character
    if (body.time >= this.next) this.feed()
    if (input.act && !this.swing) this.character.tried(() => this.act())
    const speed = input.run ? SPEED.run : SPEED.walk
    this.character.update(delta, { x: input.move.x * speed, z: input.move.z * speed }, this.swing?.way)
    this.strike(delta)
    if (this.swing && body.time > this.swing.over) {
      body.hand.left.free()
      this.swing = undefined
    }
    for (const ball of this.returns) {
      if (ball.place.z <= NET.z) continue
      this.over++
      this.said = 'over the net'
    }
    this.returns = this.returns.filter((ball) => ball.place.z <= NET.z && ball.velocity.z > 0)
  }

  readout() {
    const doing = this.swing ? (this.swing.ball ? this.swing.stroke : `${this.swing.stroke} at the air`) : 'ready'
    return `${doing}   fed ${this.fed}   over the net ${this.over}   ${this.said}`
  }

  /** the machine feeds a ball to pass him on his right, then on his left, and so on */
  private feed() {
    const { position } = this.character.feet
    const { size } = this.character.body
    const stroke = this.fed % 2 ? 'backhand' : 'forehand'
    const aside = (stroke === 'forehand' ? -1 : 1) * (size.shoulder + ASIDE[stroke] * size.arm + RACKET.strings)
    const x = Math.min(HALF.wide, Math.max(-HALF.wide, position.x + aside))
    const z = Math.min(NET.z - 2, Math.max(NET.z - HALF.long - 2, position.z))
    this.machine.feed({ x, z })
    this.fed++
    this.next += FEED.every
  }

  /** where and when he meets the ball, facing it, if it comes within his reach soon enough but not too soon */
  private meet(ball: Ball) {
    const { body, feet } = this.character
    const { size } = body
    const coming = ball.velocity.clone().setY(0)
    const speed = coming.length()
    if (speed < 1) return undefined
    const way = coming.clone().divideScalar(-speed)
    const him = (seconds: number) =>
      feet.position.clone().setY(0).addScaledVector(feet.velocity.clone().setY(0), seconds)
    const stroke = (): Stroke => (ball.place.clone().sub(him(0)).dot(right(way)) > 0 ? 'forehand' : 'backhand')
    const ahead = SWING.ahead[stroke()] * size.arm
    let seconds = 0
    for (let pass = 0; pass < 2; pass++) {
      seconds = him(seconds).addScaledVector(way, ahead).sub(ball.place).dot(coming) / speed ** 2
    }
    if (seconds < SWING.soonest) return undefined
    const at = ball.at(seconds).place
    const out = Math.abs(at.clone().sub(him(seconds)).dot(right(way)))
    const reach = out > size.shoulder && out < size.shoulder + size.arm + RACKET.strings
    if (!reach || at.y < 0.25 * size.stand || at.y > 1.6 * size.stand) return undefined
    return { time: body.time + seconds, at, way, stroke: stroke() }
  }

  /** Space: a swing at the ball fed last, if it comes within reach, else at the air */
  private act() {
    const { body } = this.character
    const { hand, size } = body
    const ball = this.machine.last
    const meeting = ball && !ball.struck ? this.meet(ball) : undefined
    if (!meeting) {
      const stroke =
        ball && ball.place.clone().sub(this.character.feet.position).dot(right(body.facing)) < 0
          ? 'backhand'
          : 'forehand'
      const out = stroke === 'forehand' ? -1 : 1
      // (on him, from the right shoulder: +x his left, +z ahead)
      const place = new Vector3(out * 0.5 + (out > 0 ? 2 * size.shoulder : 0), -0.4, 0.5).multiplyScalar(size.arm)
      const velocity = body.facing.multiplyScalar(SWING.speed).setY(SWING.up)
      this.held.by(body.time + SWING.air, place, {
        on: body,
        velocity,
        pointing: { x: out, y: 0, z: 0.3 },
        palm: { x: 0, y: 0, z: -out },
      })
      hand.left.to(LEFT[stroke].clone().multiplyScalar(size.arm), { on: body })
      this.swing = { stroke, way: body.facing, over: body.time + SWING.air + SWING.after }
      return
    }
    const { time, at, way, stroke } = meeting
    const toward = AIM.clone().sub(at).setY(0).normalize()
    const out = stroke === 'forehand' ? 1 : -1
    body.face(way)
    const pointing = right(toward).multiplyScalar(out).addScaledVector(toward, LEAD[stroke]).normalize()
    this.held.by(time, at.clone().addScaledVector(pointing, -RACKET.strings), {
      velocity: toward.clone().multiplyScalar(SWING.speed).setY(SWING.up),
      pointing,
      palm: stroke === 'forehand' ? toward.clone().setY(OPEN).normalize() : undefined,
    })
    hand.left.to(LEFT[stroke].clone().multiplyScalar(size.arm), { on: body })
    this.swing = { stroke, ball, way, over: time + SWING.after }
  }

  /** strings that sweep through the ball this frame send it off as they meet it, their face giving it back so much of how fast they close on it */
  private strike(delta: number) {
    const ball = this.swing?.ball
    this.racket.updateWorldMatrix(true, false)
    const now = strings(this.racket)
    const was = this.was
    this.was = ball && { strings: now, ball: ball.place.clone().addScaledVector(ball.velocity, delta) }
    if (!ball || !was || !this.was || ball.struck || !(delta > 0)) return
    const before = was.ball.clone().sub(was.strings)
    const sweep = this.was.ball.clone().sub(now).sub(before)
    const k = Math.min(1, Math.max(0, -before.dot(sweep) / Math.max(sweep.lengthSq(), 1e-9)))
    if (before.addScaledVector(sweep, k).length() > RACKET.long) return
    const moving = now.clone().sub(was.strings).divideScalar(delta)
    const face = new Vector3(0, 1, 0).transformDirection(this.racket.matrixWorld)
    const closing = ball.velocity.clone().sub(moving).dot(face)
    const velocity = ball.velocity.clone().addScaledVector(face, -(1 + RACKET.spring) * closing)
    ball.hit(velocity)
    this.returns.push(ball)
    this.said = `struck: it left at ${velocity.length().toFixed(1)} m/s`
  }
}
