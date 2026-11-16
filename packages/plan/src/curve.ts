import { Quaternion, Vector3, type Vector3Like } from 'three'

/** a place or a turn (as a rotation vector, rad) and how fast it changes; and the same as anything with x, y and z tells it */
export type State = { value: Vector3; velocity: Vector3 }
type Told = { value: Vector3Like; velocity: Vector3Like }

/**
 * Where the smoothest way from one state to another in `T` seconds is a share `s` through, and how fast it goes there:
 * the cubic that leaves as it was going and arrives as asked. A fast arrival draws it back first, and one that leaves
 * fast swings on before it turns.
 */
export function cubic(s: number, T: number, from: Told, to: Told, value: Vector3, velocity: Vector3) {
  const [s2, s3] = [s * s, s * s * s]
  velocity
    .copy(from.value)
    .multiplyScalar((6 * s2 - 6 * s) / T)
    .addScaledVector(from.velocity, 3 * s2 - 4 * s + 1)
    .addScaledVector(to.value, (6 * s - 6 * s2) / T)
    .addScaledVector(to.velocity, 3 * s2 - 2 * s)
  return value
    .copy(from.value)
    .multiplyScalar(2 * s3 - 3 * s2 + 1)
    .addScaledVector(from.velocity, (s3 - 2 * s2 + s) * T)
    .addScaledVector(to.value, 3 * s2 - 2 * s3)
    .addScaledVector(to.velocity, (s3 - s2) * T)
}

const gap = new Vector3()
const push = new Vector3()
/** how hard that cubic pushes at the most, at its start or its end (m/s²): it is hardest at one of them */
export function hardest(from: Told, to: Told, T: number) {
  gap.subVectors(to.value, from.value)
  const at = (far: number, was: number, then: number) =>
    push.copy(gap).multiplyScalar(far / T).addScaledVector(from.velocity, was).addScaledVector(to.velocity, then).length() / T
  return Math.max(at(6, -4, -2), at(-6, 2, 4))
}

/** the most that `holds` and the least that does not, between one value that does and one that does not, halving */
export function between(holds: number, fails: number, test: (value: number) => boolean) {
  for (let k = 0; k < 12; k++) {
    const middle = (holds + fails) / 2
    if (test(middle)) holds = middle
    else fails = middle
  }
  return [holds, fails]
}

const half = new Quaternion()
/** the rotation vector that turns `from` to `to`, in the frame of `from` (rad) */
export function turnFrom(from: Quaternion, to: Quaternion, out: Vector3) {
  half.copy(from).invert().multiply(to)
  if (half.w < 0) half.set(-half.x, -half.y, -half.z, -half.w)
  const sin = Math.sqrt(half.x * half.x + half.y * half.y + half.z * half.z)
  const angle = 2 * Math.atan2(sin, half.w)
  return sin < 1e-9 ? out.set(half.x * 2, half.y * 2, half.z * 2) : out.set(half.x, half.y, half.z).multiplyScalar(angle / sin)
}

/** `from` turned on by a rotation vector in its own frame */
export function turnBy(from: Quaternion, by: Vector3, out: Quaternion) {
  const angle = by.length()
  if (angle < 1e-9) return out.copy(from)
  return out.copy(from).multiply(half.setFromAxisAngle(gap.copy(by).divideScalar(angle), angle))
}
