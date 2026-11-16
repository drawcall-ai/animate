import { clamp, GRAVITY, SIDES, SIGN, wrap } from '@drawcall/gait'
import { type Xyz } from '@drawcall/plan'
import { REST } from './rig/goal'
import { ANKLE, type Joints, RANGE } from './rig/joints'
import { type Size } from './rig/size'
import { Vector3 } from 'three'
import type { Legs } from './legs'

/**
 * how much of the way the hips are pushed the trunk leans, and of the way a leg in the air is swung out it leans
 * against it; how far it leans forward for the hips riding back behind the ankles (by the angle whose sine is so many
 * times as far, in legs); how far it leans into the way he goes for every pace (rad); how much of his weight pushes up
 * at the least; how much of the way the pelvis lists it tilts back over the foot he stands on; how far ahead it leans
 * as the plan has the hips (in beats)
 */
const LEAN = { pushed: 0.6, swung: 0.25, back: 2.2, going: 0.059, light: 0.25, listed: 0.5, ahead: 0.4 }
/** how much of the way the trunk leans, turns and tilts the head turns back, to stay level and look ahead */
const LEVEL = new Vector3(-0.6, -1, -1)
/** how far ahead of the pelvis the trunk turns at the most to face as he is to, and the head (rad) */
const LEADS = { trunk: 0.8, head: 1.2 }
/** how an arm swings against the legs (of how far the thighs are apart, at rest, more for every pace, at the most); how far the elbow folds for every pace squared, at the most, and less for every rad it swings back; how far forward an arm is thrown for a push as hard as his weight (rad) */
const ARMS = { least: 0.5, faster: 0.44, most: 1.5, folds: 1.3, folded: 1.5, opens: 0.3, thrown: 1.2 }
/** how hard the arms take the legs to push him up (times his weight), and how fast the hips rise with them as far up as that throws them (in paces) */
const LIFT = { least: -1, most: 1.2 }
const FLUNG = 0.68
/** how near the way he is to face counts as facing it (rad) */
const FACED = 0.02

/**
 * The free parts reacting to the gait and the hands: the trunk leans as the planned hips push it and into a turn, and
 * turns with the arms, which swing against the legs and are thrown with a push; the head stays level, or looks.
 */
export class Free {
  /** where he looks, until told otherwise */
  looked?: Vector3
  private lift = 0
  /** the way he turns to face where he looks, until he faces it (rad about y) */
  private toward?: number

  constructor(
    private readonly legs: Legs,
    private readonly joints: Joints,
    private readonly size: Size,
  ) {}

