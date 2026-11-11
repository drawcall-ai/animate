import { type Actor, STEP, V, deg, leaning } from 'animate-2d'
import { run } from '../stage'
import { FOUL_LINE, type Field, JAVELIN, end, fly } from './field'
import { javelinThrow, thrower } from './throw'

let actor: Actor<Field>

run({
  begin() {
    actor = thrower()
    actor.play(javelinThrow(actor))
  },
  tick() {
    actor.update(STEP)
    fly(actor.world.javelin, STEP)
  },
  draw(view) {
    const { figure, world } = actor
    const { javelin, released } = world
    view.begin(figure.hips.p.x - 3, figure.hips.p.x + 3.6)
    view.line([V(FOUL_LINE, 0), V(FOUL_LINE, 0.12)], 0.03, 0.6)
    view.line([end(javelin, -JAVELIN.behind), end(javelin, JAVELIN.ahead)], 0.02, 0.7)
    view.figure(figure)
    const speed = released ? Math.hypot(released.velocity.x, released.velocity.y) : null
    return [
      `release   ${released && speed ? `${speed.toFixed(1)} m/s, ${deg(Math.atan2(released.velocity.y, released.velocity.x)).toFixed(1)}° up, at ${released.time.toFixed(2)} s` : '…'}`,
      `thrown    ${javelin.stuck ? `${(end(javelin, JAVELIN.ahead).x - FOUL_LINE).toFixed(1)} m past the line (no air)` : '…'}`,
      `trunk     ${leaning(figure).toFixed(0)}° forward`,
      `story     ${actor.playing ? 'playing' : 'over'}`,
    ].join('\n')
  },
})
