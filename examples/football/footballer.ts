import type { Side, Story } from '@drawcall/animate'
import type { PhysicsWorld } from '@drawcall/physics'
import { type Object3D, type Scene, Vector3 } from 'three'
import { Character } from '../character'
import type { Game, Input } from '../play'
import { Ball } from './ball'
import { GOAL } from './field'
import { RADIUS } from './pitch'

/** how fast he walks and runs (m/s) */
const SPEED = { walk: 1.5, run: 5 }
/** how slow he may go and still run onto the ball and touch it on (m/s) */
const MOVING = 0.6
/**
 * how far ahead of his hips the ball is as a foot touches it on, and how far to his side at most (of his leg); how soon
 * and how late that may be after the foot is sent (s); and how much faster than he is asked to go the foot meets it (m/s)
 */
const TOUCH = { ahead: 0.55, aside: 1, soonest: 0.45, latest: 0.8, faster: 1.5 }
/** how far from the ball's middle his ankle is, at most, as his foot meets it (of the ball's radius) */
const MET = 2.5
/** how far from his hips the ball is at his feet, to shoot (of his leg) */
const FEET = 2.4
/** how far behind the ball his hips stand as he shoots, and how near they come to there before his foot sets off (of his leg) */
const BEHIND = { far: 0.35, near: 0.15 }
/** how fast the shooting foot meets the ball, how far it sends it up from level at least, and how long ahead it is sent (m/s, rad, s) */
const SHOT = { speed: 20, up: (10 * Math.PI) / 180, ahead: 0.6 }
/** how long he takes to come to where he shoots from (s) */
const CLOSE = 0.35
/** how high in the goal he aims (of its height) */
const AIM = 0.4

const flat = (v: Vector3) => v.clone().setY(0)
/** his left, facing a way along the ground: looking along +z it is +x */
const leftOf = (way: Vector3) => new Vector3(way.z, 0, -way.x)

/**
 * A footballer on a pitch with a ball: he walks and runs as the keys ask, touches the ball on ahead of him with the
 * foot on its side as he runs onto it, and with it at his feet, Space has him stand beside it and shoot at the goal
 * with his right foot.
 */
export class Footballer implements Game {
  /** what a foot is doing with the ball, while it does */
  private doing?: 'touching' | 'shooting'
  /** whether Space was pressed while a foot was busy with the ball */
  private wants = false
  /** where his hips are to stand as he shoots, and which way he faces */
  private shot?: { spot: Vector3; aim: Vector3 }

  /** he stands where his `rig` is, the ball lying a step ahead of him */
  static start(rig: Object3D, world: PhysicsWorld, scene: Scene) {
    scene.add(rig)
    const character = new Character(rig, world)
    const ahead = 1.2 * character.body.size.leg
    return new Footballer(character, new Ball(scene, rig.localToWorld(new Vector3(0, 0, ahead))))
  }

  private constructor(
    readonly character: Character,
    readonly ball: Ball,
  ) {}

  update(delta: number, input: Input) {
    const { character, shot } = this
    const asked = shot ? this.closing(shot.spot) : new Vector3(input.move.x, 0, input.move.z)
    if (!shot) asked.multiplyScalar(input.run ? SPEED.run : SPEED.walk)
    // (Space as a foot touches the ball on is for when it has)
    this.wants ||= input.act
    const shoots = !this.doing && this.wants && this.atFeet()
    if (!this.doing) this.wants = false
    if (shoots) this.play('shooting', this.shoot())
    else if (!this.doing && asked.length() > MOVING) {
      const way = asked.clone().normalize()
      const touch = this.onto(way)
      if (touch) this.play('touching', this.touch(asked, touch.at, touch.by))
    }
    character.update(delta, asked, this.shot?.aim)
  }

  readout() {
    const ball = flat(this.ball.velocity).length()
    const doing = this.doing ?? (this.atFeet() ? 'Space: shoot' : '')
    return `${doing}\nhe ${this.character.speed.toFixed(1)} m/s  ball ${ball.toFixed(1)} m/s`
  }

  /** the ball, from his hips along the ground */
  private get toBall() {
    return flat(this.ball.place.sub(this.character.body.hips.value))
  }

  private atFeet() {
    return this.toBall.length() < FEET * this.character.body.size.leg
  }

