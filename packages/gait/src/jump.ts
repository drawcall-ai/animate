import type { Frame, Mover } from '@drawcall/plan'
import { Vector3 } from 'three'
import { GRAVITY, HEEL, left, LOWEST, PUSH, raised, type Side, SIDES, SIGN, type Size, WALK } from './measure'

/** how high above where he stands the hips go at the least: a hop (in legs) */
const HOP = 0.05
/** how much of his weight he lets himself drop with into a crouch */
const DROP = 0.6
/** how much of its length a leg is at as he comes down on it, the knee bent to give; how much of the crouch he gives by landing */
const LANDING = 0.92
const GIVE = 1
/** how much of their length the legs are drawn up by in the air */
const TUCK = 0.25
/** how many marks the flight is written as */
const MARKS = 4
/** how long after the other the foot he took off from comes down, landing going on (in beats) */
const STEP = 0.5
/** where the knee that drives up as he pushes off has its foot, under and ahead of the hips (in legs), swung there from the ground in so long (in beats); running, how high it passes under him as he crouches (in legs) */
const DRIVE = { y: 0.55, z: 0.3, beats: 0.5, clear: 0.12 }
/** how long before he comes down his feet reach for the ground, from drawn up under him (in beats) */
const UNTUCK = 0.5
/** how far ahead of the hips or behind them a foot is carried through the air, going on (in legs) */
const CARRY = 0.2

/** a jump as planned: its frames for the hips and each foot, when he takes off, is highest and lands, and how he lands */
export type Jump = { hips: Frame[]; feet: Record<Side, Frame[]>; leaves: number; top: number; lands: number; place: Vector3; velocity: Vector3; low?: number }

/**
 * A jump for the hips to be at `top` at the top of it, leaving the ground at `leaves` from a place on the ground going
 * so: the crouch, as low as the legs, pushing as hard as they push, need to have him going up fast enough when they
 * are straight; the push, along and across no harder than the legs push, to the top; the flight, as it falls; and
 * landing on legs that give. A top lower than he stands is a hop or a dive: up a quarter as far as it goes, coming down
 * at it and resting as low. Led, he leaves going as he goes.
 */
