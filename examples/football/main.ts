import { Body } from 'animate-2d'
import { Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three'
import { run } from '../stage'
import { type Ball, RADIUS, ballAt, fly } from './pitch'
import { shot } from './shot'

const ballMesh = new Mesh(new SphereGeometry(RADIUS), new MeshStandardMaterial({ color: 0xffd060 }))
let body: Body
let ball: Ball

run({
  begin() {
    body = new Body()
    ball = ballAt(5.2)
    body.play(shot(body, ball))
    return new Group().add(body, ballMesh)
  },
  update(delta) {
    body.update(delta)
    fly(ball, delta)
    ballMesh.position.copy(ball.position)
  },
  focus: () => body.hips.value.z,
  readout() {
    const speed = ball.velocity.length()
    const up = (Math.atan2(ball.velocity.y, Math.hypot(ball.velocity.x, ball.velocity.z)) * 180) / Math.PI
    return [
      `ball      ${speed > 0 ? `${speed.toFixed(1)} m/s, ${up.toFixed(1)}° up` : '…'}`,
      `story     ${body.playing ? 'playing' : 'over'}`,
    ].join('\n')
  },
})
