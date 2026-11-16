import { Hand } from '@drawcall/hand'
import { Light, Vector3 } from 'three'
import { Character, inHand } from '../character'
import type { Game, Input, Start } from '../play'
import { model } from '../play'
import { rig } from './skeleton'
import { gripped, torch } from './torch'
import { yard } from './yard'

/** how fast he walks, runs and searches (m/s) */
const SPEED = { walk: 1.5, run: 4, search: 0.9 }
/** how far the arrows have the camera turn (rad/s), as play.ts has it */
const TURN = 1.8
/** how far along the beam he looks (m), and how far below level it points (rad) */
const LOOK = { far: 10, down: 0.12 }
/** where the torch is held raised and lowered, from his right shoulder as he faces (in lengths of his arm) */
const RAISED = { x: -0.15, y: -0.1, z: 0.8 }
const LOWERED = { x: -0.05, y: -0.8, z: 0.25 }
/** how dim the night leaves the scene's lights (of day) */
const NIGHT = 0.35

/** the night guard in a yard: Space raises his torch to search where the camera looks, and lowers it */
export const start: Start = async (scene, world) => {
  scene.traverse((part) => {
    if (part instanceof Light) part.intensity *= NIGHT
  })
  scene.add(yard())
  const guide = await model(rig())
  const hand = new Hand(guide, 'right')
  const lamp = torch()
  const character = new Character(guide, world)
  const { body } = character
  scene.add(guide, lamp)
  const held = inHand(body, hand, gripped(hand, lamp))
  let searching = false
  let yaw = 0

  return {
    character,
    buttons: [
      { code: 'ArrowRight', label: '▶' },
      { code: 'ArrowLeft', label: '◀' },
    ],
    update(delta: number, input: Input) {
      const { held: keys } = input
      yaw += (Number(keys.has('ArrowLeft')) - Number(keys.has('ArrowRight'))) * TURN * delta
      if (input.act) searching = !searching
      const aim = { x: Math.sin(yaw), z: Math.cos(yaw) }
      const { arm } = body.size
      // (raised before his eyes pointing along the beam, or lowered by his side pointing at the ground ahead)
      if (input.act)
        character.tried(() => {
          const [place, pointing] = searching ? [RAISED, { x: 0, y: -LOOK.down, z: 1 }] : [LOWERED, { x: 0, y: -1, z: 0.6 }]
          void held.to({ x: place.x * arm, y: place.y * arm, z: place.z * arm }, { on: body, pointing })
        })
      const speed = searching ? SPEED.search : input.run ? SPEED.run : SPEED.walk
      character.update(delta, { x: input.move.x * speed, z: input.move.z * speed }, searching ? aim : undefined)
      const { position } = character.feet
      const eyes = position.y + body.size.stand * 1.7
      character.tried(() => {
        if (!searching) return body.look()
        body.look(new Vector3(position.x + aim.x * LOOK.far, eyes - LOOK.far * LOOK.down, position.z + aim.z * LOOK.far))
      })
    },
    readout: () => (searching ? `searching, ${character.speed.toFixed(1)} m/s` : `walking, ${character.speed.toFixed(1)} m/s`),
  } satisfies Game
}