export function jump(size: Size, hipsOf: Mover, top: Vector3, now: number, soonest: number, from: Vector3, going: Vector3, facing: number, led: boolean, takes: Side): Jump {
  const { stand, leg, ankle } = size
  const ground = from.y
  const low = top.y - ground < stand
  const far = Math.hypot(top.x - from.x, top.z - from.z)
  const rise = low ? Math.max(HOP * leg, far / 4) : top.y - ground - stand
  const up = Math.sqrt(2 * GRAVITY * Math.max(rise, HOP * leg))
  // (he comes down on the balls of his feet, the legs nearly straight; a hop or a dive at its top, as low as it is)
  const touch = low ? Math.max(top.y, ground + 0.5 * stand) : ground + ankle + raised(size, HEEL).y + LANDING * leg
  const air = (up + Math.sqrt(Math.max(0, up * up - 2 * GRAVITY * (touch - ground - stand)))) / GRAVITY
  const flies = low ? air : up / GRAVITY
  const want = new Vector3(top.x - from.x, 0, top.z - from.z).divideScalar(flies)
  // the legs push up no harder than they push, and along no harder than that has them: so far down they crouch, as low as he gets
  const hard = PUSH.along * (1 + PUSH.up / GRAVITY)
  const shove = led ? 0 : want.clone().sub(going).length()
  const crouch = Math.min((1 - LOWEST) * stand, Math.max((up * up) / (2 * PUSH.up), (shove * up) / (2 * hard)))
  const lasts = (2 * crouch) / up
  // (standing, he lets himself down into the crouch no faster than he falls)
  const drop = Math.sqrt((2 * crouch) / (DROP * GRAVITY))
  // (running, he crouches over the foot planted at the soonest moment, and pushes off from it)
  const running = going.length() > WALK.most * size.pace
  const leaves = Math.max(soonest + (running ? lasts : 0), now + lasts + drop)
  const wanted = new Vector3(top.x - from.x, 0, top.z - from.z).divideScalar(flies + lasts / 2)
  const most = hard * lasts
  const across = led ? going.clone() : wanted.sub(going).clampLength(0, most).add(going)
  // (he crouches where his going has him then, and is pushed on from there to how he leaves)
  const crouches = from.clone().addScaledVector(going, leaves - lasts - soonest).setY(ground + stand - crouch)
  const takeoff = crouches.clone().addScaledVector(across.clone().add(going), lasts / 2).setY(ground + stand)
  const velocity = across.clone().setY(up)
  const fall = (t: number) => takeoff.clone().addScaledVector(velocity, t).setY(takeoff.y + up * t - (GRAVITY / 2) * t * t)
  const lands = leaves + air
  const place = fall(air)
  // (he lets himself drop from where his hips were going to be by then, as high as they go now: so the whole of the jump is planned from now)
  const drops = { at: leaves - lasts - drop, place: new Vector3(), velocity: new Vector3(), by: 'jump' }
  hipsOf.state(drops.at, drops.place, drops.velocity)
  const walks = new Vector3()
  hipsOf.state(now, walks, new Vector3())
  drops.place.y = Math.max(drops.place.y, walks.y)
  drops.velocity.y = 0
  const hips: Frame[] = [
    ...(drops.at > now ? [drops] : []),
    // (the drop and the push one movement: going on as he comes, he is pushed to how he leaves)
    { at: leaves - lasts, place: crouches, velocity: going.clone().add(across).multiplyScalar(0.5), by: 'jump' },
    { at: leaves, place: takeoff, velocity, by: 'jump' },
  ]
  for (let k = 1; k < MARKS; k++) {
    const t = (air * k) / MARKS
    hips.push({ at: leaves + t, place: fall(t), velocity: velocity.clone().setY(up - GRAVITY * t), by: 'jump' })
  }
  hips.push({ at: lands, place: place.clone(), velocity: across.clone().setY(up - GRAVITY * air), by: 'jump' })
  // (a hop or a dive rests as low as its top; a jump gives at the knees as he lands, as far as how fast he comes down takes, in as long)
  const falling = Math.abs(up - GRAVITY * air)
  const gives = Math.min((1 - LOWEST) * stand, (falling * falling) / (2 * PUSH.up))
  const settles = (2 * gives) / Math.max(falling, 1e-3)
  const rest = low ? Math.max(touch, ground + LOWEST * stand) : Math.min(touch, ground + stand) - GIVE * gives
  // (a hop or a dive stops where it came down; a jump led on goes on, and one not led comes to rest as the knees give, easing to a stop)
  const on = low ? 0 : led ? 1 : 1 / 3
  hips.push({ at: lands + settles, place: place.clone().addScaledVector(across, on * settles).setY(rest), velocity: across.clone().multiplyScalar(on === 1 ? 1 : 0), by: 'jump' })
  // the feet leave with him, drawn up under him, and reach for the ground under where he lands: going on, the foot he
  // took off from comes down a step after the other
  const runs = across.length() > WALK.most * size.pace
  const feet = { left: [] as Frame[], right: [] as Frame[] }
  // (through the air the legs stay as far apart as they left the ground, drawn up under him: the foot he took off from behind)
  for (const side of SIDES) {
    const out = left(facing).multiplyScalar(SIGN[side] * size.hip)
    const split = runs ? (side === takes ? -CARRY : CARRY) * leg : 0
    const tucked = { x: SIGN[side] * size.hip, y: -(1 - TUCK) * leg, z: split }
    const later = runs && side === takes ? STEP * size.beat : 0
    const down = place.clone().add(out).addScaledVector(across, 0.165 * size.beat + later).setY(ground + ankle)
    // (running, the other knee drives up as he pushes off)
    // (running, it swings through under him, clear of the ground, as he crouches)
    const passes: Frame[] = running ? [{ at: leaves - lasts, leaves: drops.at, on: hipsOf, place: { x: SIGN[side] * size.hip, y: ankle + DRIVE.clear * leg - stand + crouch, z: 0 }, by: 'jump' }] : []
    const drives: Frame[] = side === takes || !running ? [] : [...passes, { at: leaves, leaves: Math.max(now, leaves - DRIVE.beats * size.beat), on: hipsOf, place: { x: SIGN[side] * size.hip, y: -DRIVE.y * leg, z: DRIVE.z * leg }, by: 'jump' }]
    feet[side] = [
      ...drives,
      { at: leaves + Math.min(UNTUCK * size.beat, air / 3), leaves, on: hipsOf, place: tucked, by: 'jump' },
      ...(air > 3 * UNTUCK * size.beat ? [{ at: lands - UNTUCK * size.beat, on: hipsOf, place: tucked, by: 'jump' }] : []),
      { at: lands + later, place: down, by: 'jump' },
    ]
  }
  return { hips, feet, leaves, top: leaves + up / GRAVITY, lands, place: place.setY(ground), velocity: across.clone().setY(0), low: low ? rest - ground : undefined }
}
