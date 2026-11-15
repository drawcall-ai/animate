import { Body, type Story } from '@drawcall/animate'
import { point } from '@drawcall/hand'
import type { PhysicsWorld } from '@drawcall/physics'
import type { Object3D, Scene } from 'three'
import { Character } from '../character'
import { type Game, type Input, type Start, model } from '../play'
import { PANEL } from '../button/panel'
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
/** how long the finger stays on the button (s) */
const HELD = 0.3
/** how fast he walks and runs (m/s) */
const SPEED = { walk: 1.5, run: 4 }

/** the finger goes onto the button and in as far as it goes, the lamp toggles, and the hand comes back */
function* press(body: Body, panel: Lit): Story {
  const hand = body.hand.right
  hand.shape(point)
  const { x, y, z } = panel.button
  yield* hand.to({ x, y, z: z + PANEL.travel }, { with: 'index', palm: { x: 0, y: -1, z: 0 } })
  panel.pressed = true
  panel.lit = !panel.lit
  yield* body.until(body.time + HELD)
  panel.pressed = false
  hand.shape()
  hand.free()
  yield* body.stand()
}

/** a person who walks about a room of panels, and presses the button of the one he is near on Space */
class Presser implements Game {
  readonly character: Character
  private readonly panels: Lit[]
  private target?: Lit

  constructor(rigged: Object3D, world: PhysicsWorld, scene: Scene) {
    this.character = new Character(rigged, world)
    const { stand } = this.character.body.size
    this.panels = PANELS.map(({ x, high }) => lit(x, high * stand))
    for (const panel of this.panels) scene.add(panel.view)
    scene.add(rigged, room())
  }

  /** the panel whose button is nearest along the floor, if he is near enough to press it */
  private near() {
    const { position } = this.character.capsule
    const reach = NEAR * this.character.body.size.arm
    const far = (panel: Lit) => Math.hypot(panel.button.x - position.x, panel.button.z - position.z)
    const [nearest] = [...this.panels].sort((a, b) => far(a) - far(b))
    return far(nearest) <= reach ? nearest : undefined
  }

  update(delta: number, { move, run, act }: Input) {
    const { character } = this
    const { body, capsule } = character
    if (!body.playing) this.target = undefined
    const next = act && !this.target ? this.near() : undefined
    if (next) {
      this.target = next
      character.tried(() => body.play(press(body, next)))
    }
    const speed = run ? SPEED.run : SPEED.walk
    const way = this.target && {
      x: this.target.button.x - capsule.position.x,
      z: this.target.button.z - capsule.position.z,
    }
    character.update(delta, this.target ? { x: 0, z: 0 } : { x: move.x * speed, z: move.z * speed }, way)
    for (const panel of this.panels) show(panel)
  }

  readout() {
    const lamps = this.panels.map((panel) => (panel.lit ? 'on' : 'off')).join('  ')
    return `lamps  ${lamps}\n${this.target ? 'pressing' : 'walking'}`
  }
}

/** the room, and the person in it */
export const start: Start = async (scene, world) => new Presser(await model(rig()), world, scene)
