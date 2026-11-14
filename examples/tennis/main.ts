import { Body } from '@drawcall/animate'
import { Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three'
import { carry } from '../carry'
import { mannequin } from '../mannequin'
import { run } from '../stage'
import { BALL, type Ball, ballAt, fly } from './ball'
import { forehand } from './forehand'
import { FOREHAND, racket } from './racket'

const sphere = new Mesh(new SphereGeometry(BALL.radius), new MeshStandardMaterial({ color: 0xd8e830 }))
const bat = racket()
let body: Body
let ball: Ball
let left = 0

run({
  begin() {
    const man = mannequin()
    const held = carry(man, 'right', bat, FOREHAND)
    body = new Body(man)
    ball = ballAt()
    left = 0
    body.play(forehand(body, ball, bat, held))
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
