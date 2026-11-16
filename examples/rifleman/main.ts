import { mannequin } from '../mannequin'
import { run } from '../stage'
import { buttons, controls, Stick, touching } from '../touch'
import { Soldier } from './soldier'

// (a key let go counts as held until a frame has read it: a tap between two frames is not lost)
const [held, up] = [new Set<string>(), new Set<string>()]
const release = (code: string) => up.add(code)
addEventListener('keydown', (event) => held.add(event.code))
addEventListener('keyup', (event) => release(event.code))
const pressed = (...codes: string[]) => Number(codes.some((code) => held.has(code)))
// played by fingers, a stick leads him and buttons stand for the keys
let stick: Stick | undefined
if (touching) {
  const layer = controls()
  stick = new Stick(layer)
  const keys = [
    { code: 'KeyR', label: 'reload' },
    { code: 'KeyE', label: '▶' },
    { code: 'KeyQ', label: '◀' },
    { code: 'KeyG', label: 'grenade' },
  ]
  buttons(layer, keys, (code) => held.add(code), release)
}

let soldier: Soldier

run({
  begin() {
    soldier = new Soldier(mannequin())
    return soldier.object
  },
  update(delta) {
    soldier.update(delta, {
      forward: pressed('KeyW') - pressed('KeyS') + (stick?.y ?? 0),
      left: pressed('KeyA') - pressed('KeyD') - (stick?.x ?? 0),
      turn: pressed('KeyQ') - pressed('KeyE'),
      pitch: pressed('KeyT') - pressed('KeyB'),
      sprint: pressed('ShiftLeft', 'ShiftRight') === 1 || Boolean(stick?.rim),
      reload: pressed('KeyR') === 1,
      grenade: pressed('KeyG') === 1,
    })
    for (const code of up) held.delete(code)
    up.clear()
  },
  focus: () => soldier.body.hips.value.z,
  readout: () => soldier.errors.at(-1) ?? 'WASD move, Q/E turn, Shift sprint, R reload, G grenade',
})
