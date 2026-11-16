import { Vector3 } from 'three'
import { ahead, angleOf, clamp, damped, RUN, SIDES, type Side, type Size, SLOW, twist, WALK, wrap } from './measure'
import type { Going } from './stride'

/** how long being led faster goes on as it is, dying away (in beats) */
const SPEEDS = 0.75
/** how long his pelvis takes to come round to the way he is to face (in beats), and how far off it it no longer turns with the way he goes (rad) */
const FOLLOW = { pelvis: 1.6, near: 0.5 }
/** how near the way he is to face counts as facing it (rad) */
const THERE = 0.02

/**
 * Where he is led, and how he faces: the way along the ground he is to go (m/s), how fast that is speeding up and
 * turning, read from how it changes from one lead to the next, so that where he will be is told as he will really be;
 * where the world has him, if it says; and the way he is to face, if he is to. His pelvis comes round to face like a
 * thing with weight, no further over a foot on the ground than a hip turns on it.
 */
export class Lead {
  readonly velocity = new Vector3()
  /** how fast he is led faster (m/s²), and the way he is led turns (rad/s), and the way he is to face (rad/s) */
  readonly faster = new Vector3()
  turns = 0
  swings = 0
  /** where on the ground he is led to be now: the world's place, or where the lead has carried him */
  readonly place = new Vector3()
  /** which way he is to face, if he is to, and which way he faces (rad about y from +z toward +x), and how fast he turns */
  face?: number
  facing = 0
  spins = 0
  private told = { velocity: new Vector3(), at: -1, face: undefined as number | undefined }

  constructor(private readonly size: Size) {}

  /** he is led going so from `now`: how it changed since the last lead is how it goes on changing */
  go(velocity: { x: number; z: number }, now: number) {
    const { told } = this
    const dt = now - told.at
    this.velocity.set(velocity.x, 0, velocity.z)
    if (dt > 1e-6 && dt < 0.8 * this.size.beat) {
      this.faster.subVectors(this.velocity, told.velocity).divideScalar(dt)
      const [was, is] = [told.velocity.length(), this.velocity.length()]
      this.turns = was > SLOW * this.size.pace && is > SLOW * this.size.pace ? wrap(angleOf(velocity.x, velocity.z) - angleOf(told.velocity.x, told.velocity.z)) / dt : 0
      if (told.face !== undefined && this.face !== undefined) this.swings = wrap(this.face - told.face) / dt
    }
    told.velocity.copy(this.velocity)
    told.face = this.face
    told.at = now
  }

  /** the way he is to go, turned as it turns, and how fast along it, speeding up as he is led to, after so long */
  private heading(seconds: number) {
    const speed = this.velocity.length()
    return angleOf(this.velocity.x, this.velocity.z) + (speed > SLOW * this.size.pace ? this.turns * seconds : 0)
  }

  /** where on the ground he will be in so long, led on as he is: the speeding up dying away, the way turning as it turns */
  at(seconds: number, to = new Vector3()) {
    const speed = this.velocity.length()
    const way = ahead(angleOf(this.velocity.x, this.velocity.z))
    const lasts = SPEEDS * this.size.beat
    const mean = speed + this.faster.dot(way) * lasts * (1 - (lasts / Math.max(seconds, 1e-6)) * (1 - Math.exp(-seconds / lasts)))
    const going = clamp(mean, 0, RUN * this.size.pace)
    const curves = speed > SLOW * this.size.pace ? this.turns : 0
    const heading = this.heading(0)
    if (Math.abs(curves * seconds) < 1e-4) return to.copy(way).multiplyScalar(going * seconds).add(this.place)
    const r = going / curves
    const turned = heading + curves * seconds
    return to.set(r * (Math.cos(heading) - Math.cos(turned)), 0, r * (Math.sin(turned) - Math.sin(heading))).add(this.place)
  }

  /** how far off the way he goes he faces at the most going so fast (rad): facing it from as fast as he walks */
  private widest(going: number) {
    const fast = going / this.size.pace
    if (fast >= WALK.most) return THERE
    return Math.acos(Math.sqrt(clamp((fast - 0.5) / (WALK.most - 0.5), 0, 1)))
  }

  /**
   * A step of time: the lead goes on as it goes, and his pelvis comes round to where he is to face, as a game has him
   * at a walk, or the way he goes, backwards along it while that is more than a quarter turn from it. Tells the hips
   * as the strides need them, the feet that are down (and which way they point) holding his turning to what a hip turns.
   */
  advance(dt: number, toes: Partial<Record<Side, number>>): Going {
    const { size } = this
    const going = this.velocity.length()
    this.place.addScaledVector(this.velocity, dt)
    this.faster.multiplyScalar(Math.exp(-dt / (SPEEDS * size.beat)))
    const fast = going > WALK.most * size.pace
    const asked = fast ? undefined : this.face
    const led = going > SLOW * size.pace
    const heading = led ? this.heading(0) : this.facing
    const want = asked ?? (led ? heading : (this.face ?? this.facing))
    const backs = led && !fast && Math.cos(wrap(want - heading)) < -THERE
    const way = heading + (backs ? Math.PI : 0)
    const widest = backs ? Math.PI / 2 : this.widest(going)
    const off = wrap(way + clamp(wrap(want - way), -widest, widest) - this.facing)
    const pull = (2 * Math.PI) / (FOLLOW.pelvis * size.beat)
    // (slowing below a walk, he follows the turn of the way he goes the less, standing not at all)
    const slows = Math.min(1, going / (WALK.speed * size.pace))
    const along = (asked !== undefined ? this.swings : led ? this.turns * slows : 0) * Math.max(0, 1 - Math.abs(off) / FOLLOW.near)
    this.spins = along + damped(this.spins - along, off, pull, dt)
    // (no further round from a foot on the ground than a hip turns over it: his feet step round for him to come on)
    let round = this.spins * dt
    for (const side of SIDES) {
      const points = toes[side]
      if (points === undefined) continue
      const [least, most] = twist(side)
      const now = wrap(points - this.facing)
      const then = now - round
      round -= clamp(then, Math.min(least, now), Math.max(most, now)) - then
    }
    if (dt > 0) this.spins = round / dt
    this.facing = wrap(this.facing + round)
    return {
      at: this.place.clone(),
      speed: backs ? -going : going,
      // (backing, the way is turned round and the speed along it is less than none)
      faster: this.faster.dot(ahead(way)),
      heading: way,
      curves: led ? this.turns : 0,
      facing: this.facing,
      spins: this.spins,
      aims: wrap(want - this.facing),
    }
  }
}
