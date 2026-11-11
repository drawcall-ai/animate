import { Actor, type Story, arriving } from 'animate-2d'
import { kick } from './kick'
import { type Pitch, ballAt } from './pitch'

/** a player arriving at 3.6 m/s in a long last stride, the ball 1.2 m ahead of his rear foot */
export const player = () => new Actor<Pitch>({ figure: arriving(0, { speed: 3.6 }), world: { ball: ballAt(1.2), struck: null } })

export function* shot(player: Actor<Pitch>): Story {
  const { ball } = player.world

  // he leans back as he comes onto the ball
  player.trunk({ lean: -16 }, { seconds: 0.2 })

  // plant: the standing foot comes down beside the ball and bears him as he passes over it, the knee giving a little
  yield* player.step('left', { at: ball.p.x - 0.08, lands: 'firm', bend: 22 })

  // strike: hip, then knee, as hard as it takes for the ball to leave at 27 m/s
  yield* player.drive(kick('right', ['hip', 'knee']), { measure: (pitch) => pitch.struck?.speed ?? null, target: 27, powers: [0.4, 9] })

  yield* player.settle()
}
