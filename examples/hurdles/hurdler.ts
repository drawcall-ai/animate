import type { Story } from '@drawcall/animate'
import type { RigidBody } from '@drawcall/physics'
import { type Object3D, Vector3 } from 'three'
import { Character } from '../character'
import type { Game, Input } from '../play'
import { type Hurdle, WIDE } from './track'

/** how fast he walks and runs (m/s) */
const SPEED = { walk: 1.5, run: 6.5 }
/** how fast he leaves the ground in a jump where he is (m/s) */
const UP = 2.7
/** from how far off a hurdle ahead Space has him hurdle it, rather than jump where he is, and how near it is too near (m) */
const READY = { far: 8, near: 3 }
/** how far before a hurdle he takes off, and how far over its bar the hips are at the top (m) */
const OFF = 2
const HIPS = 0.5
/** where the lead foot is from the hips halfway up, the knee driven up, and at the top, reaching out ahead over the bar, the leg nearly straight (of his leg) */
const KNEE = { x: -0.1, y: -0.3, z: 0.5 }
const LEAD = { x: -0.1, y: -0.3, z: 0.85 }
/** where the trail foot is from its hip at the top: folded up, out to the side (of his leg) */
const TUCK = { x: 0.4, y: -0.1, z: -0.33 }
/** how hard a foot that clips a bar hits it (N s) */
const KICK = 8

/** a hurdle on the track: the body the world has it as, and whether he has cleared it or knocked it yet */
type Standing = Hurdle & { solid: RigidBody; done?: 'cleared' | 'knocked'; was?: number }

/**
 * The hurdler: he walks and runs as the keys ask, and Space jumps where he is. Running at a hurdle, Space has him
 * hurdle it, his action: out of his run he takes off from the left foot before it, the right leg reaching over the bar
 * and the left folded up at his side by the top, and the player leads him on once he lands. A foot that crosses under
 * a bar knocks that hurdle over.
 */
export class Hurdler implements Game {
  readonly character: Character
  private readonly hurdles: Standing[]
  private readonly feet = { left: new Vector3(), right: new Vector3() }

  constructor(rig: Object3D, hurdles: { hurdle: Hurdle; solid: RigidBody }[]) {
    this.character = new Character(rig)
    this.hurdles = hurdles.map(({ hurdle, solid }) => ({ ...hurdle, solid }))
  }

  update(delta: number, input: Input) {
    const { character } = this
    const { body } = character
    const speed = input.run ? SPEED.run : SPEED.walk
    if (input.act && !body.playing) this.act()
    for (const side of ['left', 'right'] as const) this.feet[side].copy(body.foot[side].value)
    character.update(delta, { x: input.move.x * speed, z: input.move.z * speed })
    this.check()
  }

  /** Space: a hurdle ahead he runs at is to be hurdled, else he jumps where he is */
  private act() {
    const { character } = this
    const ahead = this.ahead()
    if (ahead && character.speed > SPEED.run / 2) character.act(this.hurdle(ahead))
    else character.jump(UP)
  }

  /** the first hurdle standing ahead of him down the lane, far enough off to take off for and near enough to hurdle */
  private ahead() {
    const { position, velocity } = this.character.feet
    if (velocity.z < Math.abs(velocity.x) || Math.abs(position.x) > WIDE / 2) return undefined
    return this.hurdles.find((hurdle) => !hurdle.done && hurdle.z - position.z > READY.near && hurdle.z - position.z < READY.far)
  }

  /** out of his run he takes off from his left foot before the hurdle, and is highest over the bar, the right foot over it first */
  private *hurdle({ z, height }: Hurdle): Story {
    const { body, feet, speed } = this.character
    const { x } = feet.position
    const { leg } = body.size
    body.run({ speed, at: { x, z: z - OFF }, plant: 'left' })
    // (highest as the trail foot, folded behind the hips, comes over the bar)
    const landing = body.jump({ x, y: height + HIPS, z: z - TUCK.z * leg })
    const velocity = { x: 0, y: 0, z: speed }
    void body.foot.right.by(((body.gait.jumping?.leaves ?? body.time) + body.highest()) / 2, { x: KNEE.x * leg, y: KNEE.y * leg, z: KNEE.z * leg }, { on: body })
    body.foot.right.by(body.highest(), { x: LEAD.x * leg, y: LEAD.y * leg, z: LEAD.z * leg }, { on: body, velocity })
    body.foot.left.by(body.highest(), { x: TUCK.x * leg, y: TUCK.y * leg, z: TUCK.z * leg }, { on: body, velocity })
    yield* landing
  }

  /** a foot that crossed under a standing bar knocks it over; the hips past one still standing have cleared it */
  private check() {
    const { body, feet } = this.character
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
      const far = feet.position.z - hurdle.z
      if (hurdle.done || Math.abs(far) < leg) continue
      // (which side of it he was on, last he was a leg's length from it)
      const was = Math.sign(far)
      if (hurdle.was !== undefined && hurdle.was !== was && Math.abs(feet.position.x) < WIDE / 2) hurdle.done = 'cleared'
      hurdle.was = was
    }
  }

  readout() {
    const count = (done: Standing['done']) => this.hurdles.filter((hurdle) => hurdle.done === done).length
    const { speed, acting, body } = this.character
    const doing = acting
      ? 'hurdling'
      : body.highest() > body.time
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
    const { position } = this.character.feet
    const next = this.hurdles.find((hurdle) => !hurdle.done && hurdle.z > position.z)
    return next && new Vector3(0, next.height, next.z)
  }
}
