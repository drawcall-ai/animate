import type { Carrier } from '@drawcall/locomotion'
import type { Mover } from '@drawcall/plan'
import { type Matrix4, type Object3D, Quaternion, Vector3 } from 'three'
import { type Side, UP } from '@drawcall/limbs'

const scale = new Vector3()
/** how soon a place on him is told from where it is now rather than looked ahead at (in his beats) */
const SOON = 0.8

/**
 * A thing in his scene as the body sees it, in the frame of the body: looked at once an update, and told on as it was
 * seen to move between the last two looks.
 */
export class Watched implements Mover {
  private readonly was = { at: new Vector3(), turn: new Quaternion(), time: -Infinity }
  private readonly seen = { at: new Vector3(), turn: new Quaternion(), time: -Infinity }

  constructor(
    readonly object: Object3D,
    private readonly frame: Matrix4,
  ) {}

  /** looks at it at a moment, once */
  look(time: number) {
    const { was, seen } = this
    if (time === seen.time) return
    const first = seen.time === -Infinity
    if (!first) this.keep(seen, was)
    this.object.updateWorldMatrix(true, false)
    this.object.matrixWorld.clone().premultiply(this.frame).decompose(seen.at, seen.turn, scale)
    seen.time = time
    if (first) this.keep(seen, was)
  }

  private keep(from: typeof this.seen, to: typeof this.seen) {
    to.at.copy(from.at)
    to.turn.copy(from.turn)
    to.time = from.time
  }

  state(t: number, place: Vector3, velocity: Vector3, turn?: Quaternion) {
    const { was, seen } = this
    // (not looked at yet, it is where it is now)
    if (seen.time === -Infinity) this.look(t)
    const gone = seen.time - was.time
    velocity.copy(seen.at).sub(was.at).divideScalar(gone > 0 ? gone : Infinity)
    place.copy(seen.at).addScaledVector(velocity, t - seen.time)
    turn?.copy(seen.turn)
  }
}

/**
 * A place on him: counted from where a limb starts, the shoulder or the hip, as he will face, so going with him. While
 * it is `flat` it is told only from where he is now and how fast he goes, for what the hands ask of the trunk not to
 * be looked ahead for twice over.
 */
export class OnHim implements Mover {
  flat = false
  /** where the limb starts from the middle of the hips, he standing at rest: while `flat`, a place on him is told from that, not from how he is bent */
  readonly rest = new Vector3()
  private readonly at = new Vector3()
  private readonly turned = new Quaternion()

  constructor(
    private readonly carrier: Carrier,
    private readonly kind: 'hand' | 'foot',
    private readonly side: Side,
    private readonly now: () => { at: Vector3; hips: Vector3; velocity: Vector3; facing: number; ground: number },
    /** his beat (s), and how high his hips stand (m) */
    private readonly size: { beat: number; stand: number },
  ) {}

  /**
   * where the limb starts `seconds` from now: soon, from where it is now on as the hips go; later, as he is looked
   * ahead at, as he will step and lean
   */
  private root(seconds: number, to: Vector3) {
    const { carrier, side } = this
    if (this.flat) {
      const { hips, velocity, facing, ground } = this.now()
      return to.copy(this.rest).applyAxisAngle(UP, facing).add(hips).setY(ground + this.rest.y + this.size.stand).addScaledVector(velocity, seconds)
    }
    if (seconds < SOON * this.size.beat) {
      const { at, velocity } = this.now()
      return to.copy(at).addScaledVector(velocity, seconds)
    }
    return this.kind === 'foot' ? carrier.hip(side, seconds, to, this.turned) : carrier.shoulder(side, seconds, to, this.turned)
  }

  state(t: number, place: Vector3, velocity: Vector3, turn?: Quaternion) {
    const seconds = Math.max(0, t - this.carrier.now)
    this.root(seconds, place)
    // (it moves as the hips move: how the trunk leans is not told a moment at a time)
    velocity.copy(this.now().velocity)
    const facing = this.flat || seconds < SOON * this.size.beat ? this.now().facing : this.carrier.facing(seconds)
    turn?.setFromAxisAngle(UP, facing)
  }
}
