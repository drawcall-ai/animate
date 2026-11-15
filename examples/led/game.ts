import type { Game, Input, Start } from '../play'
import { model } from '../play'
import { Character } from '../character'
import { rig } from './skeleton'
import { yard } from './yard'

/** how fast he goes at a walk, and with shift held at a run (m/s) */
const SPEED = { walk: 1.5, run: 4.5 }
/** how fast he leaves the ground in a jump (m/s) */
const JUMP = 5

/** The yard, and a man led over it by a capsule: he walks, runs and jumps wherever the keys ask. */
export const start: Start = async (scene, world) => {
  scene.add(yard())
  const character = new Character(await model(rig()), world)
  scene.add(character.rig)
  return {
    character,
    update(delta: number, input: Input) {
      const { move, run, act } = input
      const speed = run ? SPEED.run : SPEED.walk
      if (act) character.jump(JUMP)
      character.update(delta, { x: move.x * speed, z: move.z * speed })
    },
    readout() {
      const { grounded, floor, position } = character.capsule
      const how = !grounded ? 'in the air' : character.speed > 3 ? 'running' : character.speed > 0.1 ? 'walking' : 'standing'
      return `${how}   speed ${character.speed.toFixed(1)} m/s   ground ${floor.toFixed(2)} m   z ${position.z.toFixed(1)}`
    },
  } satisfies Game
}
