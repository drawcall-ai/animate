import type { Side, Story } from '@drawcall/animate'
import { fist } from '@drawcall/hand'
import type { RigidBody } from '@drawcall/physics'
import { Line3, type Object3D, Vector3 } from 'three'
import { Character } from '../character'
import type { Game, Input } from '../play'
import { BAG, gym } from './gym'

type Punch = 'jab' | 'cross' | 'hook'

/** where the heavy bag hangs: how far ahead of where he starts, and how high its middle is (of how high his hips stand) */
const ROOM = { ahead: 1.6, high: 1.45 }
/** how fast he moves about in his guard, and when Shift has him go faster (m/s) */
const SPEED = { guard: 1.3, quick: 2 }
/** how far ahead of the middle of his hips his lead foot steps into his stance (of his leg), once he is slower than he counts as still at (m/s) */
const STANCE = 0.35
const STILL = 0.1
/** a combination, in order, and how long after a punch lands the next press still carries it on (s) */
const COMBINATION: Punch[] = ['jab', 'cross', 'hook']
const WINDOW = 0.7
/**
 * which hand throws each punch, how fast it is to meet the bag (m/s; as fast as it can, if it cannot), and how far
 * from the middle of his hips along the ground it reaches (of his arm): further, it falls short in the air. A hook
 * lands with the elbow bent, its fist going across
 */
const PUNCH: Record<Punch, { side: Side; speed: number; reach: number }> = {
  jab: { side: 'left', speed: 7, reach: 0.95 },
  cross: { side: 'right', speed: 9, reach: 0.95 },
  hook: { side: 'left', speed: 7, reach: 0.8 },
}
/** how far round the bag from its near side a hook lands, toward the hand that throws it (rad) */
const HOOK = 0.8
/** the guard: each fist before his chin, counted from its shoulder (of his arm: in toward his middle, up, ahead) */
const GUARD: Record<Side, { inward: number; up: number; ahead: number }> = {
  left: { inward: 0.05, up: 0.2, ahead: 0.7 },
  right: { inward: -0.1, up: 0.18, ahead: 0.7 },
}
/** how much of a fist's speed the bag takes, as the weight of the arm behind it (kg) */
const FIST = 2.5
/** how far off the bag's face a fist still counts as on it (m) */
const TOUCH = 0.05
/** how long a fist sent to the guard may take to be there before it is sent again (s) */
const RECOVER = 1
const SIGN: Record<Side, number> = { left: 1, right: -1 }
const UP = new Vector3(0, 1, 0)
const DOWN = new Vector3(0, -1, 0)

/**
 * A boxer led by the keys: he moves about the gym in his guard, facing the heavy bag whichever way he steps, and
 * Space throws a punch at it; presses close after each other make a combination: jab, cross, hook.
 */
export class Boxer implements Game {
  readonly character: Character
  /** the punch he is throwing, if he is, how many presses wait for it to land, and when the last one landed (s) */
  private throwing?: Punch
  private waiting = 0
  private last?: { punch: Punch; time: number }
  /** how many punches have landed on the bag, and how hard the last one did (N·s) */
  private landed = 0
  private blow = 0
  /** when each fist was last sent to the guard (s) */
  private readonly guarded: Record<Side, number> = { left: 0, right: 0 }
  /** whether he stands in his stance */
  private planted = false
  private readonly bag: RigidBody

  /** `rig` is his rigged body at rest, in the `scene` the physics world simulates, which the gym is put in */
  constructor(rig: Object3D, scene: Object3D) {
    // (read while the rig is at rest, before the body poses it)
    this.character = new Character(rig)
    const { stand } = this.character.body.size
    const room = gym(new Vector3(0, ROOM.high * stand, ROOM.ahead * stand))
    scene.add(rig, room.scene)
    this.bag = room.bag
    for (const side of ['left', 'right'] as const) {
      this.character.tried(() => {
        this.character.body.hand[side].shape(fist)
        this.guard(side)
      })
    }
  }

  /** the fist on a side goes back up before his chin */
  private guard(side: Side) {
    const { arm } = this.character.body.size
    const { inward, up, ahead } = GUARD[side]
    const place = { x: -SIGN[side] * inward * arm, y: up * arm, z: ahead * arm }
    this.guarded[side] = this.character.body.time
    this.character.body.hand[side].to(place, { on: this.character.body, palm: { x: -SIGN[side], y: 0, z: 0 } })
  }

  /** which way the bag is from him, along the ground */
  private toward() {
    const { position } = this.character.feet
    return this.bag.position.clone().sub(position).setY(0).normalize()
  }

