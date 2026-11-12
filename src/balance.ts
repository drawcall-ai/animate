import { Quaternion, Vector3 } from 'three'
import type { Humanoid } from './humanoid'
import { rotationVector } from './part'
import { REACH } from './gait'
import { LEG, SIDES, SKELETON } from './skeleton'

/** how quickly the standing legs bring the pelvis upright (rad/s), turning the trunk and all that hangs on it (kg m²), with at most this torque each (N m) */
const UPRIGHT = { rate: 2 * Math.PI * 2.5, inertia: 6, most: 600 }
/** how high the hips ride over a foot right under them, how low they go for a foot to reach its spot and at the very least, how quickly they are brought there (rad/s), and the most lift that takes, in body weights */
const RIDE = { stand: LEG.hip - 0.03, low: LEG.hip - 0.11, least: LEG.hip - 0.17, rate: 2 * Math.PI * 6, most: 4 }
/** how quickly the body is brought over its feet sideways (rad/s) */
const RATE = 2 * Math.PI * 1.2
/** the most the ground pushes a figure through its legs, brakes it through a foot ahead of it and through any other (m/s²), and how hard a braced leg stops it (1/s) */
const PUSH = 6
const BRAKE = 8
const DRAG = 2.5
const BLOCK = 4

/** how high the hips can be over a foot `reach` ahead or behind, the leg all but straight */
const arc = (reach: number) => LEG.ankle + Math.sqrt(Math.max(0.01, (REACH * 0.97) ** 2 - reach ** 2))

const ankle = new Vector3()
const hip = new Vector3()
const force = new Vector3()
const lean = new Vector3()
const spin = new Vector3()
const turn = new Quaternion()

/**
 * What keeps a humanoid on its feet, as a torque and forces on the pelvis. Over a floor the pelvis is turned upright
 * and to face +z. Through a planted foot the ground carries the hips at the height the leg under them allows, brings
 * the body over its feet sideways, and drives or brakes it toward the pace it is to keep.
 */
export function assist(human: Humanoid, floor: number | undefined, dt: number) {
  const { pelvis } = human.parts
  if (!human.balance || floor === undefined) return
  rotationVector(turn.copy(pelvis.body.rotation()).invert(), lean)
    .multiplyScalar(UPRIGHT.rate ** 2)
    .addScaledVector(spin.copy(pelvis.body.angvel()), -2 * UPRIGHT.rate)
    .multiplyScalar(UPRIGHT.inertia)
    .clampLength(0, UPRIGHT.most)
    .multiplyScalar(dt)
  pelvis.body.applyTorqueImpulse(lean, true)
  const down = SIDES.filter((side) => !human.gait[side].swing)
  if (!down.length) return

  const speed = human.velocity.z
  hip.copy(pelvis.body.translation()).y += LEG.hip - SKELETON.pelvis.center[1]
  let reach = 0
  const settling = human.pace === 0
  let under = down[0]
  let nearest = Infinity
  let aside = 0
  let along = 0
  let ahead = false
  let blocked = false
  for (const side of down) {
    human.parts[`${side}Foot`].socket(ankle)
    aside += ankle.x / down.length
    along += ankle.z / down.length
    ahead ||= ankle.z > hip.z + 0.1
    blocked ||= human.gait[side].braced && ankle.z > hip.z - 0.05
    if (Math.abs(ankle.z - hip.z) >= nearest) continue
    nearest = Math.abs(ankle.z - hip.z)
    under = side
    reach = ankle.z - hip.z
  }
  // the hips ride over the foot nearest under them, as high as that leg lets them; a knee gives after its foot has
  // landed and straightens once the figure is only settling, and a figure shedding its speed sinks into the foot it brakes on
  const leg = human.gait[under]
  const giveTo = settling ? 0 : REACH * (1 - Math.cos(leg.bend / 2))
  leg.give += Math.min(dt * 0.5, Math.max(-dt * 0.4, giveTo - leg.give))
  const sink = settling && reach > 0.1 ? Math.min(0.1, Math.max(0, 0.06 * speed)) : 0
  // … and low enough for a foot that is about to land to reach its spot
  let lowest = arc(reach)
  for (const side of SIDES) {
    const swing = human.gait[side].swing
    const spot = human.gait[side].named?.at ?? swing?.spot
    if (swing && spot !== undefined && (settling || swing.s > 0.8)) lowest = Math.min(lowest, Math.max(RIDE.low, arc(spot - hip.z)))
  }
  const ride = floor + Math.max(RIDE.least, Math.min(RIDE.stand, lowest) - sink - leg.give)
  const gravity = -human.world.gravity.y
  const lift = Math.min(RIDE.most * gravity, Math.max(0, RIDE.rate ** 2 * (ride - hip.y) - 2 * RIDE.rate * human.velocity.y + gravity))
  // a foot brakes the body only from ahead of it; standing on both feet, the body comes to rest between them
  let push = Math.min(PUSH, Math.max(ahead ? -Math.min(BRAKE, 3 + 5 * Math.abs(speed)) : -DRAG, (human.pace - speed) / 0.08))
  if (human.pace === 0 && Math.abs(speed) < 0.6 && down.length === 2) push = Math.min(2.5, Math.max(-2.5, 14 * (along - human.centre.z) - 6 * speed))
  if (blocked) push -= BLOCK * speed
  force.set(RATE * RATE * (aside - human.centre.x) - 2 * RATE * human.velocity.x, lift, push)
  pelvis.body.applyImpulse(force.multiplyScalar(human.kg * dt), true)
}