  /** the free parts come round to what the hips and the legs have them do, and to what his hands ask */
  react(dt: number) {
    const { joints, size } = this
    const { gait } = this.legs
    const { trunk, head } = joints
    const { hips, going, pelvis } = gait
    const facing = this.legs.facing
    const now = gait.time
    // (the trunk leans as the plan has the hips pushed a little ahead, by the time it has come round)
    const [p0, v0, v1] = [new Vector3(), new Vector3(), new Vector3()]
    const [ahead, h] = [LEAN.ahead * size.beat, 0.066 * size.beat]
    hips.state(now + ahead, p0, v0)
    hips.state(now + ahead + h, p0, v1)
    const pushed = v1.sub(v0).divideScalar(h)
    const way = new Vector3(Math.sin(facing), 0, Math.cos(facing))
    const up = Math.max(GRAVITY * LEAN.light, GRAVITY + pushed.y)
    const speed = hips.velocity.dot(way)
    const flying = SIDES.every((side) => gait.steps[side] || gait.feet[side].frames.length)
    const out = SIDES.reduce((sum, side) => sum + (gait.steps[side] && !flying ? Math.atan2(gait.feet[side].value.clone().sub(hips.value).dot(way), hips.value.y - gait.feet[side].value.y) : 0), 0)
    const lean = (by: number) => Math.atan2(flying ? 0 : (hips.value.y / up) * by, hips.value.y)
    // (into a turn: the whole of him as far as his feet are put out of it, and the trunk further as the ground pushes him round)
    const off = Math.cos(going.facing - going.heading)
    const banks = Math.atan(clamp((going.speed * going.curves) / GRAVITY, -0.5, 0.5)) * off
    const round = LEAN.pushed * Math.atan2(going.speed * going.curves, GRAVITY) * off
    // (low, the hips ride behind the ankles: a shin leans over its foot only as far as an ankle bends)
    const knee = hips.value.y - this.legs.ground - size.ankle - size.shin * Math.cos(ANKLE)
    const behind = Math.max(0, Math.sqrt(Math.max(0, size.thigh ** 2 - knee * knee)) - size.shin * Math.sin(ANKLE))
    const over = Math.asin(Math.min(1, (LEAN.back * behind) / size.leg))
    const upright = clamp(LEAN.pushed * lean(pushed.dot(way)) + over + (LEAN.going * speed) / size.pace - LEAN.swung * out, ...RANGE.trunk.x)
    // (bent for a hand at least as far as that needs, however else he would lean)
    const bend = this.legs.posture.bend(now)
    const along = bend > 0 ? Math.max(upright, bend) : Math.min(upright, bend || upright)
    const tilt = LEAN.listed * (pelvis.list + banks) + round
    const fast = Math.abs(speed) / size.pace
    const { left, right } = joints.legs
    const swung = ((right.first.value.x - left.first.value.x) / 2) * Math.min(ARMS.most, ARMS.least + ARMS.faster * fast)
    const free = SIDES.filter((side) => joints.arms[side].first.reacts).length / SIDES.length
    // (looking somewhere, the trunk turns there as far as it leads the pelvis, the head the rest)
    const looks = this.looked && this.sight(this.looked)
    // (standing, he turns to face where he looks once his head does not turn that far round, unless he is to face a way)
    if (looks && gait.lead.velocity.length() < 0.1 * size.pace && !gait.course && (this.toward !== undefined || Math.abs(wrap(looks.yaw - facing)) > LEADS.head)) {
      const there = Math.abs(wrap(looks.yaw - facing)) < FACED
      this.toward = there ? undefined : looks.yaw
      gait.face(there ? undefined : { x: Math.sin(looks.yaw), z: Math.cos(looks.yaw) })
    }
    const toward = looks ? clamp(looks.yaw - facing, -LEADS.trunk, LEADS.trunk) : clamp(going.aims, -LEADS.trunk, LEADS.trunk)
    const want = new Vector3(along + (looks ? -0.5 * looks.pitch : 0), pelvis.turn + free * (size.shoulder / size.arm) * swung + toward + this.legs.posture.turn(now), -tilt)
    trunk.react(want, dt)
    want.copy(trunk.value).multiply(LEVEL)
    if (looks) want.x = -looks.pitch - trunk.value.x
    const lead = looks ? looks.yaw - facing : going.aims
    head.react(want.setY(want.y + clamp(lead, -LEADS.head, LEADS.head)), dt)
    const folded = Math.min(ARMS.folded, ARMS.folds * fast * fast)
    // the arms are thrown the way the legs push the hips: forward and up as he pushes off, up while he rises through the air, back as he drops and falls
    const lift = flying ? hips.velocity.y / (FLUNG * size.pace) : pushed.y / GRAVITY
    this.lift += (clamp(lift, LIFT.least, LIFT.most) - this.lift) * (1 - Math.exp(-2 * Math.PI * joints.arms.left.first.rate * dt))
    const thrown = -ARMS.thrown * this.lift
    for (const side of SIDES) {
      const { first: arm, second: forearm, hand } = joints.arms[side]
      const [forth, rear] = RANGE.arm.x
      arm.react(want.set(clamp(Math.max(-Math.PI / 2, SIGN[side] * swung + thrown) - trunk.value.x, forth, rear), 0, 0), dt)
      const closes = Math.min(folded * (1 - ARMS.opens * arm.value.x), Math.PI + 2 * (arm.value.x + trunk.value.x))
      forearm.react(want.set(-Math.max(0, closes), 0, 0), dt)
      if (arm.reacts) joints.arms[side].off(arm.value, forearm.value.x)
      hand.wrist.react(REST, dt)
      hand.fingers?.react(dt)
    }
  }

  /** how a place lies from his shoulders: about y from +z toward +x, and up (rad) */
  private sight(place: Vector3) {
    const { x, y, z } = place.clone().sub(this.legs.hips.value)
    return { yaw: Math.atan2(x, z), pitch: Math.atan2(y - this.size.trunk, Math.hypot(x, z)) }
  }

  /** he looks at a place until told otherwise */
  look(place?: Xyz) {
    this.looked = place && new Vector3().copy(place)
  }
}
