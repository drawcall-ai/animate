import RAPIER from '@dimforge/rapier3d-compat'
import { Humanoid, type Solution } from 'animate-2d'
import { Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three'
import { run } from '../stage'
import { BALL, launch, pitch } from './pitch'
import { shot } from './shot'

await RAPIER.init()

const TARGET = 20
const ballMesh = new Mesh(new SphereGeometry(BALL.radius), new MeshStandardMaterial({ color: 0xffd060 }))
let human: Humanoid
let ball: RAPIER.RigidBody
let kick: Solution | undefined
let left: number | undefined

run({
  begin() {
    const made = pitch()
    ball = made.ball
    human = new Humanoid(made.world)
    kick = undefined
    left = undefined
    human.play(function* () {
      kick = yield* shot(human, ball, TARGET)
    })
    return new Group().add(human, ballMesh)
  },
  update(delta) {
    human.update(delta)
    ballMesh.position.copy(ball.translation())
    left ??= launch(ball)
  },
  readout() {
    return [
      `asked     ${TARGET} m/s`,
      `rehearsed ${kick ? `${kick.outcome.toFixed(1)} m/s at ${(100 * kick.power).toFixed(0)}% of the leg's strength; ${kick.reachable.map((v) => v.toFixed(1)).join(' to ')} m/s is in reach` : '…'}`,
      `ball      ${left === undefined ? '…' : `${left.toFixed(1)} m/s`}`,
      `timeline  ${human.playing ? 'playing' : 'over'}`,
    ].join('\n')
  },
})
