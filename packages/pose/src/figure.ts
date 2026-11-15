import { Gait, type Side } from '@drawcall/gait'
import { Bones, bends, both, DOWN, type Grip, joints, type Joints, parts, RANGE, raised, SIDES, SIGN, type Story } from '@drawcall/limbs'
import { Channel, type Frame } from '@drawcall/plan'
import { Euler, type Object3D, Quaternion, Vector3 } from 'three'
import { asks, Spring, springs, still, together } from './posture'

/** the step his time goes by (s) */
const DT = 1 / 120
/** how far ahead of a hand the hips and the trunk move for it (s): the hips first */
const LEAD = { hips: 0.25, trunk: 0.12 }
/** how strong a hand is (m/s²), and how far it draws back at the most (of an arm) */
const HAND = { strength: 70, reach: 0.5 }
/** how an arm swings against the legs, at rest and for every m/s, and how far its elbow folds (rad) */
const SWING = { least: 0.1, faster: 0.13, fold: 0.25, folds: 0.15 }
const UP = new Vector3(0, 1, 0)
const euler = new Euler()
const yawOf = (turn: Quaternion) => {
  const ahead = new Vector3(0, 0, 1).applyQuaternion(turn)
  return Math.atan2(ahead.x, ahead.z)
}
const within = (value: Vector3, range: Partial<Record<'x' | 'y' | 'z', number[]>>) => {
  for (const axis of ['x', 'y', 'z'] as const) {
    const [least, most] = range[axis] ?? [-Infinity, Infinity]
    value[axis] = Math.min(most, Math.max(least, value[axis]))
  }
  return value
}

/**
 * A rigged humanoid moved by channels: the gait's hips and feet, a hand on each side, and the things bound to him. A
 * story writes frames to them; each step every channel goes to where its frames have it, and the joints are turned to
 * put the hips, the feet and the hands there, as near as they reach. What a hand is to do moves the rest of him a
 * little ahead of it: the trunk turns after it and his weight goes with it, and he gets down for it.
 */
export class Figure {
  readonly size: Bones['size']
  readonly gait: Gait
  readonly hand: Record<Side, Channel>
  time = 0
  private readonly bones: Bones
  private readonly joints: Joints
  private readonly stories: Story<unknown>[] = []
  private readonly things = new Map<Object3D, { channel: Channel; hands: Side[] }>()
  private readonly springs = springs()
  private readonly arms = both(() => ({ first: [0, 0, 0].map(() => new Spring(1.6)), fold: new Spring(1.6) }))
  private readonly shoulder: Record<Side, Vector3>
  private owed = 0

  constructor(rig: Object3D) {
    this.bones = new Bones(rig)
    this.joints = joints(this.bones)
    this.size = this.bones.size
    for (const part of parts(this.joints)) part.free()
    const { leg, hip, stand, ankle, arm } = this.size
    this.gait = new Gait({ leg, hip, stand, ankle })
    this.pose()
    this.shoulder = both((side) => this.bones.shouldered(side, new Vector3()).sub(this.gait.hips.value))
    this.hand = both((side) => {
      const hand = new Channel(`${side} hand`, HAND.strength, HAND.reach * arm)
      hand.set(this.bones.wrist[side], this.bones.hand[side])
      return hand
    })
  }

  /** a thing is bound to him from now on: a channel the story writes frames to, which hands can be bound to */
  bind(mesh: Object3D) {
    const channel = new Channel(mesh.name || 'thing', HAND.strength, HAND.reach * this.size.arm)
    channel.set(mesh.position, mesh.quaternion)
    this.things.set(mesh, { channel, hands: [] })
    return channel
  }

  /** where the wrist is and how the hand is turned on a thing for a grip to hold it, in the thing's frame */
  held(side: Side, { position, quaternion }: Grip) {
    const { hangs, large } = this.bones.lies('hand', side)
    const turned = new Quaternion().copy(quaternion).premultiply(hangs)
    const back = turned.clone().invert()
    return { place: new Vector3().copy(position).multiplyScalar(large).applyQuaternion(hangs).negate().applyQuaternion(back), turn: back }
  }

  /** the thing is in the hand by a grip at once, moved to it: for a story that starts with it held */
  hold(side: Side, mesh: Object3D, grip: Grip) {
    const { channel, hands } = this.found(mesh)
    const { place, turn } = this.held(side, grip)
    const thing = this.hand[side].turn.clone().multiply(turn.clone().invert())
    channel.set(this.hand[side].value.clone().sub(place.clone().applyQuaternion(thing)), thing)
    this.hand[side].bind(channel)
    hands.push(side)
    this.joints.arms[side].hand.fingers?.shape(grip.pose, 0.1)
  }

