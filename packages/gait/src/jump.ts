import type { Frame, Mover } from '@drawcall/plan'
import { Vector3 } from 'three'
import { GRAVITY, HEEL, left, PUSH, raised, type Side, SIDES, SIGN, type Size, WALK } from './measure'

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
/** how long after the other the foot he took off from comes down, landing going on (s) */
const STEP = 0.15
/** where the knee that drives up as he pushes off has its foot, under and ahead of the hips (in legs) */
const DRIVE = { y: 0.55, z: 0.3 }
/** how long before he comes down his feet reach for the ground, from drawn up under him (s) */
const UNTUCK = 0.15
/** how far ahead of the hips or behind them a foot is carried through the air, going on (in legs) */
const APART = 0.2

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
  const crouch = (up * up) / (2 * PUSH.up)
  const lasts = (2 * crouch) / up
  // (standing, he lets himself down into the crouch no faster than he falls)
  const leaves = Math.max(soonest, now + lasts + Math.sqrt((2 * crouch) / (DROP * GRAVITY)))
  // (a hop comes down at its top: up and down again)
  const flies = (low ? 2 : 1) * (up / GRAVITY)
  const wanted = new Vector3(top.x - from.x, 0, top.z - from.z).divideScalar(flies + lasts / 2)
  const most = PUSH.along * (1 + PUSH.up / GRAVITY) * lasts
  const across = led ? going.clone() : wanted.sub(going).clampLength(0, most).add(going)
  const takeoff = from.clone().addScaledVector(across, lasts / 2).setY(ground + stand)
  const velocity = across.clone().setY(up)
  const fall = (t: number) => takeoff.clone().addScaledVector(velocity, t).setY(takeoff.y + up * t - (GRAVITY / 2) * t * t)
  // (he comes down on the balls of his feet, the legs nearly straight; a hop as low as its top)
  const touch = low ? Math.max(top.y, ground + 0.5 * stand) : ground + ankle + raised(size, HEEL).y + LANDING * leg
  const air = (up + Math.sqrt(Math.max(0, up * up - 2 * GRAVITY * (touch - takeoff.y)))) / GRAVITY
  const lands = leaves + air
  const place = fall(air)
  const hips: Frame[] = [
    // (the drop and the push one movement: going on as he comes, he is pushed to how he leaves)
    { at: leaves - lasts, place: from.clone().addScaledVector(going, -lasts / 2).setY(ground + stand - crouch), velocity: going.clone().add(across).multiplyScalar(0.5), by: 'jump' },
    { at: leaves, place: takeoff, velocity, by: 'jump' },
  ]
  for (let k = 1; k < MARKS; k++) {
    const t = (air * k) / MARKS
    hips.push({ at: leaves + t, place: fall(t), velocity: velocity.clone().setY(up - GRAVITY * t), by: 'jump' })
  }
  hips.push({ at: lands, place: place.clone(), velocity: across.clone().setY(up - GRAVITY * air), by: 'jump' })
  const rest = Math.min(touch, ground + stand) - GIVE * crouch
  hips.push({ at: lands + lasts, place: place.clone().addScaledVector(across, lasts).setY(rest), velocity: across.clone(), by: 'jump' })
  // the feet leave with him, drawn up under him, and reach for the ground under where he lands: going on, the foot he
  // took off from comes down a step after the other
  const runs = across.length() > WALK.most * size.pace
  const feet = { left: [] as Frame[], right: [] as Frame[] }
  // (through the air the legs stay as far apart as they left the ground, drawn up under him: the foot he took off from behind)
  for (const side of SIDES) {
    const out = left(facing).multiplyScalar(SIGN[side] * size.hip)
    const split = runs ? (side === takes ? -APART : APART) * leg : 0
    const tucked = { x: SIGN[side] * size.hip, y: -(1 - TUCK) * leg, z: split }
    const later = runs && side === takes ? STEP : 0
    const down = place.clone().add(out).addScaledVector(across, 0.05 + later).setY(ground + ankle)
    // (the other knee drives up as he pushes off)
    const drives: Frame[] = side === takes ? [] : [{ at: leaves, on: hipsOf, place: { x: SIGN[side] * size.hip, y: -DRIVE.y * leg, z: DRIVE.z * leg }, by: "jump" }]
    feet[side] = [
      ...drives,
      { at: leaves + Math.min(UNTUCK, air / 3), leaves, on: hipsOf, place: tucked, by: 'jump' },
      ...(air > 3 * UNTUCK ? [{ at: lands - UNTUCK, on: hipsOf, place: tucked, by: 'jump' }] : []),
      { at: lands + later, place: down, by: 'jump' },
    ]
  }
  return { hips, feet, leaves, top: leaves + up / GRAVITY, lands, place: place.setY(ground), velocity: across.clone().setY(0), low: low ? rest - ground : undefined }
}
