import { RigidBodyType } from '@dimforge/rapier3d-compat'
import { Euler, Quaternion, Vector3 } from 'three'
import type { Humanoid } from './humanoid'
import { muscles } from './part'
import { LEG, SHIN, SIDES, type Side, THIGH } from './skeleton'

/** how a foot the timeline named bears the body: `firm` lets it pass over, `braced` stops it */
export type Landing = 'firm' | 'braced'

/**
 * One leg's part in the gait. `swing` is a lifted foot on its way: how far through (0…1), how far the body travels
 * meanwhile, where it left (z) and the spot it is committed to; without one the foot is planted. `named` is the place
 * a timeline said the foot comes down. Planted, its knee is to `bend` under the weight (rad), and `give` is how far
 * the hips have sunk for that (m).
 */
export type Leg = {
  swing: { s: number; travel: number; from: number; spot?: number } | null
  named: { at: number; lands: Landing; bend: number } | null
  braced: boolean
  bend: number
  give: number
}
export type Gait = Record<Side, Leg>

const planted = (): Leg => ({ swing: null, named: null, braced: false, bend: 0, give: 0 })
export const standing = (): Gait => ({ left: planted(), right: planted() })

/** how far behind the hips a foot may be left, how far ahead of them it lands, and how far the body travels while it swings (m), at a speed */
const stride = (speed: number) => ({ back: 0.2 + 0.06 * speed, lead: 0.12 + 0.07 * speed, travel: 0.55 + 0.2 * speed })
/** how long a step takes at the least, when the body is not moving, and a catching step always (s) */
const SWING = 0.3
const CATCH = 0.26
/** how fast a standing body tips over (1/s): its speed divided by this is how much further it will carry */
const TIP = Math.sqrt(9.81 / 0.9)
/** a leg from hip to ankle, and how much of that it is ever stretched to (m) */
export const REACH = THIGH + SHIN
const STRETCH = 0.98 * REACH
/** how high the hips still are over the ankle when they have sunk into a step (m) */
export const SUNK = LEG.hip - LEG.ankle - 0.11
/** how a lifted foot is pulled to where it is led: as a spring (N/m), damped (N s/m), with at most this force (N) */
const PULL = { stiff: 4000, damp: 150, most: 1400 }
/** where a trailing foot is held: how far behind the hip and how high over the ground (m) */
const TRAIL = { back: 0.6, up: 0.4 }
/** how a leg keeps its knee ahead of it while its foot is led, without holding the body back */
const FOLLOW = { frequency: 1.5, damping: 0.15, strength: 0.5 }

/** 0 to 1 with no speed and no push at either end */
export function smooth(x: number) {
  const t = Math.min(1, Math.max(0, x))
  return t * t * t * (10 - 15 * t + 6 * t * t)
}

const hip = new Vector3()
const ankle = new Vector3()
const otherAnkle = new Vector3()
const reachTo = new Vector3()
const pull = new Vector3()
const slip = new Vector3()
const turn = new Quaternion()
const euler = new Euler(0, 0, 0, 'ZXY')
const about = (x: number, z = 0) => turn.setFromEuler(euler.set(x, 0, z))
const pitch = (q: Quaternion) => 2 * Math.atan2(q.x, q.w)

const limbs = (human: Humanoid, side: Side) => ({
  thigh: human.parts[`${side}Thigh`],
  shin: human.parts[`${side}Shin`],
  foot: human.parts[`${side}Foot`],
  upperArm: human.parts[`${side}UpperArm`],
  forearm: human.parts[`${side}Forearm`],
})

/**
 * The gait: what the legs do by themselves over ground at height `floor`, for a humanoid that is to keep `pace`.
 * A foot left behind, or one whose leg is at full stretch, is lifted; a lifted one is led to where it comes down and
 * planted there, where the ground holds it. The feet keep to either side of the line the humanoid faces along, and
 * the legs go as hips and feet take them. The arms swing against the legs.
 */
