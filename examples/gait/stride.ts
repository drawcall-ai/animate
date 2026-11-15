import type { Gait } from '@drawcall/gait'
import { ANKLE, type Bones, clamp, GRAVITY, HEEL, type Joints, type Limb, RANGE, raised, REST, type Side, SIDES, SIGN, SOLE, UP } from '@drawcall/limbs'
import { Vector3 } from 'three'

/** how fast a heel comes down again, and comes up (rad a beat), and how finely it is brought up (rad) */
const ROLL = { down: 1.8, up: 9, step: 0.01, exact: 1e-4 }
/** how many times a beat a foot in the air comes round to how it hangs */
const DROOP = 9
/** how many times a beat an ankle eases to where it is to be, from where it was as its foot came down or left the ground */
const EASE = 6
/**
 * how much of the way the hips are pushed the trunk leans, and of the way a leg in the air is swung out it leans
 * against it; how far it leans into the way he goes for every pace (rad); how much of his weight pushes up at the
 * least; how far it leans forward for the hips riding back behind the ankles (by the angle whose sine is so many times
 * as far, in legs); how much of the way the pelvis lists it tilts back over the foot he stands on; how far ahead it leans as the
 * plan has the hips (s)
 */
const LEAN = { pushed: 0.6, swung: 0.25, back: 2.2, going: 0.059, light: 0.25, listed: 0.5, ahead: 0.12 }
/** how much of the way the trunk leans, turns and tilts the head turns back, to stay level and look ahead */
const LEVEL = new Vector3(-0.6, -1, -1)
/** how far ahead of the pelvis the trunk turns at the most to face as he is to, and the head (rad) */
const LEADS = { trunk: 0.8, head: 1.2 }
/** how an arm swings against the legs: of how far the thighs are apart, at rest, more for every pace, at the most; how far the elbow folds for every pace squared, at the most, and how much less for every rad it swings back */
const ARMS = { least: 0.5, faster: 0.44, most: 1.5, folds: 1.3, folded: 1.5, opens: 0.3, thrown: 1.2 }
/** how hard the arms take the legs to push him up, at the least and at the most (times his weight), and how fast the hips rise with them as far up as that throws them (in paces) */
const LIFT = { least: -1, most: 1.2 }
const FLUNG = 0.68

const yawOf = (turn: { x: number; y: number; z: number; w: number }) => {
  const way = new Vector3(0, 0, 1).applyQuaternion(turn as never)
  return Math.atan2(way.x, way.z)
}
const at = new Vector3()
const ankle = new Vector3()
const from = new Vector3()

/**
 * Where the ankle of a foot on the ground is: where it stands, or up and on from there, the heel up as far as the leg
 * needs to reach it from its hip, and as far as keeps the shin from leaning further over the foot than an ankle bends
 * and the thigh from going further back than a hip lets it: within `least` and `most`. Tells how far up the heel is.
 */
function stood(size: Bones['size'], leg: Limb, anchor: Vector3, hip: Vector3, least: number, most: number, to: Vector3) {
  const short = () => hip.distanceTo(to) > leg.length
  const fits = (angle: number) => {
    const { y, z } = raised(size, Math.max(0, angle))
    to.set(anchor.x, anchor.y + y, anchor.z + z)
    if (short()) return false
    const { first, fold } = leg.reach(from.copy(to).sub(hip))
    return first.x <= RANGE.thigh.x[1] && first.x + fold - angle <= RANGE.ankle.x[1]
  }
  let angle = least
  while (angle < HEEL && !fits(angle) && (anchor.z < hip.z || short())) angle += ROLL.step
  for (let step = ROLL.step / 2; angle > least && step > ROLL.exact; step /= 2) if (fits(angle - step)) angle -= step
  const heel = Math.min(most, angle)
  fits(heel)
  return heel
}

/**
 * The body as the gait has it, posed each step: the legs reach their feet from hips the pelvis turns and lists, a heel
 * coming up as the leg needs and rolling down again; the trunk leans as the planned hips push it and into a turn, and
 * turns with the arms, which swing against the legs; the head stays level. Tells the hips for the bones to be posed by.
 */
