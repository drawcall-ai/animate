import { KG, type Recipe, V, aim, between, deg, goal, leaning, pointing, rad, send, speed } from 'animate-2d'
import { type Field } from './field'

export type Link = 'hips' | 'shoulder' | 'elbow'

/**
 * Which links fire and how far into the drive each begins (seconds at power 1; a harder drive is quicker in proportion).
 * The hips lead by stopping: the trunk goes on over them, to `lean`. The shoulder then pulls the arm over the top with a
 * steady torque (N m), and the elbow, left loose until its turn so that the forearm lags by its own weight, is snapped straight.
 */
const CHAIN = { hips: { from: 0, lean: 16 }, shoulder: { from: 0.035, torque: 95 }, elbow: { from: 0.075 } }

/** An overarm throw with the right arm: what the hand holds leaves with the hand's own speed once that points no higher than `angle`. */
export const sling = (links: Link[], { angle }: { angle: number }): Recipe<Field> => (actor, power) => {
  const { figure, world } = actor
  const { hips, chest } = figure
  const { elbow, hand, upper, fold } = figure.arms[0]
  figure.pace = speed(figure)
  figure.driving = true
  figure.arms[0].driven = true
  actor.arm('left', [-115, -60], { seconds: 0.05 })
  let t = 0
  return (dt) => {
    t += dt
    const on = (link: Link) => links.includes(link) && t * Math.sqrt(power) >= CHAIN[link].from
    if (on('hips')) {
      figure.lean = goal(CHAIN.hips.lean)
      // the trunk braces against the arm that is pulled over it
      figure.brace = 1 + 0.35 * power
    }
    if (on('shoulder')) between(hips, chest, elbow, -CHAIN.shoulder.torque * power)
    else aim(hips, chest, elbow, rad(upper.value), { stiff: 420, damp: 34 })
    const snap = on('elbow')
    const loose = links.includes('elbow') && !snap
    aim(chest, elbow, hand, snap ? pointing(chest, elbow) : rad(upper.value + fold.value), {
      stiff: loose ? 25 : 190 * (snap ? 1 + 3 * power : 1),
      damp: loose ? 6 : 12 * (snap ? 1 + power : 1),
      most: 300,
    })
    // the arm comes from behind over the top: its angle counted from straight back, 180°, down to straight ahead, 0°
    const raw = pointing(chest, elbow)
    const arm = raw < -Math.PI / 2 ? raw + 2 * Math.PI : raw
    const going = Math.atan2(hand.v.y, hand.v.x)
    const flung = hand.p.y > chest.p.y + 0.1 && hand.v.x > 0 && arm < rad(150) && going <= rad(angle) && going > rad(angle - 45)
    if (on('shoulder') && (flung || arm < rad(20))) {
      world.released = { time: figure.time, velocity: V(hand.v.x, hand.v.y) }
      world.javelin.speed = V(hand.v.x, hand.v.y)
      world.javelin.angle = going
      hand.kg = KG.hand
    }
    if (!world.released && t < 0.7) return true
    // the throw is over: the muscles go slack and the body goes on with what speed it has.
    // The arm goes on the way it was going, long, forward and down: its aim is put ahead of it, never round behind.
    figure.driving = false
    figure.brace = 1
    figure.tone = 0.6
    for (const leg of figure.legs) leg.foot.braced = false
    figure.arms[0].driven = false
    figure.arms[0].upper = goal(Math.max(-45, deg(arm) - 165))
    figure.arms[0].fold = goal(8)
    figure.lean = goal(leaning(figure))
    send(figure.lean, 8, 1.2)
    return false
  }
}
