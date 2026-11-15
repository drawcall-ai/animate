import { Matrix4, type Object3D, Quaternion, Vector3 } from 'three'
import { DOWN } from './fingers'

const matrix = new Matrix4()
const scale = new Vector3()
const at = new Vector3()
const twist = new Quaternion()

export function above(bone: Object3D) {
  if (!bone.parent) throw new Error(`the rig's ${bone.name} hangs from nothing: a body is given what holds its bones`)
  return bone.parent
}

/**
 * A bone the body turns, counted from the pose the body counts from: the trunk upright as the rig has it at rest, and
 * the parts of the limbs hanging straight down, each brought there from where the rig has it the shortest way. So
 * the rig may rest with its arms out or half down.
 */
export class Bone {
  /** where its joint is and how it is turned from that pose, in the frame of the body */
  readonly place = new Vector3()
  readonly turned = new Quaternion()
  /** where its joint is at rest, and in that pose from the joint `on` which it hangs */
  readonly rest = new Vector3()
  readonly at = new Vector3()
  /** in that pose: how the part is turned from where the rig has it at rest, how the bone it hangs from in the rig is turned, and its own */
  private readonly straight = new Quaternion()
  private readonly rides = new Quaternion()
  readonly hangs = new Quaternion()
  /** where the rig has the bone at rest against the bone it hangs from */
  private readonly local: Vector3
  /** how large the bone is in the frame of the body */
  readonly large: number

  /**
   * `frame` takes the world to the frame of the body; a part of a limb reaches from its joint to an `end`, the joint of
   * the next, and hangs `twisted` so far about its length: a hand without knuckles, or a bone of a finger, is given a
   * bone instead, and lies as it does against that
   */
  constructor(
    frame: Matrix4,
    readonly bone: Object3D,
    private readonly on?: Bone,
    end?: Object3D | Bone,
    twisted = 0,
  ) {
    matrix.multiplyMatrices(frame, bone.matrixWorld).decompose(this.rest, this.hangs, scale)
    this.large = scale.x
    this.local = bone.position.clone()
    if (end instanceof Bone) this.straight.copy(end.straight)
    else if (end) {
      at.setFromMatrixPosition(matrix.multiplyMatrices(frame, end.matrixWorld))
      this.straight.setFromUnitVectors(at.sub(this.rest).normalize(), DOWN)
      this.straight.premultiply(twist.setFromAxisAngle(DOWN, twisted))
    }
    this.hangs.premultiply(this.straight)
    matrix.multiplyMatrices(frame, above(bone).matrixWorld).decompose(at, this.rides, scale)
    if (!on) return
    this.rides.premultiply(on.straight)
    this.at.copy(this.rest).sub(on.rest).applyQuaternion(on.straight)
  }

  /** where its joint is, on the bone it hangs on as that is turned: `lifted` so far further from it (m) */
  carry(on: Bone, lifted = 0) {
    this.place
      .copy(this.at)
      .multiplyScalar(1 + lifted / this.at.length())
      .applyQuaternion(on.turned)
      .add(on.place)
  }

  /**
   * the bone is turned so, in the frame of the body: and if it is `lifted`, its joint that far further from the one
   * it hangs from than at rest (m), along the line between them, which is the bone it hangs from in the rig
   */
  turn(turned: Quaternion, lifted?: number) {
    const { bone, on } = this
    this.turned.copy(turned)
    bone.quaternion.copy(this.rides)
    if (lifted !== undefined) bone.position.copy(this.local).multiplyScalar(1 + lifted / this.at.length())
    if (on) {
      this.carry(on, lifted)
      bone.quaternion.premultiply(on.turned)
    }
    bone.quaternion.invert().multiply(turned).multiply(this.hangs)
  }
}
