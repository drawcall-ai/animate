import type { PhysicsWorld } from '@drawcall/physics'
import type { Object3D, Scene } from 'three'
import { Character } from '../character'
import { type Game, type Input, type Start, model } from '../play'
import { press } from './press'
import { type Lit, lit, room, show } from './room'
import { rig } from './skeleton'

/** where the panels stand along x, and how high their buttons are (of how high his hips stand): at the knee, the chest, above the head */
const PANELS = [
  { x: -2, high: 0.55 },
  { x: 0, high: 1.4 },
  { x: 2, high: 2.2 },
]
/** how near a button he must be for Space to press it (in lengths of his arm) */
const NEAR = 1.4
/** how fast he walks and runs (m/s) */
const SPEED = { walk: 1.5, run: 4 }

/** a person who walks about a room of panels, and on Space walks up to the one he is near and presses its button, his action */
class Presser implements Game {
  readonly character: Character
  private readonly panels: Lit[]
  /** the panels whose button was in as of the last frame */
  private readonly down = new Set<Lit>()

  constructor(rigged: Object3D, world: PhysicsWorld, scene: Scene) {
    this.character = new Character(rigged, world)
    const { stand } = this.character.body.size
    this.panels = PANELS.map(({ x, high }) => lit(x, high * stand))
    for (const panel of this.panels) scene.add(panel.view)
    scene.add(rigged, room())
  }

  /** the panel whose button is nearest along the floor, if he is near enough to press it */
  private near() {
    const { position } = this.character.feet
    const reach = NEAR * this.character.body.size.arm
    const far = (panel: Lit) => Math.hypot(panel.button.x - position.x, panel.button.z - position.z)
    const [nearest] = [...this.panels].sort((a, b) => far(a) - far(b))
    return far(nearest) <= reach ? nearest : undefined
  }

  update(delta: number, { move, run, act }: Input) {
    const { character } = this
    const next = act && !character.acting ? this.near() : undefined
    if (next) character.tried(() => character.act(press(character.body, next)))
    const speed = run ? SPEED.run : SPEED.walk
    character.update(delta, { x: move.x * speed, z: move.z * speed })
    for (const panel of this.panels) {
      // (a button pushed in toggles its lamp)
      if (panel.pressed && !this.down.has(panel)) panel.lit = !panel.lit
      if (panel.pressed) this.down.add(panel)
      else this.down.delete(panel)
      show(panel)
    }
  }

  readout() {
    const lamps = this.panels.map((panel) => (panel.lit ? 'on' : 'off')).join('  ')
    return `lamps  ${lamps}\n${this.character.acting ? 'pressing' : 'walking'}`
  }
}

/** the room, and the person in it */
export const start: Start = async (scene, world) => new Presser(await model(rig()), world, scene)
