import { Hand, hold } from '@drawcall/hand'
import { Group, Vector3 } from 'three'
import { mannequin } from '../mannequin'
import { run } from '../stage'
import { bottle } from './bottle'
import { handle } from './handle'
import { key } from './key'
import { pen } from './pen'
import { pistol } from './pistol'
import { phone } from './phone'
import { sword } from './sword'
import type { Thing } from './thing'

const THINGS: Thing[] = [sword, bottle, phone, key, handle, pen, pistol]
/** how much the man is enlarged, to see a hand close up from where the shared view looks */
const ENLARGE = 12
let shown = 0

addEventListener('keydown', ({ key: pressed }) => {
  const number = Number(pressed)
  if (number < 1 || number > THINGS.length) return
  shown = number - 1
  document.getElementById('again')?.click()
})

run({
  begin() {
    const man = mannequin()
    const hand = new Hand(man, 'right')
    const thing = THINGS[shown]
    const target = thing.make()
    hand.bone.add(target)
    man.updateMatrixWorld(true)
    hold(hand, target, thing.grip(hand, target))
    // the hand, put where the view looks
    const view = new Group().add(man)
    view.scale.setScalar(ENLARGE)
    view.position.set(0, 1, 0.6).sub(hand.bone.getWorldPosition(new Vector3()).multiplyScalar(ENLARGE))
    return view
  },
  update() {},
  focus: () => 0,
  readout: () => THINGS.map((thing, k) => `${k + 1} ${thing.name}${THINGS[shown] === thing ? '  <' : ''}`).join('\n'),
})
