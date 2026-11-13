import { Body } from 'animate-2d'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three'
import { run } from '../stage'
import { bowl } from './bowl'
import { type Ball, LANE, LINE, RADIUS, ball, carry } from './lane'

const ballMesh = new Mesh(new SphereGeometry(RADIUS), new MeshStandardMaterial({ color: 0x3060c0 }))
// the boards beyond the foul line, a little proud of the floor, and the line itself
const boards = new Mesh(new BoxGeometry(LANE.width, 0.01, LANE.length), new MeshStandardMaterial({ color: 0xc09050 }))
boards.position.set(-0.2, 0, LINE + LANE.length / 2)
const line = new Mesh(new BoxGeometry(LANE.width, 0.012, 0.03), new MeshStandardMaterial({ color: 0x202020 }))
line.position.set(-0.2, 0, LINE)
let body: Body
let bowled: Ball
let left: number | undefined

run({
  begin() {
    body = new Body()
    bowled = ball()
    left = undefined
    body.play(bowl(body, bowled))
    return new Group().add(body, ballMesh, boards, line)
  },
  update(delta) {
    body.update(delta)
    carry(bowled, body.hand.right.value, delta)
    if (bowled.velocity) left ??= bowled.velocity.length()
    ballMesh.position.copy(bowled.position)
  },
  focus: () => body.hips.value.z,
  readout() {
    return [
      `released  ${left === undefined ? '…' : `${left.toFixed(1)} m/s`}`,
      `ball      ${bowled.velocity ? `${(bowled.position.z - LINE).toFixed(1)} m down the lane` : 'in the hand'}`,
      `story     ${body.playing ? 'playing' : 'over'}`,
    ].join('\n')
  },
})
