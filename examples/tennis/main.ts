import { Body } from '@drawcall/animate'
import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry } from 'three'
import { mannequin } from '../mannequin'
import { run } from '../stage'
import { BALL, type Ball, RACKET, ballAt, fly } from './ball'
import { forehand } from './forehand'

const sphere = new Mesh(new SphereGeometry(BALL.radius), new MeshStandardMaterial({ color: 0xd8e830 }))
// the racket, from where it is held along z to the middle of its strings
const grip = new Mesh(
  new CylinderGeometry(0.015, 0.015, RACKET.reach - RACKET.head),
  new MeshStandardMaterial({ color: 0x303030 }),
)
grip.rotation.x = Math.PI / 2
grip.position.z = (RACKET.reach - RACKET.head) / 2
const head = new Mesh(new TorusGeometry(RACKET.head, 0.012), new MeshStandardMaterial({ color: 0xe0e0e0 }))
head.rotation.y = Math.PI / 2
head.scale.y = 1.25
head.position.z = RACKET.reach
const racket = new Group().add(grip, head)
let body: Body
let ball: Ball
let left = 0

run({
  begin() {
    const man = mannequin()
    body = new Body(man)
    ball = ballAt()
    left = 0
    body.play(forehand(body, ball))
    body.hand.right.grip.add(racket)
    return new Group().add(man, sphere)
  },
  update(delta) {
    body.update(delta)
    const struck = ball.struck
    fly(ball, delta)
    if (ball.struck > struck || (ball.struck && !left)) left = ball.velocity.length()
    sphere.position.copy(ball.position)
  },
  focus: () => body.hips.value.z,
  readout() {
    return [
      `forehand  ${ball.struck ? `the ball leaves at ${left.toFixed(1)} m/s` : '…'}`,
      `story     ${body.playing ? 'playing' : 'over'}`,
    ].join('\n')
  },
})
