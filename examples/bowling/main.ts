import { Body } from '@drawcall/animate'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { carry } from '../carry'
import { mannequin } from '../mannequin'
import { run } from '../stage'
import { bowl } from './bowl'
import { type Ball, GRIP, LANE, LINE, ball, roll, sphere } from './lane'

const ballMesh = sphere()
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
    const held = carry(man, 'right', ballMesh, GRIP)
    body = new Body(man)
    bowled = ball()
    left = undefined
    body.play(bowl(body, bowled, ballMesh, held))
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