export class Stride {
  private readonly heel = { left: 0, right: 0 }
  private readonly pitch = { left: 0, right: 0 }
  private readonly toes = { left: 0, right: 0 }
  /** whether each foot was down, where its ankle was, and how far from where it is to be it still is since it came down or left the ground */
  private readonly down = { left: true, right: true }
  private readonly ankle = { left: new Vector3(), right: new Vector3() }
  private readonly eased = { left: new Vector3(), right: new Vector3() }
  private posed?: Parameters<Bones['pose']>[0]
  /** how hard the legs push him up, as the arms have taken it up (times his weight) */
  private lift = 0

  constructor(
    private readonly bones: Bones,
    private readonly joints: Joints,
    private readonly gait: Gait,
  ) {}

  /** where a hip is in the scene, the pelvis turned and listing as it is */
  private hip(side: Side, to: Vector3) {
    const { hips, pelvis } = this.gait
    const { turn, list } = pelvis
    to.set(Math.cos(turn) * Math.cos(list), Math.sin(list), -Math.sin(turn) * Math.cos(list)).multiplyScalar(SIGN[side] * this.bones.size.hip)
    return to.applyAxisAngle(UP, yawOf(hips.turn)).add(hips.value)
  }

  pose(dt: number) {
    const { gait, joints, bones } = this
    const { size } = bones
    const { hips, pelvis } = gait
    const facing = yawOf(hips.turn)
    for (const side of SIDES) {
      const foot = gait.feet[side]
      const toes = (this.toes[side] = yawOf(foot.turn))
      const hip = this.hip(side, new Vector3()).applyAxisAngle(UP, -toes)
      const leg = joints.legs[side]
      const down = !gait.steps[side] && foot.value.y < size.ankle + gait.lead.place.y + 0.01
      const [roll, rise] = [(ROLL.down * dt) / size.beat, (ROLL.up * dt) / size.beat]
      if (!down) this.heel[side] = this.pitch[side]
      const was = this.heel[side]
      const anchor = at.copy(foot.value).applyAxisAngle(UP, -toes)
      if (down) this.heel[side] = stood(size, leg, anchor, hip, was - clamp(was, -roll, roll), Math.min(HEEL, was + rise), ankle)
      else ankle.copy(anchor)
      // (coming down, or leaving the ground heel up, it goes on from where its ankle was, and eases to where it is to be)
      if (down !== this.down[side]) this.eased[side].copy(this.ankle[side]).applyAxisAngle(UP, -toes).sub(ankle)
      this.down[side] = down
      ankle.add(this.eased[side].multiplyScalar(Math.exp((-EASE * dt) / size.beat)))
      this.ankle[side].copy(ankle).applyAxisAngle(UP, toes)
      const { first, fold } = leg.reach(from.copy(ankle).sub(hip))
      leg.first.follow(first, dt)
      leg.second.follow(from.set(fold, 0, 0), dt)
      // the foot lies on the ground, flat or on its ball; in the air it hangs square to its shin
      const hangs = this.pitch[side] + (leg.first.value.x + leg.second.value.x - this.pitch[side]) * Math.min(1, (DROOP * dt) / size.beat)
      const high = Math.max(0, foot.value.y - size.ankle)
      const tipped = (sole: number) => {
        const up = (high + size.ankle) / Math.hypot(sole, size.ankle)
        return up < 1 ? Math.asin(up) - Math.atan2(size.ankle, sole) : Infinity
      }
      this.pitch[side] = down ? this.heel[side] : clamp(hangs, -tipped(SOLE.behind * size.leg), tipped(SOLE.ball * size.leg))
    }
    this.react(dt, facing)
    const posed = {
      value: hips.value,
      velocity: hips.velocity,
      turn: pelvis.turn,
      turning: pelvis.turning,
      list: pelvis.list,
      listing: pelvis.listing,
      facing,
      spins: hips.spin.y,
      lifted: pelvis.breathes(size.trunk),
      toes: this.toes,
    }
    this.posed = posed
    this.draw(0)
  }

  /** the bones are turned to where everything is `seconds` on from the last step, going as it goes then */
  draw(seconds: number) {
    const { bones, joints, posed } = this
    if (!posed) return
    bones.pose(posed, joints, seconds)
    bones.grasp(joints)
    for (const side of SIDES) bones.tread(side, this.pitch[side], this.toes[side])
  }

