import type { Side } from '@drawcall/animate'
import type { PhysicsWorld, RigidBody } from '@drawcall/physics'
import { type Object3D, Vector3 } from 'three'
import { Character } from '../character'
import type { Game, Input } from '../play'
import { type Hurdle, WIDE } from './track'

/** how fast he walks and runs (m/s) */
const SPEED = { walk: 1.5, run: 6.5 }
/** how high his hips rise in a jump (of how high they stand) */
const RISE = 0.4
/** how long the capsule pushes off before it leaves the ground (s): `Capsule`'s own, which it does not tell */
const PUSH = 0.35
/** from how far off a hurdle ahead Space has him hurdle it, rather than jump where he is (m) */
const READY = 8
/** how far over the bar the lead ankle goes (m) */
const CLEAR = 0.25
/** how straight the lead leg is as it reaches over the bar (of its length) */
const STRETCH = 0.95
/** how far before the bar his hips are highest, as a hurdler takes off further before it than he lands after (of his leg) */
const BEFORE = 0.7
/** how hard a foot that clips a bar hits it (N s) */
const KICK = 8
const GRAVITY = 9.81

/** a hurdle on the track: the body the world has it as, and whether he has cleared it or knocked it yet */
type Standing = Hurdle & { solid: RigidBody; done?: 'cleared' | 'knocked'; was?: number }

const other = (side: Side): Side => (side === 'left' ? 'right' : 'left')

/**
 * The hurdler: he walks and runs as the keys ask; Space jumps, and running at a hurdle he hurdles it, taking off as
 * far before it as has him highest a little before the bar, the lead leg stretched out over the bar and the trail foot
 * folded up out at his side by the top. A foot that crosses under a bar knocks that hurdle over.
 */
export class Hurdler implements Game {
  readonly character: Character
  private readonly hurdles: Standing[]
  /** the hurdle he is to take off for, once he is near enough, and then the one he is over */
  private hurdling?: Standing
  /** whether he is in the air, or pushing off for it */
  private jumping = false
  private pushing = false
  /** the foot that last stood alone: the one he takes off from */
  private stood: Side = 'left'
  /** how high his hips are at the top of the jump he makes (m) */
  private top = 0
  private readonly feet = { left: new Vector3(), right: new Vector3() }

  constructor(rig: Object3D, world: PhysicsWorld, hurdles: { hurdle: Hurdle; solid: RigidBody }[]) {
    this.character = new Character(rig, world)
    this.hurdles = hurdles.map(({ hurdle, solid }) => ({ ...hurdle, solid }))
  }

  /** how fast his hips leave the ground in a jump (m/s) */
  private get up() {
    return Math.sqrt(2 * GRAVITY * RISE * this.character.body.size.stand)
  }

  update(delta: number, input: Input) {
    const { character } = this
    const { body, capsule } = character
    const speed = input.run ? SPEED.run : SPEED.walk
    const was = capsule.grounded
    if (input.act && was && !this.jumping) this.act()
    this.takeOff()
    for (const side of ['left', 'right'] as const) this.feet[side].copy(body.foot[side].value)
    character.update(delta, { x: input.move.x * speed, z: input.move.z * speed })
    if (was && !capsule.grounded) {
      this.pushing = false
      this.leave()
    }
    if (!was && capsule.grounded) this.jumping = false
    if (capsule.grounded && !this.jumping) this.hurdling = undefined
    const { left, right } = body.foot
    if (left.anchor && !right.anchor) this.stood = 'left'
    if (right.anchor && !left.anchor) this.stood = 'right'
    this.check()
  }

  /** Space: a hurdle ahead he runs at is to be hurdled, else he jumps where he is */
  private act() {
    const ahead = this.ahead()
    if (ahead === undefined || this.character.speed < SPEED.run / 2) {
      this.jumping = this.spring()
      return
    }
    this.hurdling = ahead
    this.jumping = true
  }

  /** the first hurdle standing ahead of him the way he goes, near enough to hurdle */
  private ahead() {
    const { position, velocity } = this.character.capsule
    if (Math.abs(velocity.z) < Math.abs(velocity.x)) return undefined
    const way = Math.sign(velocity.z)
    const near = this.hurdles
      .filter((hurdle) => !hurdle.done && Math.abs(position.x) < WIDE / 2)
      .map((hurdle) => ({ hurdle, far: (hurdle.z - position.z) * way }))
      .filter(({ far }) => far > 0 && far < READY)
      .sort((a, b) => a.far - b.far)
    return near[0]?.hurdle
  }

