import { type Leg, type Recipe, type Round, type Side, add, aim, between, clamp, deg, folded, len, meet, mul, pointing, rad, speed, sub, turning } from 'animate-2d'
import { type Pitch } from './pitch'

/** the hip pulls the thigh through and the knee snaps the shin straight, with these torques (N m) at power 1; until then the knee is held folded this far (degrees) */
const KICK = { hip: 60, knee: 45, fold: 105 }
/** how far beyond the ankle a pointed foot strikes (m) */
const INSTEP = 0.12
/** how high the middle of the instep rides over the ground at its lowest (m) */
const CLEAR = 0.085

export type Link = 'hip' | 'knee'

/** the instep of a pointed foot: a round thing beyond the ankle, along the shin, going as the shin's end goes there */
export function instep(leg: Leg): Round {
  const d = sub(leg.foot.p, leg.knee.p)
  const k = INSTEP / (len(d) || 1e-9)
  const p = add(leg.foot.p, mul(d, k))
  const v = add(leg.foot.v, mul(sub(leg.foot.v, leg.knee.v), k))
  // on the ground it slides, it does not go down
  if (p.y <= CLEAR + 0.005 && v.y < 0) v.y = 0
  return { p, v, kg: leg.foot.kg, radius: 0.06 }
}

/**
 * A kick with one leg. The hip pulls the thigh through; the knee stays folded, the shin trailing by its own weight, until
 * the thigh has come under the hips, then it is snapped straight. The instep meets the ball; the hip then catches the thigh
 * and the leg is the figure's own again.
 */
export const kick = (side: Side, links: Link[]): Recipe<Pitch> => (actor, power) => {
  const { figure, world } = actor
  const { hips, chest } = figure
  const leg = figure.legs[side === 'right' ? 0 : 1]
  figure.pace = speed(figure)
  figure.driving = true
  // the trunk braces hardest while the leg is driven: the hip that pulls the thigh through pulls the trunk down onto it
  figure.brace = 1 + 0.35 * power
  leg.driven = true
  leg.foot.held = false
  leg.foot.swing = null
  // the arms go wide against the leg: the far one forward, the near one back
  actor.arm(side === 'right' ? 'left' : 'right', [0, 8], { seconds: 0.14 })
  actor.arm(side, [-165, -157], { seconds: 0.14 })
  let t = 0
  let handBack: number | null = null
  return (dt) => {
    let over = handBack !== null
    if (!over) {
      t += dt
      const thigh = deg(pointing(hips, leg.knee))
      if (links.includes('hip')) between(chest, hips, leg.knee, KICK.hip * power)
      if (links.includes('knee')) {
        if (thigh < -105) aim(hips, leg.knee, leg.foot, pointing(hips, leg.knee) - rad(KICK.fold), { stiff: 90, damp: 5, most: 70 })
        else if (folded(hips, leg.knee, leg.foot) > 4) between(hips, leg.knee, leg.foot, KICK.knee * power)
      }
      over = thigh > -15 || t > 0.7
    } else {
      // the leg swings on, loosely folded, against the hip's brake
      aim(hips, leg.knee, leg.foot, pointing(hips, leg.knee) - rad(30), { stiff: 120, damp: 8, most: 60 })
      between(chest, hips, leg.knee, clamp(-30 * (turning(hips, leg.knee) - turning(hips, chest)), -260, 260))
    }
    // a pointed foot is kept off the ground by its instep
    const low = CLEAR - instep(leg).p.y
    if (low > 0) leg.foot.p.y += low
    if (!world.struck) {
      const tip = instep(leg)
      const before = tip.v
      if (meet(tip, world.ball, 0.6)) {
        leg.foot.v = add(leg.foot.v, sub(tip.v, before))
        const v = world.ball.v
        world.struck = { time: figure.time, speed: len(v), angle: deg(Math.atan2(v.y, v.x)), foot: len(before) }
        over = true
      }
    }
    if (over && handBack === null) {
      figure.driving = false
      figure.brace = 2
      figure.tone = 0.55
      handBack = figure.time + 0.1
    }
    if (handBack === null || figure.time <= handBack) return true
    leg.driven = false
    leg.foot.swing = { s: 0, travel: 0.9, from: leg.foot.p.x }
    figure.brace = 1
    return false
  }
}
