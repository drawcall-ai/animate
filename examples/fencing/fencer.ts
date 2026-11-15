import type { Body, Held, Side, Story } from '@drawcall/animate'
import { grip, Hand } from '@drawcall/hand'
import type { PhysicsWorld } from '@drawcall/physics'
import { type Object3D, type Scene, Vector3 } from 'three'
import { Character, holds } from '../character'
import type { Game, Input } from '../play'
import { foil, GRIP } from './foil'
import { Dummy } from './piste'
import { FOIL } from './target'

/** how fast he advances or retreats, and with Shift (m/s) */
const SPEED = { walk: 0.6, quick: 1 }
/** how far apart his feet are en garde, and as the lunge lands (of his leg) */
const APART = { guard: 0.6, lunge: 1.5 }
/** the sword hand en garde, from its shoulder: the elbow bent, the hand ahead below the chest (of his arm) */
const READY = { x: 0.15, y: -0.45, z: 0.6 }
/** the sword hand stretched ahead of its shoulder (of his arm) */
const STRETCHED = { x: 0, y: 0, z: 0.97 }
/** the back hand en garde, raised behind him, and flung back straight as he lunges, from its shoulder (of his arm) */
const RAISED = { x: 0.3, y: 0.3, z: -0.3 }
const FLUNG = { x: 0.2, y: -0.5, z: -0.8 }
/** the blade at the touch, from the hand low on his right up and in to the target; and en garde, toward it */
const BLADE = new Vector3(0.1, 0.12, 1).normalize()
const GUARD = { x: 0.25, y: 0.05, z: 1 }
/** how long the sword hand takes to reach for the target, the front foot landing as it arrives (s) */
const REACH = 0.5

type Phase = 'coming en garde' | 'en garde' | 'advance' | 'retreat' | 'lunge' | 'recovery'

/** A fencer on the piste, en garde facing the dummy: W advances, S retreats, Space lunges at the target and recovers. */
export class Fencer implements Game {
  readonly character: Character
  readonly dummy: Dummy
  private readonly sword = foil()
  private readonly held: Held
  private phase: Phase = 'coming en garde'
  private touches = 0
  /** whether the lunge he is in has touched */
  private touched = false

  constructor(rig: Object3D, world: PhysicsWorld, scene: Scene) {
    this.character = new Character(rig, world)
    const { body } = this.character
    const hand = new Hand(rig, 'right')
    this.held = holds(body, hand, grip(hand, this.sword, GRIP))
    this.dummy = new Dummy(body.size)
    scene.add(rig, this.sword, this.dummy.scene)
    body.face({ x: 0, z: 1 })
    body.play(this.guard(body))
  }

  update(delta: number, input: Input) {
    const { character, dummy } = this
    const { body } = character
    const guard = this.phase === 'en garde' || this.phase === 'advance' || this.phase === 'retreat'
    if (guard && input.act) body.play(this.lunge(body))
    // en garde he advances and retreats along the piste: his stance steps along, the front foot first
    const ahead = guard && !input.act && Math.abs(input.move.z) > 0.5 ? Math.sign(input.move.z) : 0
    if (guard) this.phase = ahead > 0 ? 'advance' : ahead < 0 ? 'retreat' : 'en garde'
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

  /** where on the ground a foot steps for his feet to stand so far apart along the piste, the other foot where it is */
  private apart(body: Body, side: Side, of: number) {
    const other = body.foot[side === 'right' ? 'left' : 'right'].value
    const ahead = side === 'right' ? of : -of
    return body.ground(side, { x: body.hips.value.x, z: other.z + ahead * body.size.leg })
  }

  private *guard(body: Body): Story {
    const step = body.foot.right.to(this.apart(body, 'right', APART.guard))
    this.arms(body)
    yield* step
    this.phase = 'en garde'
  }

  private *lunge(body: Body): Story {
    this.phase = 'lunge'
    this.touched = false
    const out = body.foot.right.to(this.apart(body, 'right', APART.lunge))
    body.hand.left.to(scaled(FLUNG, body), { on: body })
    const touch = this.dummy.at.clone().addScaledVector(BLADE, -FOIL)
    yield* this.held.to(touch, { seconds: REACH, pointing: BLADE })
    // the arm stays stretched as he comes down onto the front foot
    this.held.to(scaled(STRETCHED, body), { on: body, pointing: BLADE })
    yield* out
    this.phase = 'recovery'
    const recovery = body.foot.right.to(this.apart(body, 'right', APART.guard))
    this.arms(body)
    yield* recovery
    this.phase = 'en garde'
  }

  private arms(body: Body) {
    this.held.to(scaled(READY, body), { on: body, pointing: GUARD })
    body.hand.left.to(scaled(RAISED, body), { on: body })
  }
}

const scaled = (place: { x: number; y: number; z: number }, body: Body) => {
  const { arm } = body.size
  return { x: place.x * arm, y: place.y * arm, z: place.z * arm }
}
