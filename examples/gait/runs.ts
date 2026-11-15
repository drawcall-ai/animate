import type { Story } from '@drawcall/animate'

type Flat = { x: number; z: number }
/** what a scripted run asks of a body: the same words today's body and the frame gait answer */
export type Runner = {
  readonly size: { stand: number; leg: number; hip: number }
  readonly time: number
  run(run: { speed: number; at: Flat; plant?: 'left' | 'right'; push?: number; arrive?: number }): unknown
  walk(to: Flat, way?: { speed?: number; plant?: 'left' | 'right' }): unknown
  jump(top: { x: number; y: number; z: number }): unknown
  when(place: Flat): number
  highest(): number
  stand(): unknown
  until(when: number): Story
}

/**
 * Scripted runs and walks, each a few words, to set the frame gait beside today's: a run-up planted beside a ball, a
 * walk to a spot, a bowler's approach onto a planted foot, hurdles cleared on the run, and a spiker's run-up and jump.
 */
export const RUNS: Record<string, (body: Runner) => Story> = {
  *kick(body) {
    yield* body.until(0.3)
    const at = { x: 0, z: 6 }
    body.run({ speed: 3.6, plant: 'left', at, arrive: 2.5 })
    yield* body.until(body.when(at) + 0.6)
    body.stand()
    yield* body.until(body.time + 2)
  },
  *walkto(body) {
    yield* body.until(0.3)
    body.walk({ x: 0, z: 3 })
    yield* body.until(body.time + 4)
    body.walk({ x: 0.4, z: 3.3 })
    yield* body.until(body.time + 2)
    body.walk({ x: 2, z: 1.5 })
    yield* body.until(body.time + 4)
  },
  *bowl(body) {
    yield* body.until(0.3)
    body.run({ speed: 2.2, at: { x: 0, z: 4 }, plant: 'left', arrive: 1 })
    yield* body.until(body.when({ x: 0, z: 4 }) + 0.4)
    body.stand()
    yield* body.until(body.time + 2)
  },
  *hurdles(body) {
    yield* body.until(0.3)
    const { stand } = body.size
    for (const z of [4, 8, 12]) {
      body.run({ speed: 6, at: { x: 0, z: z - 1.6 }, plant: 'left' })
      body.jump({ x: 0, y: stand + 0.35, z })
      yield* body.until(body.highest() + 0.3)
    }
    body.run({ speed: 6, at: { x: 0, z: 16 } })
    yield* body.until(body.when({ x: 0, z: 16 }))
    body.stand()
    yield* body.until(body.time + 2)
  },
  *spike(body) {
    yield* body.until(0.3)
    body.run({ speed: 3.5, at: { x: 0, z: 4 } })
    body.jump({ x: 0, y: body.size.stand + 0.6, z: 4.4 })
    yield* body.until(body.highest() + 1.2)
    body.stand()
    yield* body.until(body.time + 2)
  },
}
