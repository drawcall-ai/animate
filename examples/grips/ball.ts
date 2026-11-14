import { grip } from '@drawcall/hand'
import { Group, Mesh, SphereGeometry, Vector3 } from 'three'
import { type Held, stuff } from './held'

const RADIUS = 0.033

function make() {
  const ball = new Group()
  ball.name = 'ball'
  return ball.add(new Mesh(new SphereGeometry(RADIUS, 32, 20), stuff(0xc8e020)))
}

/** held up from below on the fingertips, palm up and clear of it, ready to toss */
export const ball: Held = {
  name: 'tennis ball, ready to toss',
  make,
  by: (hand, ball) =>
    grip(hand, ball, {
      at: new Vector3(0, 0, 0),
      from: new Vector3(0, -1, 0),
      using: ['thumb', 'index', 'middle'],
    }),
}
