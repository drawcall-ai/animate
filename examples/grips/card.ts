import { grip } from '@drawcall/hand'
import { BoxGeometry, Group, Mesh, Vector3 } from 'three'
import { type Held, stuff } from './held'

/** a card of 85.6 x 54 x 0.8 mm, flat in x-z, its long side along x */
const CARD = { long: 0.0856, wide: 0.054, thick: 0.0008 }

function make() {
  const card = new Group()
  card.name = 'card'
  return card.add(new Mesh(new BoxGeometry(CARD.long, CARD.thick, CARD.wide), stuff(0x3060c0)))
}

/** pinched by a short edge between the thumb and the index finger, the hand out past that edge */
export const card: Held = {
  name: 'card, pinched',
  make,
  by: (hand, card) =>
    grip(hand, card, {
      at: new Vector3(CARD.long / 2 - 0.01, 0, 0),
      from: new Vector3(1, 0, 0),
      using: ['thumb', 'index'],
    }),
}
