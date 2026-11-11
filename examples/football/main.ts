import { type Actor, STEP, V, leaning } from 'animate-2d'
import { run } from '../stage'
import { instep } from './kick'
import { GOAL, type Pitch, fly } from './pitch'
import { player, shot } from './shot'

let actor: Actor<Pitch>

run({
  begin() {
    actor = player()
    actor.play(shot(actor))
  },
  tick() {
    actor.update(STEP)
    fly(actor.world.ball, STEP)
  },
  draw(view) {
    const { figure, world } = actor
    const { ball, struck } = world
    view.begin(figure.hips.p.x - 2.6, figure.hips.p.x + 3.4)
    const post = ball.spot + GOAL.away
    view.line([V(post, 0), V(post, GOAL.high), V(post + GOAL.deep, GOAL.high * 0.55), V(post + GOAL.deep, 0)], 0.04, 0.6)
    view.dot(ball.p, ball.radius, 0.7)
    view.figure(figure)
    // the kicking foot, pointed
    const kicking = figure.legs.find((leg) => leg.driven)
    if (kicking) view.line([kicking.foot.p, instep(kicking).p], 0.05)
    return [
      `ball      ${struck ? `${struck.speed.toFixed(1)} m/s, ${struck.angle.toFixed(1)}° up, struck at ${struck.time.toFixed(2)} s by a foot going ${struck.foot.toFixed(1)} m/s` : '…'}`,
      `result    ${ball.result ?? '…'}`,
      `trunk     ${leaning(figure).toFixed(0)}° forward`,
      `story     ${actor.playing ? 'playing' : 'over'}`,
    ].join('\n')
  },
})