  update(delta: number, input: Input) {
    const { character } = this
    const moving = input.move.x !== 0 || input.move.z !== 0
    const settled = character.speed < STILL && character.body.hips.velocity.length() < STILL
    if (!moving && !this.planted && settled) {
      this.planted = true
      character.body.play(this.stance())
    }
    if (input.act) this.waiting = Math.min(this.waiting + 1, COMBINATION.length)
    if (!this.throwing && this.waiting > 0) this.next()
    // a fist the body let go of, as it could not keep it in the guard, goes back up
    for (const side of ['left', 'right'] as const) {
      const punching = this.throwing && PUNCH[this.throwing].side === side
      const lost = !character.body.hand[side].there && character.body.time - this.guarded[side] > RECOVER
      if (lost && !punching) character.tried(() => this.guard(side))
    }
    const speed = input.run ? SPEED.quick : SPEED.guard
    const way = this.toward()
    character.update(delta, { x: input.move.x * speed, z: input.move.z * speed }, { x: way.x, z: way.z })
  }

  /** at rest he stands in his stance: the lead foot steps ahead toward the bag */
  private *stance(): Story {
    const { body, feet } = this.character
    const { x, z } = feet.position.clone().addScaledVector(this.toward(), STANCE * body.size.leg)
    yield* body.foot.left.to(body.ground('left', { x, z }))
  }

  /** the next punch: on in the combination if the last one landed only a moment ago, else it begins it again */
  private next() {
    const { body } = this.character
    const { last } = this
    const going = last && body.time - last.time < WINDOW
    const at = going ? (COMBINATION.indexOf(last.punch) + 1) % COMBINATION.length : 0
    const punch = COMBINATION[at]
    this.waiting--
    this.throwing = punch
    body.play(this.punch(punch))
  }

  /** a punch at the bag: the fist meets it where it hangs at the height of his shoulders, or falls short in the air, and goes back to his guard */
  private *punch(punch: Punch): Story {
    try {
      const { body, feet } = this.character
      const { side, speed, reach } = PUNCH[punch]
      const { arm, stand, trunk } = body.size
      const { bag } = this
      const way = this.toward()
      // the side of the bag the fist comes in on, and the way it moves there: a hook comes round from his side
      const face = way.clone().negate()
      const velocity = way.clone()
      if (punch === 'hook') {
        face.applyAxisAngle(UP, -SIGN[side] * HOOK)
        velocity.crossVectors(way, UP).multiplyScalar(SIGN[side]).addScaledVector(way, 0.5).normalize()
      }
      const hit = bag.position
        .clone()
        .setY(stand + trunk)
        .addScaledVector(face, BAG.radius)
      // (beyond his reach, it falls short of the bag in the air)
      const hips = feet.position.clone().setY(hit.y)
      const place = hips.clone().add(hit.sub(hips).clampLength(0, reach * arm))
      const hand = body.hand[side]
      const met = yield* hand.to(place, {
        with: 'knuckles',
        velocity: velocity.multiplyScalar(speed),
        palm: DOWN,
      })
      if (met) this.strike(side, place)
      this.guard(side)
    } finally {
      this.last = { punch, time: this.character.body.time }
      this.throwing = undefined
    }
  }

  /** the bag takes the blow of the fist on a side, if it is on the bag at `at` as the bag hangs now, as the fist moves */
  private strike(side: Side, at: Vector3) {
    this.bag.updateMatrixWorld()
    const axis = new Line3(
      this.bag.localToWorld(new Vector3(0, BAG.length / 2, 0)),
      this.bag.localToWorld(new Vector3(0, -BAG.length / 2, 0)),
    )
    if (axis.closestPointToPoint(at, true, new Vector3()).distanceTo(at) > BAG.radius + TOUCH) return
    const closing = this.character.body.hand[side].velocity.clone().sub(this.bag.getVelocityAtPoint(at))
    const impulse = closing.multiplyScalar(FIST)
    this.bag.applyImpulse(impulse, at)
    this.landed++
    this.blow = impulse.length()
  }

  readout() {
    const away = this.bag.position.clone().sub(this.character.feet.position).setY(0).length()
    return [
      `boxer     ${this.throwing ?? 'guard'}${this.waiting ? ` (+${this.waiting})` : ''}`,
      `landed    ${this.landed}, the last ${this.blow.toFixed(1)} N·s`,
      `bag       ${away.toFixed(2)} m away, swinging ${this.bag.getVelocity().linear.length().toFixed(2)} m/s`,
    ].join('\n')
  }
}
