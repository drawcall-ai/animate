import type { Locomotion } from '@drawcall/locomotion'
import { type Bones, both, type Joints, parts, type Side, SIDES, type Size, type Story, tick, UP } from '@drawcall/limbs'
import { Euler, type Object3D, Quaternion, Vector3 } from 'three'
import type { End } from './ends'
import type { Watched } from './movers'
import type { Asks } from './posture'
import { reachArm, reachLeg } from './solve'
import type { Bound } from './thing'

/** what a step moves: the workings of a body, as it is made of them */
export type Workings = {
  rig: Object3D
  size: Size
  bones: Bones
  locomotion: Locomotion
  joints: Joints
  ends: Record<'foot' | 'hand', Record<Side, End>>
  things: Map<Object3D, Bound>
  watched: Map<Object3D, Watched>
  asks: Asks
}

const euler = new Euler()
/** how far a hand may be from where its plan has it before it goes on from where the arm has it (in lengths of his leg) */
const REACHED = 0.023

/**
 * The body's time, which goes on a step at a time however it is updated: in each the stories go on, the things he
 * holds, the hips and the feet and the hands go where they are going, the free parts react, the limbs the story has
 * reach for where their channels have them, and the bones are turned.
 */
export class Clock {
  /** the seconds it has gone on for, and those it has been updated for that are less than a step yet */
  time = 0
  private owed = 0
  readonly stories: Story<unknown>[] = []
  /** whether there has been an update since the last step, and what went wrong in the step being made */
  private updated = false
  private readonly faults: unknown[] = []
  /** how far each foot is bent toe down against its shin, as it was in the last step (rad) */
  private readonly bent = both(() => 0)
  /** how far each elbow is swung out about the line from its shoulder to its hand (rad) */
  private readonly swivel = both(() => 0)
  /** where each wrist was after the last step */
  private readonly wrist = both(() => new Vector3())
  /** from when until when on his clock the update being made goes on */
  private span = { from: 0, to: 0 }

  constructor(private readonly body: Workings) {}

  private get all() {
    const { ends } = this.body
    return SIDES.flatMap((side) => [ends.foot[side], ends.hand[side]])
  }

  update(delta: number) {
    if (!(delta >= 0 && delta < Infinity)) throw new Error(`time goes on by ${delta} s`)
    const dt = tick(this.body.size)
    this.updated = true
    // (the steps go on from him as he is, not as he was drawn ahead of them)
    if (this.owed > 0) this.draw(0)
    this.span = { from: this.time + this.owed, to: this.time + this.owed + delta }
    this.body.locomotion.going.places(this.span.to)
    for (this.owed += delta; this.owed >= dt; this.updated = false) {
      this.owed -= dt
      this.advance(dt, this.updated)
    }
    this.body.locomotion.going.looks()
    // he is drawn as he is at the moment the update is for, between his steps
    if (this.owed > 0) this.draw(this.owed)
  }

  private advance(delta: number, frame: boolean) {
    const { locomotion, joints, things, watched, asks } = this.body
    const { going } = locomotion
    const now = this.time + delta
    // a thing moves only between updates: what the story's frames are on is looked at anew once an update
    if (frame) for (const thing of watched.values()) thing.look(this.time)
    // (one that has left his scene is let go by what was sent onto it, and that is said once)
    const top = (part: Object3D): Object3D => (part.parent ? top(part.parent) : part)
    for (const [object] of watched) {
      if (top(object) === top(this.body.rig)) continue
      watched.delete(object)
      for (const end of this.all) {
        if (!end.on.has(object)) continue
        end.free()
        this.faults.push(new Error(`the ${end.name} is to be on a thing that is not in the scene he is in`))
      }
    }
    for (const thing of things.values()) if (thing.outside) thing.follow(this.time, now, frame)
    // (what a story throws is thrown once the step is done, and the story is over)
    for (let k = 0; k < this.stories.length; k++) {
      let done = true
      try {
        done = this.stories[k].next().done === true
      } catch (error) {
        this.faults.push(error)
      }
      if (done) this.stories.splice(k--, 1)
    }
    asks.now = this.time
    asks.forget()
    // where he looks is told as it lies from his shoulders now
    const { from, to } = this.span
    const looked = going.looking(to > from ? Math.min(1, (now - from) / (to - from)) : 1)
    // the things go first, then the hips and the feet, then the ends, those on a thing with it
    for (const thing of things.values()) thing.channel.advance(now)
    locomotion.step(delta, this.body.ends.foot, looked)
    for (const end of this.all) end.channel.advance(now)
    // a hand or a foot swung on and come to rest is the body's again, and so is a foot held in the air as he lands
    const lands = locomotion.carrier.landing
    for (const end of this.all) {
      const { busy, owner, holding } = end.channel
      if ((!busy && owner === 'on') || (end.kind === 'foot' && lands && holding && !busy)) end.free()
    }
    for (const part of parts(joints)) part.advance(delta)
    locomotion.react(delta)
    this.pose(delta)
    this.time = now
    const faults = this.faults.splice(0)
    const said = faults.map((fault) => (fault instanceof Error ? fault.message : String(fault)))
    if (faults.length > 1) throw new AggregateError(faults, said.join('\n'))
    if (faults.length) throw faults[0]
  }

