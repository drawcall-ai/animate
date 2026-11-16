import type { Vector3 } from 'three'
import { ahead, clamp, damped, GRAVITY, type Side, type Size, WALK } from './measure'

/**
 * how much of the angle between his legs the pelvis turns by in his stride, more the faster he runs than he walks; how
 * far at the most (rad); how far it lists under a hanging leg for every m/s² the ground pushes him up (rad); how many
 * times a beat it comes round
 */
const TURN = { stride: 0.1, most: 0.8, list: 0.09 / GRAVITY, rate: 0.9 }
/**
 * standing at his ease, which he takes a while to come to (in beats), his weight drifts from foot to foot: the hips over
 * a foot (of how far out a hip is), the pelvis listing with them (rad), by two slow swells that never come round
 * together (in beats); and always he breathes, a breath so long (in beats) lifting his chest so far (of his trunk), up
 * to twice as deep and fast out of breath, which he runs out of and gets back so fast (in beats)
 */
const IDLE = 2
/** how soon he leaves his ease (in beats) */
const LEAVES = 0.25
const DRIFT = { over: 0.15, list: 0.025, swells: [29, 47] }
const BREATH = { every: 14, lift: 0.02, runs: 20, recovers: 60 }

/** a foot as the pelvis sees it: where it is and whether it is down */
type Foot = { at: Vector3; down: boolean }

/**
 * The pelvis over the feet: turned, the hip of the leg ahead going ahead, and listing under a leg off the ground, as
 * heavy as the ground pushes him up, and into a turn; each coming round like a thing with weight. Standing at his ease
 * his weight drifts from foot to foot; and he breathes.
 */
export class Pelvis {
  turn = 0
  turning = 0
  list = 0
  listing = 0
  /** how far he stands at his ease, from 0 to 1, and how far his weight has drifted to his left, from -1 to 1 */
  idle = 0
  drifts = 0
  private time = 0
  private breath = 0
  private winded = 0

  constructor(private readonly size: Size) {}

  /** how far up his breath lifts his chest (m, of a trunk this long) */
  breathes(trunk: number) {
    return (BREATH.lift * trunk * (1 + this.winded) * (1 - Math.cos(this.breath))) / 2
  }

  /** how far over to his left his drifted weight has the hips, as he stands at his ease (m) */
  get over() {
    return DRIFT.over * this.size.hip * this.drifts
  }

  /**
   * a step of time: the hips where they are and how they move and are pushed up (m/s²), facing so, leaning into a turn
   * so far (rad), and each foot as it is; `free` when nothing is asked of him but to stand where he is
   */
  advance(dt: number, hips: Vector3, speed: number, up: number, facing: number, banks: number, feet: Record<Side, Foot>, free: boolean) {
    const { beat, pace } = this.size
    this.time += dt
    this.idle = free ? Math.min(1, this.idle + dt / (IDLE * beat)) : Math.max(0, this.idle - dt / (LEAVES * beat))
    const [slow, quick] = DRIFT.swells.map((beats) => Math.sin((2 * Math.PI * this.time) / (beats * beat)))
    this.drifts = (this.idle * (slow + quick)) / 2
    const runs = speed > WALK.most * pace ? 1 : 0
    this.winded += (runs - this.winded) * Math.min(1, dt / ((runs ? BREATH.runs : BREATH.recovers) * beat))
    this.breath += (2 * Math.PI * (1 + this.winded) * dt) / (BREATH.every * beat)
    // how far ahead of the hips each leg points, from straight down: the hip of the one ahead goes ahead
    const way = ahead(facing)
    const points = (foot: Foot) => Math.atan2(foot.at.clone().sub(hips).dot(way), hips.y - foot.at.y)
    const stride = TURN.stride * Math.max(1, speed / (WALK.most * pace))
    const want = clamp(stride * (points(feet.right) - points(feet.left)), -TURN.most, TURN.most)
    const pull = (2 * Math.PI * TURN.rate) / beat
    this.turning = damped(this.turning, want - this.turn, pull, dt)
    this.turn += this.turning * dt
    const hung = (Number(feet.left.down) - Number(feet.right.down)) * (GRAVITY + up)
    const lists = TURN.list * hung + DRIFT.list * this.drifts - banks
    this.listing = damped(this.listing, lists - this.list, pull, dt)
    this.list += this.listing * dt
  }
}
