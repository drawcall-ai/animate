import type { Side, Story } from '@drawcall/animate'
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
/** where the left foot comes down as he shoots: so far behind the ball, and his middle so far to its left (of his leg) */
const PLANT = { behind: 0.4, aside: 0.1 }
/** how fast he runs onto the ball to shoot at the least, how fast he arrives on the left foot, and how near it he steps rather than run (m/s, m/s, of his leg) */
const RUNUP = { least: 3.6, arrive: 2.5, step: 2 }
/** how fast the shooting foot meets the ball, and how far it sends it up from level at least (m/s, rad) */
const SHOT = { speed: 20, up: (10 * Math.PI) / 180 }
/** how long after Space he meets the ball at the most (s), and how long before he meets it he goes on with where he found it (in beats) */
const MEETS = 6
const SETS = 2
/** how far from where it was to be met the ball may be seen to go before the meeting is found anew (of his leg) */
const STRAYS = 0.1
/** how high in the goal he aims (of its height) */
const AIM = 0.4

const flat = (v: Vector3) => v.clone().setY(0)
/** his left, facing a way along the ground: looking along +z it is +x */
const leftOf = (way: Vector3) => new Vector3(way.z, 0, -way.x)

/**
 * A footballer on a pitch with a ball: he walks and runs as the keys ask, touches the ball on ahead of him with the
 * foot on its side as he runs onto it, and with it at his feet, Space has him shoot at the goal with his right foot. A
 * touch is his foot only, the player leading him on; a shot needs his legs, a run onto the left foot beside the ball,
 * so it is his action. The ball is always the world's: his feet strike it.
 */
export class Footballer implements Game {
  /** whether a foot is touching the ball on */
  private touching = false
  /** whether Space was pressed while a foot was busy with the ball */
  private wants = false

  /** he stands where his `rig` is, the ball lying a step ahead of him */
  static start(rig: Object3D, scene: Scene) {
    scene.add(rig)
    const character = new Character(rig)
    const ahead = 1.2 * character.body.size.leg
    return new Footballer(character, new Ball(scene, rig.localToWorld(new Vector3(0, 0, ahead))))
  }

  private constructor(
    readonly character: Character,
    readonly ball: Ball,
  ) {}

  update(delta: number, input: Input) {
    const { character } = this
    const asked = new Vector3(input.move.x, 0, input.move.z).multiplyScalar(input.run ? SPEED.run : SPEED.walk)
    // (Space as a foot touches the ball on is for when it has)
    this.wants ||= input.act
    if (!this.touching && !character.acting) {
      const touch = asked.length() > MOVING && this.onto(asked.clone().normalize())
      if (this.wants && this.atFeet()) character.tried(() => character.act(this.shoot()))
      else if (touch) character.tried(() => character.body.play(this.touch(asked, touch.at, touch.by)))
      this.wants = false
    }
    character.update(delta, asked)
  }

  readout() {
    const ball = flat(this.ball.velocity).length()
    const doing = this.character.acting ? 'shooting' : this.touching ? 'touching' : this.atFeet() ? 'Space: shoot' : ''
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

  /**
   * a foot meets the ball where it is `at`, by a moment or as soon as it can, moving so, its ankle behind the ball and above its middle as
   * the instep meets it, and pushes it the `way` it met it
   */
  private *strike(side: Side, way: Vector3, velocity: Vector3, at: Vector3, by?: number): Story {
    const foot = this.character.body.foot[side]
    const place = at.clone().addScaledVector(flat(way).normalize(), -1.5 * RADIUS).setY(2 * RADIUS)
    try {
      yield* (by === undefined ? foot.to(place, { velocity }) : foot.by(by, place, { velocity }))
    } finally {
      // the foot meets the ball where it is, if it is there: what the body calls a miss may still have met it
      if (foot.value.distanceTo(this.ball.place) < MET * RADIUS) this.ball.kick(way, foot.velocity)
    }
  }

  /** the foot on the ball's side meets it from behind, the way he is asked to go, a little faster, and it rolls on ahead */
  private *touch(asked: Vector3, at: Vector3, by: number): Story {
    const way = asked.clone().normalize()
    const side: Side = flat(at.clone().sub(this.character.body.hips.value)).dot(leftOf(way)) > 0 ? 'left' : 'right'
    this.touching = true
    try {
      yield* this.strike(side, way, way.clone().multiplyScalar(asked.length() + TOUCH.faster), at, by)
    } finally {
      this.touching = false
    }
  }

  /** he runs onto where the ball will be as he gets to it, braking onto his left foot beside it, and his right foot meets it toward the goal then */
  private *shoot(): Story {
    const { body } = this.character
    const { leg } = body.size
    const speed = this.character.speed
    // (where it will have rolled to by the moment his hips come over the left foot beside it: that moment is found by halving)
    const onto = (meets: number) => {
      const place = this.ball.rolled(meets - body.time)
      const aim = flat(new Vector3(GOAL.x, 0, GOAL.z).sub(place)).normalize()
      const at = flat(place.clone().addScaledVector(aim, -PLANT.behind * leg).addScaledVector(leftOf(aim), PLANT.aside * leg))
      // (near it, he steps onto the left foot rather than run)
      if (speed < RUNUP.least && flat(body.hips.value).distanceTo(at) < RUNUP.step * leg) body.walk(at, { plant: 'left' })
      else body.run({ speed: Math.max(speed, RUNUP.least), plant: 'left', at, arrive: RUNUP.arrive })
      return { place, aim, comes: body.when(at) }
    }
    const meet = () => {
      let [soon, late] = [body.time + (SETS / 2) * body.size.beat, body.time + MEETS]
      for (let k = 0; k < 12; k++) [soon, late] = onto((soon + late) / 2).comes > (soon + late) / 2 ? [(soon + late) / 2, late] : [soon, (soon + late) / 2]
      return { ...onto(late), meets: late }
    }
    // (no sooner than half the time the foot takes to swing to it; found anew if the ball is seen to roll elsewhere, until the foot is to set off for it)
    let { place, aim, meets } = meet()
    while (meets - body.time > SETS * body.size.beat) {
      yield
      if (this.ball.rolled(meets - body.time).distanceTo(place) > STRAYS * leg) ({ place, aim, meets } = meet())
    }
    const target = new Vector3(GOAL.x, AIM * GOAL.high, GOAL.z).sub(place).normalize()
    const lift = Math.max(SHOT.up, Math.asin(target.y))
    const way = aim.clone().multiplyScalar(Math.cos(lift)).setY(Math.sin(lift))
    yield* this.strike('right', way, way.clone().multiplyScalar(SHOT.speed), place, meets)
    yield* body.stand()
  }
}
