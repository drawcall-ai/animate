import { hold } from '@drawcall/hand'
import { Group, Vector3 } from 'three'
import { run } from '../stage'
import { mannequin } from '../mannequin'
import { Hand } from '@drawcall/hand'
import { ball } from './ball'
import { card } from './card'
import { hammer } from './hammer'
import type { Held } from './held'
import { lever } from './lever'
import { mug } from './mug'
import { racket } from './racket'

const THINGS: Held[] = [racket, ball, mug, hammer, card, lever]
/** the whole scene is drawn this many times life size, so the hand fills the view */
const CLOSE = 4
const KEYS = THINGS.map((_, i) => String(i + 1))

let shown = 0
let swap = () => {}
const show = (at: number) => {
  shown = at
  swap()
}
addEventListener('keydown', (event) => {
  const at = KEYS.indexOf(event.key)
  if (at >= 0) show(at)
})
for (const [at, held] of THINGS.entries()) {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = `${KEYS[at]} ${held.name}`
  button.addEventListener('click', () => show(at))
  document.querySelector('.bar')?.append(button)
}

run({
  begin() {
    const man = mannequin()
    const hand = new Hand(man, 'right') // at rest, before anything moves
    // each thing is gripped where it stands, then carried in the hand
    const things = THINGS.map((held) => {
      const object = held.make()
      return { object, grip: held.by(hand, object) }
    })
    const view = new Group().add(man)
    view.scale.setScalar(CLOSE)
    view.updateMatrixWorld(true)
    view.position.set(0, 1, 0.6).sub(hand.bone.getWorldPosition(new Vector3()))
    swap = () => {
      for (const { object } of things) object.removeFromParent()
      const { object, grip } = things[shown]
      hand.bone.add(object)
      hold(hand, object, grip)
    }
    swap()
    return view
  },
  update() {},
  focus: () => 0,
  readout: () => THINGS.map((held, i) => `${i + 1}${i === shown ? ' >' : '  '} ${held.name}`).join('\n'),
})
