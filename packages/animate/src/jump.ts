import { Vector3 } from 'three'
import { PUSH, SETTLE, lands } from './gait'
import { type Pelvis, toRest } from './pelvis'
import { GRAVITY, clamp } from './world'

/**
 * For a jump he lets himself drop, going on as he is going, until the legs, pushing up as hard as they push, have him
 * as high as he stands by the time he is going as he is to leave the ground: then they push, the drop and the push one
 * movement, and along as hard as has the hips where they are to be at the top. Going to a footfall, he first goes on
 * until the drop and half the push carry him there, to be pushed as he comes over it: tells whether he drops.
 */
export function drop(pelvis: Pelvis, dt: number, spring: { top: Vector3; from?: number }) {
  const [{ value, velocity }, { top, from }] = [pelvis, spring]
  const { stand, beat } = pelvis.size
  // how fast he leaves the ground to be so high at the top, how fast he is falling by the time the legs catch him, and how long until then
  const up = Math.sqrt(2 * GRAVITY * (top.y - stand))
  const [way, speed] = [stand - value.y, up - velocity.y]
  const caught = velocity.y ** 2 * PUSH.up + GRAVITY * (up * up - 2 * PUSH.up * way)
  const fall = Math.sqrt(Math.max(0, caught) / (PUSH.up + GRAVITY))
  const until = (velocity.y + fall) / GRAVITY
  if (from !== undefined) {
    const along = ((top.z - from) * GRAVITY) / up
    const carried = velocity.z * until + ((velocity.z + along) / 4) * ((up + fall) / PUSH.up)
    // (coming to rest there, the last of the way is ever slower: he drops as it begins)
    const near = Math.max(Math.abs(carried), pelvis.halt === undefined ? 0 : Math.abs(velocity.z) * SETTLE * beat)
    if ((from - value.z) * Math.sign(carried) > near && !pelvis.halted) return false
    spring.from = undefined
  }
  if (until > 0) {
    fly(pelvis, dt, false)
    return true
  }
  // from lower than that they push less hard, over the whole way up; coming down faster than he is to go up, as hard as they push
  const lasts = up + velocity.y > 0 ? (2 * way) / (up + velocity.y) : speed / PUSH.up
  // (led, he leaves the ground going on as he goes: how far on the top is, is the world's)
  const wanted = pelvis.led ? velocity.z : (top.z - value.z - (velocity.z * lasts) / 2) / (lasts / 2 + up / GRAVITY)
  // the ground pushes him along the harder the harder the legs push up: no harder than they can
  const most = PUSH.along * (1 + PUSH.up / GRAVITY) * lasts
  const along = clamp(wanted, velocity.z - most, velocity.z + most)
  pelvis.launch = { velocity: new Vector3(0, up, along), until: pelvis.time - dt + lasts }
  pelvis.spring = undefined
  push(pelvis, dt, pelvis.launch)
  return true
}

/** the legs push him off the ground, as hard as gets him going as he is to leave it by then */
export function push(pelvis: Pelvis, dt: number, launch: { velocity: Vector3; until: number }) {
  const { value, velocity, acceleration } = pelvis
  const left = Math.max(dt, launch.until - pelvis.time + dt)
  acceleration.copy(launch.velocity).sub(velocity).divideScalar(left)
  velocity.addScaledVector(acceleration, dt)
  value.addScaledVector(velocity, dt)
  if (pelvis.time < launch.until) return
  pelvis.launch = undefined
  pelvis.falls = true
}

/** in the air he flies as he was going, until he comes down on a foot: then he goes where he was sent in the air, or makes for a stand where his speed carries him */
export function fly(pelvis: Pelvis, dt: number, down: boolean) {
  const { value, velocity, acceleration } = pelvis
  acceleration.set(0, -GRAVITY, 0)
  velocity.y -= GRAVITY * dt
  const was = value.y
  value.addScaledVector(velocity, dt)
  // (the ground stops him: told as he comes to it)
  if (value.y < 0) {
    if (was > 0) pelvis.fault = pelvis.fallen('he has fallen to the ground with no foot under him')
    value.y = velocity.y = 0
  }
  if (!down || velocity.y > 0) return
  pelvis.falls = pelvis.bounds = false
  if (!pelvis.sent) pelvis.course = toRest(pelvis.height, value.z + lands(pelvis.size, velocity.z), velocity.z || 1)
  pelvis.sent = false
}
