import { Vector3 } from 'three'
import { PUSH, SETTLE, lands, lowest } from './gait'
import { type Pelvis, toRest } from './pelvis'
import { GRAVITY } from '@drawcall/limbs'

/** how high above where he stands the hips go at the least in a jump: a hop (in lengths of his leg) */
const HOP = 0.05

/**
 * For a jump he lets himself drop, going on as he is going, until the legs, pushing up as hard as they push, have him
 * as high as he stands by the time he is going as he is to leave the ground: then they push, the drop and the push one
 * movement, and along and across as hard as has the hips where they are to be at the top. A top lower than he
 * stands is a hop or a dive there: he comes down at it, and comes to rest as low as it is. Going to a
 * footfall, he first goes on until the drop and half the push carry him there, to be pushed as he comes over it: tells
 * whether he drops.
 */
export function drop(pelvis: Pelvis, dt: number, spring: { top: Vector3; from?: number }) {
  const [{ value, velocity }, { top, from }] = [pelvis, spring]
  const { stand, beat, leg } = pelvis.size
  // how fast he leaves the ground to be so high at the top, how fast he is falling by the time the legs catch him, and how long until then
  // (a hop goes up as far again as a quarter of how far it goes, as a body flies furthest for how hard it is pushed)
  const low = top.y < stand
  const rise = low ? Math.max(HOP * leg, Math.hypot(top.x - value.x, top.z - value.z) / 4) : top.y - stand
  const up = Math.sqrt(2 * GRAVITY * Math.max(rise, HOP * leg))
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
  // (the top of a hop is where he comes down, as low as it is)
  const flies = (low ? 2 : 1) * (up / GRAVITY)
  const wanted = (to: number, going: number) => (to - (going * lasts) / 2) / (lasts / 2 + flies)
  const along = pelvis.led ? velocity.z : wanted(top.z - value.z, velocity.z)
  const across = pelvis.led ? velocity.x : wanted(top.x - value.x, velocity.x)
  // the ground pushes him along the harder the harder the legs push up: no harder than they can
  const most = PUSH.along * (1 + PUSH.up / GRAVITY) * lasts
  const pushed = new Vector3(across - velocity.x, 0, along - velocity.z).clampLength(0, most).add(velocity).setY(up)
  pelvis.launch = { velocity: pushed, until: pelvis.time - dt + lasts }
  pelvis.alights = top.y < stand ? Math.max(top.y, lowest(pelvis.size)) : undefined
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
    if (was > 0) pelvis.fell = true
    value.y = velocity.y = 0
  }
  if (!down || velocity.y > 0) return
  pelvis.falls = pelvis.bounds = false
  // (his legs take up his going across as he lands, and along he comes to rest where it carries him)
  velocity.x = 0
  const y = pelvis.alights ?? pelvis.height
  if (!pelvis.sent) pelvis.course = toRest(y, value.z + lands(pelvis.size, velocity.z), velocity.z || 1)
  pelvis.sent = false
  pelvis.alights = undefined
}
