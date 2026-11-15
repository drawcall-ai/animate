
type Flat = { x: number; z: number }
/** what a drill leads: a body, or anything led as one is */
export type Led = { go(velocity: Flat): unknown; face(way?: Flat): unknown; hips: { at(place: Flat & { y?: number }): void }; update(delta: number): void }
/** what a drill asks of a moment: how he is to go along the ground (m/s), and which way he is to face, if it says */
export type Ask = { velocity: Flat; face?: Flat }
/** a drill: how long it plays (s), and what it asks at each moment of it */
export type Drill = { seconds: number; ask(time: number): Ask }

/** how hard the game speeds him up or slows him down at the most, as a character controller does (m/s²) */
const PUSH = 10
const DEG = Math.PI / 180
const still: Flat = { x: 0, z: 0 }
const way = (angle: number): Flat => ({ x: Math.sin(angle), z: Math.cos(angle) })
const scaled = ({ x, z }: Flat, by: number): Flat => ({ x: x * by, z: z * by })

/** facing swept round at so many degrees a second, one way and then back, standing */
const spin = (rate: number): Drill => ({
  seconds: 7,
  ask: (t) => {
    const swept = t < 1 ? 0 : t < 3 ? (t - 1) * rate : t < 5 ? (2 - (t - 3)) * rate : 0
    return { velocity: still, face: way(swept * DEG) }
  },
})

/** going round a circle so large at so many m/s, to the left (1) or right (-1), getting up to speed first along it */
const circle = (radius: number, speed: number, turn: 1 | -1, seconds = 9): Drill => ({
  seconds,
  ask: (t) => {
    const fast = speed * Math.min(1, t / 1.2)
    const angle = (turn * Math.max(0, t - 0.6) * speed) / radius
    return { velocity: scaled(way(angle), t > seconds - 1.2 ? 0 : fast) }
  },
})

/**
 * The drills, each repeatable, as a game would lead him: fast turns where he stands, a run round a tight circle and a
 * wide one, a figure eight and a sudden reversal, starts and stops, and strafing and backing facing one way.
 */
export const DRILLS: Record<string, Drill> = {
  spin180: spin(180),
  spin360: spin(360),
  snap: {
    seconds: 7,
    ask: (t) => ({ velocity: still, face: way((t < 1 ? 0 : t < 2.5 ? 90 : t < 4 ? -90 : t < 5.5 ? 90 : 0) * DEG) }),
  },
  tight: circle(2.5, 5, 1),
  tightRight: circle(2.5, 5, -1),
  wide: circle(6, 5, 1),
  eight: {
    seconds: 10,
    ask: (t) => {
      // two circles of 3 m at 4 m/s, the second the other way round
      const [radius, speed] = [3, 4]
      const lap = (2 * Math.PI * radius) / speed
      const run = Math.max(0, t - 0.6)
      const angle = run < lap ? run / radius : (2 * lap - run) / radius
      return { velocity: scaled(way(angle * speed), t > 9 ? 0 : speed * Math.min(1, t / 1.2)) }
    },
  },
  reverse: {
    seconds: 8,
    ask: (t) => ({ velocity: t < 0.3 ? still : t < 2.5 ? { x: 0, z: 5 } : t < 5 ? { x: 0, z: -5 } : t < 6 ? { x: 5, z: 0 } : still }),
  },
  startstop: {
    seconds: 12,
    ask: (t) => {
      const speed = t < 0.5 ? 0 : t < 2.5 ? 1.5 : t < 3.5 ? 0 : t < 5.5 ? 5 : t < 7 ? 0 : t < 12 ? 1.5 + 3.5 * Math.max(0, Math.sin(((t - 7) / 4) * Math.PI)) : 0
      return { velocity: { x: 0, z: speed } }
    },
  },
  strafe: {
    seconds: 10,
    ask: (t) => {
      const go = t < 0.5 ? still : t < 2.5 ? { x: 1.5, z: 0 } : t < 4.5 ? { x: -1.5, z: 0 } : t < 6.5 ? { x: 0, z: -1.3 } : t < 8.5 ? scaled(way(135 * DEG), 1.4) : still
      return { velocity: go, face: { x: 0, z: 1 } }
    },
  },
}

/**
 * A drill played on a body, led by a plain place on the ground that goes as the drill asks, sped up and slowed down
 * no harder than a game would: nothing but the body is under test.
 */
export class Drive {
  readonly place = { x: 0, z: 0 }
  readonly velocity = { x: 0, z: 0 }
  time = 0

  constructor(
    private readonly body: Led,
    readonly drill: Drill,
  ) {}

  /** a frame of `delta` seconds: he is led for it, and the body updated */
  update(delta: number) {
    const { velocity, place, body } = this
    const ask = this.drill.ask(Math.min(this.time + delta, this.drill.seconds))
    const [dx, dz] = [ask.velocity.x - velocity.x, ask.velocity.z - velocity.z]
    const change = Math.hypot(dx, dz)
    const share = change > 0 ? Math.min(1, (PUSH * delta) / change) : 0
    velocity.x += dx * share
    velocity.z += dz * share
    place.x += velocity.x * delta
    place.z += velocity.z * delta
    this.time += delta
    body.go(velocity)
    body.face(ask.face)
    body.hips.at({ x: place.x, y: 0, z: place.z })
    body.update(delta)
  }
}
