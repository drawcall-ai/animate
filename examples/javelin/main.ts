import { Body } from 'animate-2d'
import { CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { run } from '../stage'
import { type Javelin, LENGTH, carry, end, javelin } from './field'
import { javelinThrow } from './throw'

const shaft = new Mesh(
  new CylinderGeometry(0.012, 0.012, LENGTH.ahead + LENGTH.behind),
  new MeshStandardMaterial({ color: 0xffd060 }),
)
let body: Body
let thrown: Javelin
let left: { speed: number; up: number } | undefined

run({
  begin() {
    body = new Body()
    thrown = javelin()
    left = undefined
    body.play(javelinThrow(body, thrown))
    return new Group().add(body, shaft)
  },
  update(delta) {
    body.update(delta)
    carry(thrown, body.hand.right.value, delta)
    if (thrown.velocity && !left)
      left = { speed: thrown.velocity.length(), up: (Math.atan2(thrown.velocity.y, thrown.velocity.z) * 180) / Math.PI }
    // the shaft's middle is a little behind where it is held; a cylinder lies along y, so it is turned down from upright
    shaft.position.copy(end(thrown, (LENGTH.ahead - LENGTH.behind) / 2))
    shaft.rotation.x = Math.PI / 2 - thrown.angle
  },
  focus: () => body.hips.value.z,
  readout() {
    return [
      `released  ${left ? `${left.speed.toFixed(1)} m/s, ${left.up.toFixed(1)}° up` : '…'}`,
      `story     ${body.playing ? 'playing' : 'over'}`,
    ].join('\n')
  },
})
