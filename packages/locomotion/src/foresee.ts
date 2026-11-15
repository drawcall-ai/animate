import { Vector3 } from 'three'
import { type Mark, type Side, SIDES, tick } from '@drawcall/limbs'
import type { Mover } from './mover'

/**
 * where a foot the body steps with is to come down and when, whether the story put it there, and whether it `swings`
 * there now, aimed by the steps, or is foreseen to step there later
 */
export type Footfall = Mark & { side: Side; put: boolean; swings: boolean }

/**
 * What the hips and the feet are to do, as far as is foreseen, for whoever looks: where the hips are and will be, a
 * mark a tick apart; where they are sent to rest, if they are; the footfalls on the way, in the order they come; the
 * top of a jump, the one asked for and the one he comes to; which way he faces (rad about y), is coming round to face and goes;
 * and led, the velocity he is led at along the ground.
 */
export type Foreseen = {
  hips: Mark[]
  to?: Vector3
  footfalls: Footfall[]
  top?: { asked?: Vector3; comes?: Mark }
  facing: number
  face: number
  heading: number
  led?: Vector3
}

/**
 * he as he is to go for so many `seconds` on, from a copy of his hips and feet stepped on ahead, which costs only when
 * asked and changes nothing of him: led, he is led on as he is now
 */
export function foresee(mover: Mover, seconds: number): Foreseen {
  const dt = tick(mover.size)
  const copy = mover.clone()
  const scene = (place: Vector3, side?: Side) => copy.scene(place.clone(), side)
  const now = (place: Vector3, side?: Side) => mover.scene(place.clone(), side)
  const hips: Mark[] = [{ at: scene(copy.value), time: copy.time }]
  // (a foot on its way down comes down where the steps aim it now: the copy, led on as he is, aims it anew)
  const footfalls: Footfall[] = SIDES.flatMap((side) => {
    const { step, put } = mover.foot[side]
    return step ? [{ at: now(step.to, side), time: mover.time + step.remains, side, put: put !== undefined, swings: true }] : []
  })
  const aimed = SIDES.map((side) => mover.foot[side].step !== undefined)
  const was = SIDES.map((side) => copy.foot[side].down)
  let top: Mark | undefined
  let rose = copy.spring !== undefined || copy.velocity.y > 0
  for (let gone = 0; gone < seconds; gone += dt) {
    copy.advance(dt)
    hips.push({ at: scene(copy.value), time: copy.time })
    SIDES.forEach((side, k) => {
      const { down, at, put } = copy.foot[side]
      if (down && !was[k] && aimed[k]) aimed[k] = false
      else if (down && !was[k]) footfalls.push({ at: scene(at, side), time: copy.time, side, put: put !== undefined, swings: false })
      was[k] = down
    })
    // (highest as he stops rising in the air)
    if (!top && rose && copy.falls && copy.velocity.y <= 0 && !copy.spring) top = hips[hips.length - 2]
    rose = copy.spring !== undefined || copy.velocity.y > 0
  }
  const { course, spring } = mover
  const to = course.z === undefined || course.heading !== undefined ? undefined : scene(new Vector3(course.x, course.y, course.z))
  const asked = spring && scene(spring.top)
  const led = course.heading === undefined ? undefined : new Vector3(Math.sin(course.heading), 0, Math.cos(course.heading)).multiplyScalar(course.speed)
  return {
    hips,
    to,
    footfalls: footfalls.sort((one, other) => one.time - other.time),
    top: asked || (top && mover.jumps) ? { asked, comes: top } : undefined,
    facing: mover.facing,
    face: mover.facing + mover.aims,
    heading: mover.heading,
    led,
  }
}
