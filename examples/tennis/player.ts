import type { Story, Thing } from '@drawcall/animate'
import { grip, Hand } from '@drawcall/hand'
import { type Object3D, Vector3 } from 'three'
import { Character, inHand } from '../character'
import type { Game, Input } from '../play'
import { strings } from './ball'
import { HALF, NET } from './court'
import { type Ball, Machine } from './machine'
import { FOREHAND, RACKET, racket } from './racket'
import { type Stroke, stroke } from './stroke'

/** how fast he walks and runs (m/s) */
const SPEED = { walk: 1.6, run: 5 }
/** when the machine feeds its first ball, and how often after (s) */
const FEED = { first: 1.5, every: 4 }
/** where on the far side a return is aimed: so far beyond the net, on the middle (m) */
const AIM = new Vector3(0, 0, NET.z + 0.6 * HALF.long)
/**
 * a swing: how far ahead of him, toward the ball, the strings meet it (of his arm); how soon at the earliest, how
 * long a swing at the air takes, and how long he stays in it after (s)
 */
const SWING = { ahead: { forehand: 0.6, backhand: 1.2 } satisfies Record<Stroke, number>, soonest: 0.4, air: 0.9, after: 0.5 }
/** how far out past his shoulder a ball is fed to pass him, beyond the racket (of his arm) */
const ASIDE = 0.5
/** the racket ready before him between strokes, from his right shoulder: its head up ahead, the palm in (of his arm) */
const READY = { place: new Vector3(0.3, -0.6, 0.55), pointing: { x: 0, y: 0.6, z: 1 }, palm: { x: 1, y: 0, z: 0 } }

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
  /** the racket as bound to him, his right hand leading it */
  private readonly held: Thing
  /** the swing he is in: which stroke, and at which ball */
  private swing?: { stroke: Stroke; ball?: Ball }
  /** where the strings and the ball were a frame ago */
  private was?: { strings: Vector3; ball: Vector3 }
  private next = FEED.first
  private fed = 0
  private returns: Ball[] = []
  private over = 0
  private said = ''

  constructor(rig: Object3D, scene: Object3D) {
    scene.add(rig, this.racket)
    const hand = new Hand(rig, 'right')
    this.character = new Character(rig)
    this.held = inHand(this.character.body, hand, grip(hand, this.racket, FOREHAND))
    this.ready()
    this.machine = new Machine(scene)
  }

  update(delta: number, input: Input) {
    const { body } = this.character
    if (body.time >= this.next) this.feed()
    if (input.act && !this.character.acting) this.character.tried(() => this.act())
    const speed = input.run ? SPEED.run : SPEED.walk
    this.character.update(delta, { x: input.move.x * speed, z: input.move.z * speed })
    this.strike(delta)
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
    const aside = (stroke === 'forehand' ? -1 : 1) * (size.shoulder + ASIDE * size.arm + RACKET.strings)
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

  /** Space: a stroke at the ball fed last if it comes within reach, else at the air where such a ball would be */
  private act() {
    const { body, feet } = this.character
    const ball = this.machine.last
    const meeting = ball && !ball.struck ? this.meet(ball) : undefined
    if (meeting) return this.character.act(this.play(meeting.stroke, meeting.time, meeting.at, meeting.way, ball))
    const way = body.facing
    const kind: Stroke = ball && ball.place.clone().sub(feet.position).dot(right(way)) < 0 ? 'backhand' : 'forehand'
    const { size } = body
    const out = (kind === 'forehand' ? 1 : -1) * (size.shoulder + ASIDE * size.arm + RACKET.strings)
    const at = feet.position.clone().addScaledVector(right(way), out).addScaledVector(way, SWING.ahead[kind] * size.arm)
    this.character.act(this.play(kind, body.time + SWING.air, at.setY(0.5 * size.stand), way))
  }

  /** the stroke as his action, facing the way the ball comes from, and back to the ready after it */
  private *play(kind: Stroke, time: number, at: Vector3, way: Vector3, ball?: Ball): Story {
    const { body } = this.character
    this.swing = { stroke: kind, ball }
    body.face(way)
    yield* stroke(body, this.held, kind, time, at, AIM.clone().sub(at).setY(0).normalize())
    yield* body.until(time + SWING.after)
    body.hand.left.cancel()
    this.ready()
    body.face()
    this.swing = undefined
    yield* body.stand()
  }

  /** the racket before him, ready */
  private ready() {
    const { body } = this.character
    const { place, ...turned } = READY
    void this.held.to(place.clone().multiplyScalar(body.size.arm), { on: body, ...turned })
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
