import { Body } from '@drawcall/animate'
import { Group } from 'three'
import { carry } from '../carry'
import { mannequin } from '../mannequin'
import { run } from '../stage'
import { GRIP, type Javelin, fly, javelin, shaft as drawn } from './field'
import { javelinThrow } from './throw'

const shaft = drawn()
let scene: Group
let body: Body
let thrown: Javelin
let left: { speed: number; up: number } | undefined

run({
  begin() {
    const man = mannequin()
    const held = carry(man, 'right', shaft, GRIP)
    body = new Body(man)
    thrown = javelin()
    left = undefined
    body.play(javelinThrow(body, thrown, shaft, held))
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
