import { mannequin } from '../mannequin'
import { run } from '../stage'
import { Soldier } from './soldier'

const held = new Set<string>()
addEventListener('keydown', (event) => held.add(event.code))
addEventListener('keyup', (event) => held.delete(event.code))
const pressed = (...codes: string[]) => Number(codes.some((code) => held.has(code)))

let soldier: Soldier

run({
  begin() {
    soldier = new Soldier(mannequin())
    return soldier.object
  },
  update(delta) {
    soldier.update(delta, {
      forward: pressed('KeyW') - pressed('KeyS'),
      left: pressed('KeyA') - pressed('KeyD'),
      turn: pressed('KeyQ') - pressed('KeyE'),
      pitch: pressed('KeyT') - pressed('KeyB'),
      sprint: pressed('ShiftLeft', 'ShiftRight') === 1,
      reload: pressed('KeyR') === 1,
      grenade: pressed('KeyG') === 1,
    })
  },
  focus: () => soldier.body.hips.value.z,
  readout: () => soldier.errors.at(-1) ?? 'WASD move, Q/E turn, Shift sprint, R reload, G grenade',
})
