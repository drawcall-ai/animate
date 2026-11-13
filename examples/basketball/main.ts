import { Body } from 'animate-2d'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry } from 'three'
import { run } from '../stage'
import { type Ball, HOOP, RADIUS, ball, carry } from './court'
import { jumpShot } from './shot'

const ballMesh = new Mesh(new SphereGeometry(RADIUS), new MeshStandardMaterial({ color: 0xe07020 }))
// the ring, lying level, and the board behind it
const ring = new Mesh(new TorusGeometry(HOOP.radius, 0.012), new MeshStandardMaterial({ color: 0xd04020 }))
ring.position.set(HOOP.x, HOOP.y, HOOP.z)
ring.rotation.x = Math.PI / 2
const board = new Mesh(new BoxGeometry(1.8, 1.05, 0.03), new MeshStandardMaterial({ color: 0xe0e0e0 }))
board.position.set(HOOP.x, HOOP.y + 0.375, HOOP.z + HOOP.radius + 0.15)
let body: Body
let shot: Ball
let left: { speed: number; up: number; high: number } | undefined
/** how far past the middle of the ring the ball came down through its height (m) */
let past: number | undefined

run({
  begin() {
    body = new Body()
    shot = ball()
    left = undefined
    past = undefined
    body.play(jumpShot(body, shot))
    return new Group().add(body, ballMesh, ring, board)
  },
  update(delta) {
    const above = shot.position.y >= HOOP.y
    body.update(delta)
    carry(shot, body.hand.right.value, delta)
    if (shot.velocity && !left) {
      left = {
        speed: shot.velocity.length(),
        up: (Math.atan2(shot.velocity.y, shot.velocity.z) * 180) / Math.PI,
        high: shot.position.y,
      }
    }
    if (above && shot.position.y < HOOP.y) past ??= shot.position.z - HOOP.z
    ballMesh.position.copy(shot.position)
  },
  focus: () => body.hips.value.z,
  readout() {
    return [
      `released  ${left ? `${left.speed.toFixed(1)} m/s, ${left.up.toFixed(1)}° up, ${left.high.toFixed(2)} m high` : '…'}`,
      `ball      ${past === undefined ? '…' : `${Math.abs(past).toFixed(2)} m ${past < 0 ? 'short of' : 'past'} the middle of the ring`}`,
      `story     ${body.playing ? 'playing' : 'over'}`,
    ].join('\n')
  },
})