  /** the limbs the story has reach for their channels, the free ones are as the body has them, and the bones are turned */
  pose(delta: number) {
    const { locomotion, joints, bones, ends, things } = this.body
    locomotion.pose(delta, ends.foot)
    this.draw(0)
    const posed = locomotion.posed()
    const trunk = new Quaternion().setFromAxisAngle(UP, posed.facing).multiply(new Quaternion().setFromEuler(euler.setFromVector3(joints.trunk.value)))
    for (const side of SIDES) {
      const hand = ends.hand[side]
      if (hand.held) {
        const arm = joints.arms[side]
        const reached = reachArm(arm, bones.shouldered(side, new Vector3()), trunk, hand.channel.value, hand.channel.turn, this.swivel[side])
        this.swivel[side] = reached.swivel
        arm.first.follow(reached.first, delta)
        arm.second.follow(new Vector3(reached.fold, 0, 0), delta)
        arm.hand.wrist.follow(reached.wrist, delta)
      } else if (!joints.arms[side].first.reacts) {
        // (given back at rest, it reacts from where it is)
        for (const part of [joints.arms[side].first, joints.arms[side].second, joints.arms[side].hand.wrist]) {
          part.velocity.set(0, 0, 0)
          part.free()
        }
      }
      const foot = ends.foot[side]
      if (foot.held) {
        const leg = joints.legs[side]
        const reached = reachLeg(leg, bones.hip(side), posed.toes[side], foot.channel.value)
        leg.first.follow(reached.first, delta)
        leg.second.follow(new Vector3(reached.fold, 0, 0), delta)
      }
    }
    this.draw(0)
    // a thing the body moves is where the first hand on it has it, as near where it is to be as that arm reaches
    for (const thing of things.values()) {
      const lead = thing.hands[0]?.end
      const gap = lead && !thing.outside ? bones.wrist[lead.side].clone().sub(lead.channel.value) : undefined
      // (and it goes on from there: what the arm cannot do it is met as nearly as it can be)
      if (gap && gap.length() > REACHED * this.body.size.leg) thing.channel.value.add(gap)
      thing.write()
    }
    for (const side of SIDES) {
      const [hand, foot] = [ends.hand[side], ends.foot[side]]
      hand.gap = bones.wrist[side].distanceTo(hand.channel.value)
      // a hand on its way that its arm cannot follow goes on from where the arm has it: met as nearly as it can be
      if (hand.held && hand.gap > REACHED * this.body.size.leg && !this.bound(hand)) {
        hand.channel.velocity.copy(bones.wrist[side]).sub(this.wrist[side]).divideScalar(delta)
        hand.channel.value.copy(bones.wrist[side])
      }
      this.wrist[side].copy(bones.wrist[side])
      foot.gap = bones.ankle[side].distanceTo(foot.channel.value)
      hand.track(delta, bones.wrist[side], bones.hand[side])
      foot.track(delta, bones.ankle[side])
      this.bent[side] = locomotion.tread(side, foot, delta)
    }
    this.feet()
  }

  /** whether a hand is on a thing */
  private bound(hand: End) {
    return [...this.body.things.values()].some(({ hands }) => hands.some(({ end }) => end === hand))
  }

  /** the bones are turned to where everything is `seconds` on from his last step, going as it goes then */
  private draw(seconds: number) {
    const { joints, bones } = this.body
    bones.pose(this.body.locomotion.posed(), joints, seconds)
    bones.grasp(joints)
    this.feet()
  }

  /** the feet are laid as they stand or step, or as their shins have them, the story having them */
  private feet() {
    const { joints, bones, ends, locomotion } = this.body
    const { toes } = locomotion.posed()
    for (const side of SIDES) {
      const { first: thigh, second: shin } = joints.legs[side]
      if (ends.foot[side].held) bones.pitch(side, this.bent[side])
      else bones.tread(side, this.bent[side] + thigh.value.x + shin.value.x, toes[side])
    }
  }
}
