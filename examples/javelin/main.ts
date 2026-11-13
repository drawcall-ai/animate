import { Body } from '@drawcall/animate'
import { CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { mannequin } from '../mannequin'
import { run } from '../stage'
import { type Javelin, LENGTH, THICK, fly, javelin } from './field'
import { javelinThrow } from './throw'

const shaft = new Mesh(
  new CylinderGeometry(THICK, THICK, LENGTH.ahead + LENGTH.behind),
  new MeshStandardMaterial({ color: 0xffd060 }),
)
// a cylinder stands along y: laid along z, ahead of where it is held and behind
shaft.geometry.rotateX(Math.PI / 2)
shaft.geometry.translate(0, 0, (LENGTH.ahead - LENGTH.behind) / 2)
let scene: Group
let body: Body
let thrown: Javelin
let left: { speed: number; up: number } | undefined

run({
  begin() {
    const man = mannequin()
    body = new Body(man)
    thrown = javelin()
    left = undefined
    body.play(javelinThrow(body, thrown))
    body.hand.right.grip.add(shaft)
    return (scene = new Group().add(man))
  },
  update(delta) {
    body.update(delta)
    if (!thrown.velocity) return
    left ??= { speed: thrown.velocity.length(), up: (Math.atan2(thrown.velocity.y, thrown.velocity.z) * 180) / Math.PI }
    // let go, it flies on its own
    if (shaft.parent !== scene) scene.add(shaft)
    fly(thrown, delta)
    shaft.position.copy(thrown.position)
    shaft.rotation.set(-thrown.angle, 0, 0)
  },
  focus: () => body.hips.value.z,
  readout() {
    return [
      `released  ${left ? `${left.speed.toFixed(1)} m/s, ${left.up.toFixed(1)}° up` : '…'}`,
      `story     ${body.playing ? 'playing' : 'over'}`,
    ].join('\n')
  },
})
