import { Vector3 } from 'three'
import { angleOf, PUSH, type Size, wrap } from './measure'

/** the step a course is told in (s), and how long it is told at the most (s) */
const STEP = 1 / 60
const LONGEST = 20
/** how long the hips take over the last of their way to rest (in beats) */
const SETTLE = 0.835
/** how near a place counts as there (in legs), and how slow as still (m/s) */
const THERE = 0.0114
const STILL = 0.05

/** a way to go to a place: as fast as `speed`, sped up so hard (m/s²), arriving there so fast (none: to rest) */
export type Way = { speed: number; push: number; arrive: number }

/**
 * Where the hips will be, a step at a time, going from a place and a velocity to another place: turned toward it as
 * hard as the ground pushes him round, sped up no harder than `push`, kept to `speed`, and braked as hard as a leg
 * pushes to arrive as fast as asked; to rest, the last of the way ever slower. Past it still going, it goes on so.
 * Told once, it is where he will be: the gait is led along it, and it tells when he comes by a place.
 */
export class Course {
  readonly places: Vector3[] = []
  /** when he comes by the place, or is at rest there */
  arrives = Infinity

  constructor(
    size: Size,
    readonly from: number,
    place: Vector3,
    velocity: Vector3,
    readonly to: Vector3,
    readonly way: Way,
  ) {
    const p = place.clone().setY(0)
    const v = velocity.clone().setY(0)
    const settle = SETTLE * size.beat
    let past = false
    this.places.push(p.clone())
    for (let k = 1; k * STEP < LONGEST; k++) {
      const gap = to.clone().setY(0).sub(p)
      const far = gap.length()
      const speed = v.length()
      past ||= far < THERE * size.leg || (speed > STILL && gap.dot(v) < 0 && far < speed * STEP * 2)
      if (past && this.arrives === Infinity) this.arrives = from + k * STEP
      if (past && way.arrive === 0) break
      // (turned toward it no faster than the ground pushes him round, at once from a stand)
      const heading = speed > STILL ? angleOf(v.x, v.z) : angleOf(gap.x, gap.z)
      const turn = past ? 0 : wrap(angleOf(gap.x, gap.z) - heading)
      const most = speed > STILL ? (PUSH.along / speed) * STEP : Math.PI
      const turned = heading + Math.max(-most, Math.min(most, turn))
      const brakes = Math.sqrt(way.arrive ** 2 + 2 * PUSH.along * far)
      const want = past ? way.arrive : Math.min(way.speed, brakes, way.arrive > 0 ? Infinity : far / settle)
      const next = speed + Math.max(-PUSH.along * STEP, Math.min((want > speed ? way.push : PUSH.along) * STEP, want - speed))
      v.set(Math.sin(turned), 0, Math.cos(turned)).multiplyScalar(Math.max(0, next))
      p.addScaledVector(v, STEP)
      this.places.push(p.clone())
      if (past && k * STEP > this.arrives - from + 1) break
    }
  }

  /** where on the ground he is at a moment, and how fast he goes there */
  at(time: number, to = new Vector3()) {
    const s = Math.max(0, (time - this.from) / STEP)
    const k = Math.min(Math.floor(s), this.places.length - 1)
    const [a, b] = [this.places[k], this.places[Math.min(k + 1, this.places.length - 1)]]
    return to.lerpVectors(a, b, Math.min(1, s - k))
  }

  velocity(time: number, to = new Vector3()) {
    const later = this.at(time + STEP)
    return to.copy(later).sub(this.at(time)).divideScalar(STEP)
  }

  /** whether it is over by a moment: he is at rest there, or has gone past it as far as it tells */
  over(time: number) {
    return time - this.from >= (this.places.length - 1) * STEP
  }

  /** the moment he comes nearest a place */
  when(place: { x: number; z: number }) {
    let best = 0
    this.places.forEach((at, k) => {
      if (Math.hypot(at.x - place.x, at.z - place.z) < Math.hypot(this.places[best].x - place.x, this.places[best].z - place.z)) best = k
    })
    return this.from + best * STEP
  }
}