  /** while he is to hurdle and still runs, he pushes off as far before the hurdle as has him highest a little before its bar */
  private takeOff() {
    const { hurdling, character } = this
    const { capsule, speed, body } = character
    if (!hurdling || !capsule.grounded || this.pushing) return
    if (speed < SPEED.run / 2) {
      this.hurdling = undefined
      this.jumping = false
      return
    }
    const far = Math.abs(hurdling.z - capsule.position.z)
    if (far <= speed * (PUSH + this.up / GRAVITY) + BEFORE * body.size.leg) this.spring()
  }

  /** the capsule pushes off, and the body is told the jump it makes: where its hips are at the top */
  private spring() {
    const { body, capsule } = this.character
    if (Number.isNaN(this.character.jump(this.up))) return false
    this.pushing = true
    this.top = capsule.floor + body.size.stand + this.up ** 2 / (2 * GRAVITY)
    return true
  }

  /** he has left the ground: over a hurdle, the lead foot goes over its bar and the trail foot folds up out at his side by the top */
  private leave() {
    const { hurdling, character } = this
    if (!hurdling) return
    const { body, capsule } = character
    const { size } = body
    const velocity = { x: capsule.velocity.x, y: 0, z: capsule.velocity.z }
    const trail = this.stood
    const lead = other(trail)
    // (on him, from the hip: his left is +x, ahead +z)
    const out = (side: Side) => (side === 'left' ? 1 : -1)
    const down = hurdling.height + CLEAR - this.top
    const reach = { x: 0, y: down, z: STRETCH * Math.sqrt(Math.max(0, size.leg ** 2 - down ** 2)) }
    const tuck = { x: out(trail) * size.thigh, y: -0.2 * size.shin, z: -0.6 * size.shin }
    character.tried(() => {
      // the lead leg is stretched out as its foot comes over the bar, the trail leg folded up by the top
      const over = body.time + Math.max(0, (Math.abs(hurdling.z - capsule.position.z) - reach.z) / Math.abs(velocity.z))
      body.foot[lead].by(over, reach, { on: body })
      body.foot[trail].by(body.highest(), tuck, { on: body, velocity })
    })
  }

  /** a foot that crossed under a standing bar knocks it over; the hips past one still standing have cleared it */
  private check() {
    const { body, capsule } = this.character
    const { leg, ankle } = body.size
    for (const hurdle of this.hurdles) {
      if (hurdle.done) continue
      for (const side of ['left', 'right'] as const) {
        const [from, to] = [this.feet[side], body.foot[side].value]
        const crossed = (from.z - hurdle.z) * (to.z - hurdle.z) <= 0 && from.z !== to.z
        if (!crossed || to.y - ankle > hurdle.height || Math.abs(to.x) > WIDE / 2) continue
        const push = body.foot[side].velocity.clone().setY(0).setLength(KICK)
        hurdle.solid.applyImpulse(push, new Vector3(to.x, hurdle.height, hurdle.z))
        hurdle.done = 'knocked'
      }
      const far = capsule.position.z - hurdle.z
      if (hurdle.done || Math.abs(far) < leg) continue
      // (which side of it he was on, last he was a leg's length from it)
      const was = Math.sign(far)
      if (hurdle.was !== undefined && hurdle.was !== was && Math.abs(capsule.position.x) < WIDE / 2)
        hurdle.done = 'cleared'
      hurdle.was = was
    }
  }

  readout() {
    const count = (done: Standing['done']) => this.hurdles.filter((hurdle) => hurdle.done === done).length
    const { speed, capsule } = this.character
    const doing = this.hurdling
      ? 'hurdling'
      : this.jumping || !capsule.grounded
        ? 'jumping'
        : speed > (SPEED.walk + SPEED.run) / 2
          ? 'running'
          : speed > 0.1
            ? 'walking'
            : 'standing'
    return `cleared ${count('cleared')}   knocked ${count('knocked')}   of ${this.hurdles.length}\n${doing}`
  }

  /** the next hurdle still standing ahead of him, along the lane */
  focus() {
    const { position } = this.character.capsule
    const next = this.hurdles.find((hurdle) => !hurdle.done && hurdle.z > position.z)
    return next && new Vector3(0, next.height, next.z)
  }
}