  /** the hand goes onto a thing by a grip, by a moment or as soon as it can, and is bound to it there */
  *take(side: Side, mesh: Object3D, grip: Grip, at?: number): Story {
    const { channel, hands } = this.found(mesh)
    const hand = this.hand[side]
    const frame = hand.by({ at, on: channel, ...this.held(side, grip), by: 'story' })
    this.joints.arms[side].hand.fingers?.shape(grip.pose, 0.3)
    while (hand.frames.includes(frame)) yield
    hand.bind(channel)
    hands.push(side)
  }

  /** the hand is bound to a thing where it is on it now */
  attach(side: Side, mesh: Object3D) {
    const { channel, hands } = this.found(mesh)
    this.hand[side].bind(channel)
    hands.push(side)
  }

  /** a thing is let go: every hand on it goes on as it was moving, and so does it, now moved from outside. Tells how fast */
  letGo(mesh: Object3D) {
    const { channel, hands } = this.found(mesh)
    for (const side of hands.splice(0)) this.hand[side].unbind()
    channel.outside = true
    return channel.velocity.clone()
  }

  /** a hand is the body's again: it hangs and swings as he goes */
  free(side: Side) {
    this.hand[side].cancel()
  }

  private found(mesh: Object3D) {
    const found = this.things.get(mesh)
    if (!found) throw new Error('the thing is not bound to him')
    return found
  }

  /** has a story played beside whatever is playing */
  play(story: Story<unknown>) {
    this.stories.push(story)
  }

  get playing() {
    return this.stories.length > 0
  }

  /** a story over at a moment */
  *until(when: number): Story {
    while (this.time < when - 1e-9) yield
  }

  /** a story over once a channel has met a frame */
  *met(channel: Channel, frame: Frame): Story {
    while (channel.frames.includes(frame)) yield
  }

  /** whether a hand is the story's: going somewhere, held somewhere or bound */
  private owned(side: Side) {
    const { owner, busy } = this.hand[side]
    return busy || (owner !== undefined && owner !== 'on')
  }

  update(delta: number) {
    for (this.owed += delta; this.owed >= DT; this.owed -= DT) this.step()
  }

  private step() {
    for (let k = 0; k < this.stories.length; k++) if (this.stories[k].next().done) this.stories.splice(k--, 1)
    this.time += DT
    const { time } = this
    for (const [mesh, { channel }] of this.things) {
      if (channel.outside) channel.value.copy(mesh.position)
      channel.advance(time)
    }
    this.gait.advance(time)
    this.gait.hips.advance(time)
    for (const side of SIDES) this.gait.feet[side].advance(time)
    for (const side of SIDES) this.hand[side].advance(time)
    this.pose()
    for (const [mesh, { channel }] of this.things) {
      if (channel.outside) continue
      mesh.position.copy(channel.value)
      mesh.quaternion.copy(channel.turn)
    }
    // a hand the body has goes on from where the body has it
    for (const side of SIDES) {
      const hand = this.hand[side]
      if (this.owned(side)) continue
      hand.velocity.copy(this.bones.wrist[side]).sub(hand.value).divideScalar(DT)
      hand.value.copy(this.bones.wrist[side])
      hand.turn.copy(this.bones.hand[side])
    }
  }

  /** what the hands ask of the trunk and the hips, a little ahead of them */
  private asked(ahead: number) {
    const hips = new Vector3()
    this.gait.hips.state(this.time + ahead, hips, new Vector3())
    const facing = yawOf(this.gait.hips.turn)
    return together(
      SIDES.filter((side) => this.owned(side)).map((side) => {
        const at = new Vector3()
        this.hand[side].state(this.time + ahead, at, new Vector3())
        const on = at.sub(hips).applyAxisAngle(UP, -facing)
        return asks(side, on, this.shoulder[side], this.size.arm, this.size.leg)
      }),
    )
  }

