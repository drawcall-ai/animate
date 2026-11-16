import type { Mover } from '@drawcall/plan'
import { type Matrix4, type Object3D, Quaternion, Vector3 } from 'three'
import { UP } from '@drawcall/limbs'

const scale = new Vector3()
const [spin, none, moved] = [new Quaternion(), new Quaternion(), new Vector3()]

/**
 * A thing in his scene as the body sees it, in the frame of the body: looked at once an update, and told on as it was
 * seen to move between the last two looks.
 */
export class Watched implements Mover {
  /** where it was and how it was turned when last looked at and the time before: in the scene, and against his hips as he faced */
  private readonly looks = [look(), look()]

  constructor(
    readonly object: Object3D,
    private readonly frame: Matrix4,
    /** where his hips are now and which way he faces: a thing carried with him is told on from them */
    private readonly him: () => { at: Vector3; facing: number },
  ) {}

  /** looks at it at a moment, once */
  look(time: number) {
    if (time === this.looks[1].time) return
    const first = this.looks[1].time === -Infinity
    this.looks.reverse()
    const [was, now] = this.looks
    this.object.updateWorldMatrix(true, false)
    this.object.matrixWorld.clone().premultiply(this.frame).decompose(now.at, now.turn, scale)
    const { at, facing } = this.him()
    now.on.copy(now.at).sub(at).applyAxisAngle(UP, -facing)
    now.onTurn.setFromAxisAngle(UP, -facing).multiply(now.turn)
    now.time = time
    if (first) Object.assign(was, { time, at: now.at.clone(), turn: now.turn.clone(), on: now.on.clone(), onTurn: now.onTurn.clone() })
  }

  state(t: number, place: Vector3, velocity: Vector3, turn?: Quaternion) {
    // (not looked at yet, it is where it is now)
    if (this.looks[1].time === -Infinity) this.look(t)
    const [was, seen] = this.looks
    const gone = seen.time - was.time
    const share = gone > 0 ? (t - seen.time) / gone : 0
    velocity.copy(seen.at).sub(was.at)
    // (told on as it went in the scene, or as it went with him if it is carried with him: whichever it was stiller in)
    const along = moved.copy(seen.on).sub(was.on)
    const carried = along.length() < velocity.length()
    const [at, turned, before] = carried ? [seen.on, seen.onTurn, was.onTurn] : [seen.at, seen.turn, was.turn]
    place.copy(at).addScaledVector(carried ? along : velocity, share)
    spin.copy(before).invert().premultiply(turned)
    const turning = spin.slerp(none, 1 - share).normalize().multiply(turned)
    velocity.divideScalar(gone > 0 ? gone : Infinity)
    if (carried) {
      const { at: hips, facing } = this.him()
      place.applyAxisAngle(UP, facing).add(hips)
      turning.premultiply(none.setFromAxisAngle(UP, facing))
      none.identity()
    }
    turn?.copy(turning)
  }
}

const look = () => ({ at: new Vector3(), turn: new Quaternion(), on: new Vector3(), onTurn: new Quaternion(), time: -Infinity })

/**
 * A place on him: counted from where a limb starts on his hips, he standing at rest, as the hips go and he faces. The
 * hips' plan is all it reads, never the hands', so what the hands plan on him never reads itself.
 */
export class OnHim implements Mover {
  /** where the limb starts from the middle of the hips, he standing at rest */
  readonly rest = new Vector3()
  private readonly at = new Vector3()

  constructor(
    /** where the hips will be so many seconds on, how fast they will go, and which way he will face then: the hips' plan */
    private readonly hips: { now: number; hips(seconds: number, at: Vector3, velocity: Vector3): Vector3; facing(seconds: number): number },
  ) {}

  state(t: number, place: Vector3, velocity: Vector3, turn?: Quaternion) {
    const seconds = Math.max(0, t - this.hips.now)
    const facing = this.hips.facing(seconds)
    this.hips.hips(seconds, place, velocity)
    place.add(this.at.copy(this.rest).applyAxisAngle(UP, facing))
    turn?.setFromAxisAngle(UP, facing)
  }
}
