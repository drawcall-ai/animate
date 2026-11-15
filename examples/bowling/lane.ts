import type { Statement } from '@drawcall/hand'
import { Color, Float32BufferAttribute, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three'

/** `velocity` is none while it is in the hand */
export type Ball = { position: Vector3; velocity: Vector3 | null }

export const RADIUS = 0.108
/** the palm under the ball and the fingers up its side: the thumb does not reach round a ball so big */
export const GRIP: Statement = {
  at: new Vector3(0, -RADIUS, 0),
  from: new Vector3(0, -1, 0),
  using: ['palm', 'index', 'middle', 'ring', 'little'],
}
/** where the foul line is, ahead of where the bowler starts, and how long and wide the lane is beyond it (m) */
export const LINE = 4.5
export const LANE = { length: 18.3, width: 1.05 }
const GRAVITY = 9.81
/** how much of its speed a rolling ball loses in a second */
const DRAG = 0.04

/** where a ball's three finger holes are, in its frame, and how wide one is (rad): they show how it turns */
const HOLES = [new Vector3(-1, 0.3, 0), new Vector3(-1, 0.65, 0.35), new Vector3(-1, 0.65, -0.35)].map((v) => v.normalize())
const HOLE = 0.16

/** a ball of a colour, its finger holes dark */
export function sphere(color = 0x3060c0) {
  const geometry = new SphereGeometry(RADIUS, 48, 32)
  const [normal, paint, dark] = [geometry.getAttribute('normal'), new Color(color), new Color(0x101018)]
  const colors: number[] = []
  const at = new Vector3()
  for (let k = 0; k < normal.count; k++) {
    at.fromBufferAttribute(normal, k)
    const hole = HOLES.some((h) => at.angleTo(h) < HOLE)
    colors.push(...(hole ? dark : paint).toArray())
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true }))
}

export const ball = (): Ball => ({ position: new Vector3(), velocity: null })

/** where the middle of the ball is as the hand lets it go `ahead` of the origin (m), in the line of a right arm: a hand above the boards */
export const release = (ahead: number) => new Vector3(-0.2, RADIUS + 0.09, ahead)

/** let go, it drops onto the boards and rolls on down the lane, to its end */
export function roll(b: Ball, dt: number) {
  if (!b.velocity || b.position.z >= LINE + LANE.length) return
  b.velocity.y -= GRAVITY * dt
  b.position.addScaledVector(b.velocity, dt)
  if (b.position.y > RADIUS) return
  b.position.y = RADIUS
  b.velocity.y = 0
  b.velocity.multiplyScalar(1 - DRAG * dt)
}