  /** the free parts come round to what the hips and the legs have them do */
  private react(dt: number, facing: number) {
    const { joints, gait, bones } = this
    const { size } = bones
    const { trunk, head } = joints
    const { hips, going, pelvis } = gait
    // (the trunk leans as the plan has the hips pushed a little ahead, by the time it has come round)
    const [p0, v0, v1] = [new Vector3(), new Vector3(), new Vector3()]
    hips.state(gait.time + LEAN.ahead, p0, v0)
    hips.state(gait.time + LEAN.ahead + 0.02, p0, v1)
    const pushed = v1.sub(v0).divideScalar(0.02)
    const way = new Vector3(Math.sin(facing), 0, Math.cos(facing))
    const up = Math.max(GRAVITY * LEAN.light, GRAVITY + pushed.y)
    const speed = hips.velocity.dot(way)
    const flying = SIDES.every((side) => gait.steps[side])
    const out = SIDES.reduce((sum, side) => sum + (gait.steps[side] && !flying ? Math.atan2(gait.feet[side].value.clone().sub(hips.value).dot(way), hips.value.y - gait.feet[side].value.y) : 0), 0)
    const lean = (by: number) => Math.atan2(flying ? 0 : (hips.value.y / up) * by, hips.value.y)
    // (into a turn: the whole of him as far as his feet are put out of it, and the trunk further as the ground pushes him round)
    const off = Math.cos(going.facing - going.heading)
    const banks = Math.atan(clamp((going.speed * going.curves) / GRAVITY, -0.5, 0.5)) * off
    const pushedRound = LEAN.pushed * Math.atan2(going.speed * going.curves, GRAVITY) * off
    // (low, the hips ride behind the ankles: a shin leans over its foot only as far as an ankle bends)
    const knee = hips.value.y - gait.lead.place.y - size.ankle - size.shin * Math.cos(ANKLE)
    const behind = Math.max(0, Math.sqrt(Math.max(0, size.thigh ** 2 - knee * knee)) - size.shin * Math.sin(ANKLE))
    const over = Math.asin(Math.min(1, (LEAN.back * behind) / size.leg))
    const along = clamp(LEAN.pushed * lean(pushed.dot(way)) + over + (LEAN.going * speed) / size.pace - LEAN.swung * out, ...RANGE.trunk.x)
    const tilt = LEAN.listed * (pelvis.list + banks) + pushedRound
    const fast = Math.abs(speed) / size.pace
    const { left, right } = joints.legs
    const swung = ((right.first.value.x - left.first.value.x) / 2) * Math.min(ARMS.most, ARMS.least + ARMS.faster * fast)
    const want = new Vector3(along, pelvis.turn + (size.shoulder / size.arm) * swung + clamp(going.aims, -LEADS.trunk, LEADS.trunk), -tilt)
    trunk.react(want, dt)
    want.copy(trunk.value).multiply(LEVEL)
    head.react(want.setY(want.y + clamp(going.aims, -LEADS.head, LEADS.head)), dt)
    const folded = Math.min(ARMS.folded, ARMS.folds * fast * fast)
    // the arms are thrown the way the legs push the hips: forward and up as he pushes off, up while he rises through the air, down as he falls
    const lift = flying ? hips.velocity.y / (FLUNG * size.pace) : pushed.y / GRAVITY
    this.lift += (clamp(lift, LIFT.least, LIFT.most) - this.lift) * (1 - Math.exp(-2 * Math.PI * joints.arms.left.first.rate * dt))
    const thrown = -ARMS.thrown * Math.max(0, this.lift)
    for (const side of SIDES) {
      const { first: arm, second: forearm, hand } = joints.arms[side]
      const [forth, rear] = RANGE.arm.x
      arm.react(want.set(clamp(Math.max(-Math.PI / 2, SIGN[side] * swung + thrown) - trunk.value.x, forth, rear), 0, 0), dt)
      const closes = Math.min(folded * (1 - ARMS.opens * arm.value.x), Math.PI + 2 * (arm.value.x + trunk.value.x))
      forearm.react(want.set(-Math.max(0, closes), 0, 0), dt)
      joints.arms[side].off(arm.value, forearm.value.x)
      hand.wrist.react(REST, dt)
      hand.fingers?.react(dt)
    }
  }
}
