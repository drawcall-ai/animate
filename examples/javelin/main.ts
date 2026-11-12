import RAPIER from '@dimforge/rapier3d-compat'
import { Humanoid, type Solution } from 'animate-2d'
import { CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { run } from '../stage'
import { type Held, JAVELIN, field, flight, hold, released } from './field'
import { javelinThrow } from './throw'

await RAPIER.init()

const TARGET = 12
const javelinMesh = new Mesh(
  new CylinderGeometry(JAVELIN.radius, JAVELIN.radius, JAVELIN.length),
  new MeshStandardMaterial({ color: 0xffd060 }),
)
let human: Humanoid
let held: Held
let thrown: Solution | undefined
let left: { speed: number; angle: number } | undefined

run({
  begin() {
    const made = field()
    human = new Humanoid(made.world)
    held = hold(human, made.javelin)
    thrown = undefined
    left = undefined
    human.play(function* () {
      thrown = yield* javelinThrow(human, held, TARGET)
    })
    return new Group().add(human, javelinMesh)
  },
  update(delta) {
    human.update(delta)
    javelinMesh.position.copy(held.javelin.translation())
    javelinMesh.quaternion.copy(held.javelin.rotation())
    if (!left && released(human.world, held) !== undefined) left = flight(held.javelin)
  },
  readout() {
    return [
      `asked     ${TARGET} m/s`,
      `rehearsed ${thrown ? `${thrown.outcome.toFixed(1)} m/s at ${(100 * thrown.power).toFixed(0)}% of the arm's strength; ${thrown.reachable.map((v) => v.toFixed(1)).join(' to ')} m/s is in reach` : '…'}`,
      `released  ${left ? `${left.speed.toFixed(1)} m/s, ${((left.angle * 180) / Math.PI).toFixed(0)}° up` : '…'}`,
      `timeline  ${human.playing ? 'playing' : 'over'}`,
    ].join('\n')
  },
})