export function walk(human: Humanoid, floor: number, dt: number) {
  const speed = Math.max(0, human.velocity.z)
  const lengths = stride(speed)
  for (const side of SIDES) {
    const leg = human.gait[side]
    const other = human.gait[side === 'left' ? 'right' : 'left']
    const { thigh, shin, foot, upperArm, forearm } = limbs(human, side)
    const opposite = limbs(human, side === 'left' ? 'right' : 'left')
    const otherTaken = opposite.thigh.asked || opposite.shin.asked
    thigh.socket(hip)
    foot.socket(ankle)
    opposite.foot.socket(otherAnkle)
    const far = hip.distanceTo(ankle)

    // the arm swings against its leg, the elbow bent the more the faster the figure goes
    if (speed > 0.3) {
      upperArm.offer(muscles.loose, about(-0.6 * pitch(thigh.bend(turn))))
      forearm.offer(muscles.loose, about(-0.25 * Math.min(speed, 4)))
    }

    // a leg a timeline has is in the air and its foot its own: let go, it comes down from wherever it is
    if (thigh.asked || shin.asked) {
      foot.body.setBodyType(RigidBodyType.Dynamic, true)
      leg.swing = { s: 0, travel: lengths.travel, from: ankle.z }
      leg.braced = false
      foot.offer(muscles.loose)
      continue
    }
    // the knee stays ahead, loosely: the leg reaches for the ankle it is tied to, never quite straight
    reachTo.copy(ankle).sub(hip).applyQuaternion(turn.copy(human.parts.pelvis.body.rotation()).invert())
    const fold = Math.PI - Math.acos(1 - Math.min(STRETCH, Math.max(0.25, reachTo.length())) ** 2 / (2 * THIGH * SHIN))
    thigh.offer(FOLLOW, about(-Math.atan2(reachTo.z, -reachTo.y) - fold / 2, Math.atan2(reachTo.x, -reachTo.y)))
    shin.offer(FOLLOW, about(fold))

    if (!leg.swing) {
      const otherDown = !other.swing
      const otherLanding = other.swing !== null && other.swing.s > 0.8
      // lifted only once the other is down or all but down, unless the leg can stretch no further
      const free = otherDown || (otherLanding && !other.named)
      // the rear foot of two is lifted as soon as the body is over the front one; a lone foot once it is left behind
      const rear = otherDown && ankle.z < otherAnkle.z + (side === 'left' ? 0.02 : -0.02)
      const going = speed > 0.25 || human.pace > 0
      const behind = going && hip.z - ankle.z > (rear ? 0.05 : lengths.back) && !otherTaken
      const apart = human.pace === 0 && speed < 0.25 && otherDown && otherAnkle.z - ankle.z > 0.25
      const stretched = far > 0.995 * REACH && hip.z > ankle.z + 0.15
      if (!((free && (behind || apart)) || stretched)) {
        // the ground holds a planted foot
        foot.body.setBodyType(RigidBodyType.KinematicPositionBased, true)
        continue
      }
      foot.body.setBodyType(RigidBodyType.Dynamic, true)
      leg.swing = { s: 0, travel: lengths.travel, from: ankle.z }
      leg.braced = false
    }

    const swing = leg.swing
    const catching = speed > 0.8 && human.pace === 0
    // while the other foot is on its way to a named place this one trails behind, heel up: nothing is asked of it yet
    const trailing = other.named !== null
    if (!trailing) swing.s = Math.min(1, swing.s + (catching ? dt / CATCH : (speed * dt) / swing.travel + dt / SWING))
    // how far ahead the foot can come down, the hips sinking into the step as far as they do
    const reach = Math.sqrt(Math.max(0.01, STRETCH ** 2 - Math.min(hip.y - floor - LEG.ankle, SUNK) ** 2))
    // where it comes down: where the timeline said; the spot it is committed to, as far as the leg still reaches it;
    // beside the other foot, standing; where the body's speed is carrying it, if it is to be caught; else ahead of the hips
    const spot = leg.named
      ? leg.named.at
      : swing.spot !== undefined
        ? Math.min(swing.spot, hip.z + reach)
        : speed < 0.25
          ? otherAnkle.z
          : hip.z + Math.min(reach, catching ? speed / TIP + 0.12 : (1 - swing.s) * swing.travel + lengths.lead)
    let height = floor + LEG.ankle + TRAIL.up
    let along = hip.z - TRAIL.back
    if (trailing) swing.from = ankle.z
    else {
      const through = catching ? swing.s * (2 - swing.s) : smooth(swing.s)
      height = floor + LEG.ankle + (0.09 + 0.02 * speed) * Math.sin(Math.PI * swing.s)
      along = swing.from + (spot - swing.from) * through
      if (swing.s > (catching ? 0.3 : 0.6) && !leg.named && swing.spot === undefined) swing.spot = spot
    }
    // the foot is led there at that height, no further from the hip than the leg stretches
    const span = Math.sqrt(Math.max(0, STRETCH ** 2 - (hip.y - height) ** 2))
    reachTo.set(side === 'left' ? LEG.aside : -LEG.aside, height, hip.z + Math.min(span, Math.max(-span, along - hip.z)))
    foot.offer(muscles.loose, about(trailing ? 0.5 : 0.35 * Math.sin(Math.PI * swing.s)))
    // the leg brings the foot there, pulling back on the pelvis as hard as it pulls the foot
    pull
      .copy(reachTo)
      .sub(ankle)
      .multiplyScalar(PULL.stiff)
      .addScaledVector(slip.copy(foot.body.linvel()).sub(human.parts.pelvis.body.linvel()), -PULL.damp)
      .clampLength(0, PULL.most)
      .multiplyScalar(dt)
    foot.body.applyImpulse(pull, true)
    human.parts.pelvis.body.applyImpulse(pull.negate(), true)

    // it is planted when it has come down within the leg's reach, not when its time is up; a named foot only at its place
    const there = !leg.named || Math.abs(ankle.z - leg.named.at) < 0.08
    if (swing.s === 1 && ankle.y <= floor + LEG.ankle + 0.03 && there) {
      foot.body.setBodyType(RigidBodyType.KinematicPositionBased, true)
      leg.swing = null
      leg.braced = leg.named?.lands === 'braced'
      leg.bend = leg.named?.bend ?? 0
      leg.give = 0
      leg.named = null
    }
  }
  // the trunk leans into its speed
  human.parts.chest.offer(muscles.tone, about(Math.min(0.2, 0.04 * speed)))
}

/** the ground lets go of both feet, which are then on their way from where they are */
export function release(human: Humanoid) {
  for (const side of SIDES) {
    const foot = human.parts[`${side}Foot`]
    foot.body.setBodyType(RigidBodyType.Dynamic, true)
    human.gait[side].swing = { s: 0, travel: stride(0).travel, from: foot.socket(ankle).z }
    human.gait[side].braced = false
  }
}