  /** turns the joints to put the hips, the feet and the hands where their channels have them, and poses the bones */
  private pose() {
    const { gait, joints, bones, size } = this
    if (!this.shoulder) return this.posed(gait.hips.value, yawOf(gait.hips.turn), 0, 0)
    const [hips, trunk] = [this.asked(LEAD.hips), this.asked(LEAD.trunk)]
    const sink = this.springs.sink.to(hips.sink, DT)
    const shift = this.springs.shift.to(hips.shift, DT)
    const turn = this.springs.turn.to(trunk.turn, DT)
    const bend = this.springs.bend.to(trunk.bend, DT)
    const facing = yawOf(gait.hips.turn)
    const speed = Math.hypot(gait.hips.velocity.x, gait.hips.velocity.z)
    const stride = gait.stepping ? Math.sin(2 * Math.PI * gait.phase) : 0
    const at = gait.hips.value.clone().add({ x: Math.sin(facing) * shift, y: -sink, z: Math.cos(facing) * shift })
    joints.trunk.value.set(bend + 0.03 * speed, turn, 0)
    joints.head.value.set(-0.7 * (bend + 0.03 * speed), -0.8 * turn, 0)
    this.posed(at, facing, 0.5 * turn + 0.12 * stride * Math.min(1, speed), 0)
    // the legs reach their feet, a heel coming up for a foot the leg no longer reaches flat
    const heels = both(() => 0)
    for (const side of SIDES) {
      const foot = gait.feet[side]
      const toes = yawOf(foot.turn)
      const ankle = foot.value.clone()
      const hip = bones.hip(side)
      if (ankle.y < size.ankle + 0.01) {
        for (let heel = 0; heel <= 0.9 && ankle.distanceTo(hip) > 0.995 * size.leg; heel += 0.05) {
          const up = raised(size, heel)
          ankle.copy(foot.value).add({ x: Math.sin(toes) * up.z, y: up.y, z: Math.cos(toes) * up.z })
          heels[side] = heel
        }
      }
      const leg = joints.legs[side]
      const { first, fold } = leg.reach(ankle.sub(hip).applyAxisAngle(UP, -toes))
      leg.first.value.copy(within(first.clone(), RANGE.thigh))
      leg.second.value.set(Math.min(RANGE.shin.x[1], Math.max(RANGE.shin.x[0], fold)), 0, 0)
    }
    // the arms: a hand the story has reaches its channel, the others hang and swing against the legs
    const trunkTurn = new Quaternion().setFromAxisAngle(UP, facing).multiply(new Quaternion().setFromEuler(euler.set(joints.trunk.value.x, joints.trunk.value.y, 0)))
    for (const side of SIDES) {
      const arm = joints.arms[side]
      const springs = this.arms[side]
      if (this.owned(side)) {
        const hand = this.hand[side]
        const to = hand.value.clone().sub(bones.shouldered(side, new Vector3())).applyQuaternion(trunkTurn.clone().invert())
        const { first, fold } = arm.reach(to)
        arm.off(first, fold)
        arm.first.value.copy(within(first.clone(), RANGE.arm))
        arm.second.value.set(Math.min(0, Math.max(RANGE.forearm.x[0], fold)), 0, 0)
        const forearm = trunkTurn.clone().multiply(new Quaternion().setFromEuler(euler.setFromVector3(arm.first.value)))
        forearm.multiply(new Quaternion().setFromEuler(euler.set(arm.second.value.x, 0, 0)))
        const palm = arm.hand.palm.clone().applyQuaternion(hand.turn)
        const pointing = DOWN.clone().applyQuaternion(hand.turn)
        const wrist = bends(forearm, arm.hand.palm, palm, pointing)
        arm.hand.wrist.value.copy(within(wrist ? wrist.clone() : new Vector3(), RANGE.wrist))
        springs.first.forEach((spring, k) => ((spring.value = arm.first.value.getComponent(k)), (spring.velocity = 0)))
        springs.fold.value = arm.second.value.x
        continue
      }
      const forward = -Math.cos(2 * Math.PI * (gait.phase - (side === 'left' ? 0.6 : 0.1)))
      const swing = gait.stepping ? Math.min(0.7, SWING.least + SWING.faster * speed) * forward : 0
      const want = [-swing, 0, SIGN[side] * 0.08]
      want.forEach((value, k) => arm.first.value.setComponent(k, springs.first[k].to(value, DT)))
      arm.second.value.set(springs.fold.to(-(SWING.fold + SWING.folds * speed), DT), 0, 0)
      arm.hand.wrist.value.multiplyScalar(0.95)
    }
    for (const part of parts(joints)) part.advance(DT)
    this.posed(at, facing, 0.5 * turn + 0.12 * stride * Math.min(1, speed), 0)
    bones.grasp(joints)
    for (const side of SIDES) bones.tread(side, heels[side], yawOf(gait.feet[side].turn))
    // a thing held goes as near where it is to be as the leading hand reaches
    for (const [, { channel, hands }] of this.things) {
      const lead = hands[0]
      if (!lead || channel.outside) continue
      channel.value.add(this.bones.wrist[lead].clone().sub(this.hand[lead].value))
    }
  }

  private posed(at: Vector3, facing: number, turn: number, list: number) {
    const toes = both((side) => yawOf(this.gait.feet?.[side]?.turn ?? new Quaternion()))
    const zero = { turning: 0, listing: 0, spins: 0, lifted: 0 }
    this.bones.pose({ value: at, velocity: new Vector3(), turn, list, facing, toes, ...zero }, this.joints, 0)
  }
}
