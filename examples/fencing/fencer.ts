import type { Story, Thing } from '@drawcall/animate'
import { grip, Hand } from '@drawcall/hand'
import { type Object3D, type Scene, Vector3 } from 'three'
import { Character, inHand } from '../character'
import type { Game, Input } from '../play'
import { foil, GRIP } from './foil'
import { guard, lunge } from './lunge'
import { Dummy } from './piste'
import { FOIL } from './target'

/** how fast he advances or retreats, and with Shift (m/s) */
const SPEED = { walk: 0.6, quick: 1 }

type Phase = 'coming en garde' | 'en garde' | 'advance' | 'retreat' | 'lunge' | 'recovery'

/**
 * A fencer on the piste, en garde facing the dummy: W advances, S retreats, the player leading his stance along, and
 * Space lunges at the target and recovers, his action, the front foot placed out and back. The foil is bound to him
 * from the start, his right hand leading it.
 */
export class Fencer implements Game {
  readonly character: Character
  readonly dummy: Dummy
  private readonly sword = foil()
  private readonly foil: Thing
  private phase: Phase = 'coming en garde'
  private touches = 0
  /** whether the lunge he is in has touched */
  private touched = false

  constructor(rig: Object3D, scene: Scene) {
    scene.add(rig, this.sword)
    const hand = new Hand(rig, 'right')
    this.character = new Character(rig)
    const { body } = this.character
    this.foil = inHand(body, hand, grip(hand, this.sword, GRIP))
    this.dummy = new Dummy(body.size)
    scene.add(this.dummy.scene)
    body.face({ x: 0, z: 1 })
    this.character.act(this.play(guard(body, this.foil), 'en garde'))
  }

  update(delta: number, input: Input) {
    const { character, dummy } = this
    const guarding = this.phase === 'en garde' || this.phase === 'advance' || this.phase === 'retreat'
    if (guarding && input.act) {
      this.phase = 'lunge'
      this.touched = false
      const recovering = () => (this.phase = 'recovery')
      character.act(this.play(lunge(character.body, this.foil, dummy, recovering), 'en garde'))
    }
    // en garde he advances and retreats along the piste: his stance steps along, the front foot first
    const ahead = guarding && !input.act && Math.abs(input.move.z) > 0.5 ? Math.sign(input.move.z) : 0
    if (guarding && !input.act) this.phase = ahead > 0 ? 'advance' : ahead < 0 ? 'retreat' : 'en garde'
    const speed = (input.run ? SPEED.quick : SPEED.walk) * ahead
    character.update(delta, { x: 0, z: speed }, { x: 0, z: 1 })
    this.sword.updateWorldMatrix(true, false)
    const point = this.sword.localToWorld(new Vector3(0, 0, FOIL))
    if (this.phase !== 'lunge' || this.touched || !dummy.hit(point)) return
    this.touched = true
    this.touches++
  }

  readout() {
    return [`touches  ${this.touches}`, this.phase].join('\n')
  }

  focus() {
    return this.dummy.at
  }

  /** an action, and the phase he is in once it is over */
  private *play(action: Story, after: Phase): Story {
    yield* action
    this.phase = after
  }
}