  /**
   * when he comes onto the ball, going the `way` he is asked, so a foot touches it on, and where it has rolled to by
   * then: if that is soon, and it is not too far to his side
   */
  private onto(way: Vector3) {
    const { body } = this.character
    const { leg } = body.size
    // (as the body has his hips going, which it plans the foot on)
    const speed = body.hips.velocity.dot(way)
    if (speed < MOVING) return
    const hips = flat(body.hips.value)
    /** how far ahead of where his hips are then the ball is, past how far it is to be as the foot meets it */
    const gap = (seconds: number) => this.ball.rolled(seconds).sub(hips).dot(way) - speed * seconds - TOUCH.ahead * leg
    let [soon, late] = [TOUCH.soonest, TOUCH.latest]
    if (gap(late) > 0 || this.ball.rolled(soon).sub(hips).dot(way) < 0) return
    // (as soon as it can, if he is on it sooner)
    if (gap(soon) < 0) late = soon
    for (let k = 0; k < 8; k++) [soon, late] = gap((soon + late) / 2) > 0 ? [(soon + late) / 2, late] : [soon, (soon + late) / 2]
    const at = this.ball.rolled(late)
    if (Math.abs(flat(at.clone().sub(hips)).dot(leftOf(way))) > TOUCH.aside * leg) return
    return { by: body.time + late, at }
  }

  /** how he goes to stand where he shoots from: there in a short while, no faster than he runs */
  private closing(spot: Vector3) {
    const { position } = this.character.capsule
    return flat(spot.clone().sub(position)).divideScalar(CLOSE).clampLength(0, SPEED.run)
  }

  /** has a foot do something with the ball, played beside his going: what it is doing until the story is over */
  private play(doing: 'touching' | 'shooting', story: Story) {
    this.doing = doing
    this.character.tried(() => this.character.body.play(this.done(story)))
  }

  private *done(story: Story): Story {
    try {
      yield* story
    } finally {
      this.doing = this.shot = undefined
    }
  }

  /**
   * a foot meets the ball where it is `at` by a moment, moving so, its ankle behind the ball and above its middle as
   * the instep meets it, and pushes it the `way` it met it
   */
  private *strike(side: Side, way: Vector3, velocity: Vector3, at: Vector3, by: number): Story {
    const foot = this.character.body.foot[side]
    const place = at.clone().addScaledVector(flat(way).normalize(), -1.5 * RADIUS).setY(2 * RADIUS)
    try {
      yield* foot.by(by, place, { velocity })
    } finally {
      // the foot meets the ball where it is, if it is there: what the body calls a miss may still have met it
      if (foot.value.distanceTo(this.ball.place) < MET * RADIUS) this.ball.kick(way, foot.velocity)
    }
  }

  /** the foot on the ball's side meets it from behind, the way he is asked to go, a little faster, and it rolls on ahead */
  private *touch(asked: Vector3, at: Vector3, by: number): Story {
    const way = asked.clone().normalize()
    const side: Side = flat(at.clone().sub(this.character.body.hips.value)).dot(leftOf(way)) > 0 ? 'left' : 'right'
    yield* this.strike(side, way, way.clone().multiplyScalar(asked.length() + TOUCH.faster), at, by)
  }

  /** he comes to stand behind where the ball comes to rest, it in the line of his right foot, and his right foot meets it toward the goal */
  private *shoot(): Story {
    const { body } = this.character
    const { leg, hip } = body.size
    // (where it comes to rest, if it rolls)
    const place = this.ball.rolled(Infinity)
    const aim = flat(new Vector3(GOAL.x, 0, GOAL.z).sub(place)).normalize()
    const spot = flat(place.clone().addScaledVector(aim, -BEHIND.far * leg).addScaledVector(leftOf(aim), hip))
    this.shot = { spot, aim }
    while (flat(body.hips.value).distanceTo(spot) > BEHIND.near * leg) yield
    const at = this.ball.rolled(SHOT.ahead)
    const target = new Vector3(GOAL.x, AIM * GOAL.high, GOAL.z).sub(at).normalize()
    const lift = Math.max(SHOT.up, Math.asin(target.y))
    const way = aim.clone().multiplyScalar(Math.cos(lift)).setY(Math.sin(lift))
    yield* this.strike('right', way, way.clone().multiplyScalar(SHOT.speed), at, body.time + SHOT.ahead)
  }
}
