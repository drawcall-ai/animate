import { Body } from '@drawcall/animate'
import { grip, Hand } from '@drawcall/hand'
import { Group } from 'three'
import { mannequin } from '../mannequin'
import { run } from '../stage'
import { Ball, hang } from './ball'
import { type Flight, ball, fly } from './court'
import { SEAT, jumpShot } from './shot'

let body: Body
let flight: Flight
let thrown: Ball

run({
  begin() {
    const man = mannequin()
    const scene = new Group().add(man)
    thrown = new Ball(scene)
    scene.add(thrown.mesh)
    scene.updateMatrixWorld(true)
    const hand = new Hand(man, 'right')
    const seat = grip(hand, thrown.mesh, SEAT)
    hang(thrown.mesh, hand.bone, seat)
    body = new Body(man)
    flight = ball()
    body.play(
      jumpShot(body, seat, (velocity) => {
        flight = { position: thrown.place, velocity }
        scene.attach(thrown.mesh)
      }),
    )
    return scene
  },
  update(delta) {
    body.update(delta)
    if (!flight.velocity) return
    fly(flight, delta)
    thrown.mesh.position.copy(flight.position)
  },
  focus: () => body.hips.value.z,
  readout: () => `story     ${body.playing ? 'playing' : 'over'}`,
})
