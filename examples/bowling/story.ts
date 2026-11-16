import { Body } from '@drawcall/animate'
import { grip, Hand } from '@drawcall/hand'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { inHand } from '../character'
import { mannequin } from '../mannequin'
import { run } from '../stage'
import { bowl, carry, SIDE } from './bowl'
import { type Ball, GRIP, LANE, LINE, RADIUS, ball, roll, sphere } from './lane'

const ballMesh = sphere()
// the boards beyond the foul line, a little proud of the floor, and the line itself
const boards = new Mesh(new BoxGeometry(LANE.width, 0.01, LANE.length), new MeshStandardMaterial({ color: 0xc09050 }))
boards.position.set(-0.2, 0, LINE + LANE.length / 2)
const line = new Mesh(new BoxGeometry(LANE.width, 0.012, 0.03), new MeshStandardMaterial({ color: 0x202020 }))
line.position.set(-0.2, 0, LINE)
let body: Body
let bowled: Ball
/** how fast the ball left the hand (m/s) */
let left: number | undefined

run({
  begin() {
    const man = mannequin()
    const scene = new Group().add(man, boards, line, ballMesh)
    scene.updateMatrixWorld(true)
    const hands = { left: new Hand(man, 'left'), right: new Hand(man, 'right') }
    const seat = grip(hands.right, ballMesh, GRIP)
    body = new Body(man)
    const held = inHand(body, hands.right, seat)
    // (upright, its holes to his right, as it sits on the palm by a point: it keeps that turn)
    held.off(body.hand.right)
    ballMesh.quaternion.identity()
    held.in(body.hand.right, seat)
    bowled = ball()
    left = undefined
    body.play(
      (function* () {
        yield* carry(body, held, grip(hands.left, ballMesh, SIDE.left))
        yield* bowl(body, held, (velocity) => {
          bowled = { position: ballMesh.position.clone(), velocity }
          left = velocity.length()
        })
      })(),
    )
    return scene
  },
  update(delta) {
    body.update(delta)
    if (!bowled.velocity) return
    // let go, it rolls on its own, turning as it rolls
    const from = bowled.position.z
    roll(bowled, delta)
    ballMesh.position.copy(bowled.position)
    if (bowled.position.y <= RADIUS) ballMesh.rotateX((bowled.position.z - from) / RADIUS)
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
