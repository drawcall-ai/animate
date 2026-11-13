import { Body } from '@drawcall/animate'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three'
import { mannequin } from '../mannequin'
import { run } from '../stage'
import { bowl } from './bowl'
import { type Ball, LANE, LINE, RADIUS, ball, roll } from './lane'

const ballMesh = new Mesh(new SphereGeometry(RADIUS), new MeshStandardMaterial({ color: 0x3060c0 }))
// the boards beyond the foul line, a little proud of the floor, and the line itself
const boards = new Mesh(new BoxGeometry(LANE.width, 0.01, LANE.length), new MeshStandardMaterial({ color: 0xc09050 }))
boards.position.set(-0.2, 0, LINE + LANE.length / 2)
const line = new Mesh(new BoxGeometry(LANE.width, 0.012, 0.03), new MeshStandardMaterial({ color: 0x202020 }))
line.position.set(-0.2, 0, LINE)
let scene: Group
let body: Body
let bowled: Ball
let left: number | undefined

run({
  begin() {
    const man = mannequin()
    body = new Body(man)
    bowled = ball()
    left = undefined
    body.play(bowl(body, bowled))
    ballMesh.position.set(0, 0, 0)
    body.hand.right.grip.add(ballMesh)
    return (scene = new Group().add(man, boards, line))
  },
  update(delta) {
    body.update(delta)
    if (!bowled.velocity) return
    left ??= bowled.velocity.length()
    // let go, it rolls on its own
    if (ballMesh.parent !== scene) scene.add(ballMesh)
    roll(bowled, delta)
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
