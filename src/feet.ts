import { type Figure, type Foot, planted, speed as speedOf } from './figure'
import { GRAVITY, push } from './physics'
import { LEG, SIZE } from './skeleton'
import { V, add, len, lerp, mul, rad, smooth, sub } from './vec'

/** how far behind the hips a foot may be left, how far ahead of them it lands, and how far the body travels while it swings (m), at a speed */
const stride = (speed: number) => ({ back: 0.2 + 0.06 * speed, lead: 0.12 + 0.07 * speed, swing: 0.55 + 0.2 * speed })
/** how long a catching step takes (s) */
const CATCH = 0.26
/** how fast a standing body tips over (1/s): its speed divided by this is how much further it will carry */
const TIP = Math.sqrt(GRAVITY / 0.9)

/**
 * The step rule, for a figure that has gone `dx` on. A foot left behind, or one whose leg is at full stretch, is lifted;
 * a lifted one is brought to where it comes down and planted there. Returns the foot that landed, if one did.
 */
export function stepFeet(figure: Figure, dx: number, dt: number) {
  const { hips, chest } = figure
  const speed = Math.max(0, speedOf(figure))
  const s = stride(speed)
  let landed: Foot | null = null
  figure.legs.forEach((leg, k) => {
    if (leg.driven) return
    const foot = leg.foot
    const other = figure.legs[1 - k].foot
    const otherLanding = other.swing !== null && other.swing.s > 0.8
    if (planted(foot)) {
      // lifted only once the other is down or all but down
      const free = planted(other) || (otherLanding && !other.named)
      const behind = speed > 0.25 && hips.p.x - foot.p.x > s.back && !figure.driving
      const wide = figure.pace === 0 && speed < 0.25 && planted(other) && other.p.x - foot.p.x > 0.5
      const stretched = len(sub(foot.p, hips.p)) > LEG * 0.992 && hips.p.x > foot.p.x + 0.15
      const taut = stretched && (planted(other) || other.named !== null || otherLanding)
      if ((free && (behind || wide)) || taut) {
        foot.swing = { s: 0, travel: s.swing, from: foot.p.x }
        foot.held = false
        foot.braced = false
      }
      return
    }
    const w = foot.swing
    if (w === null) return
    const catching = speed > 0.8 && figure.pace === 0
    // while the other foot is on its way to a named place this one trails behind, heel up: nothing is asked of it yet
    const trailing = other.named !== null
    if (!trailing) w.s = Math.min(1, w.s + (catching ? dt / CATCH : dx / w.travel + dt / 0.45))
    const reach = Math.sqrt(Math.max(0.01, LEG * LEG - Math.min(hips.p.y - SIZE.ankle, 0.72) ** 2))
    // where it comes down: where the story said; the spot it is committed to, as far as the leg still reaches it;
    // beside the other foot, standing; where the body's speed is carrying it, if it is to be caught; else ahead of the hips
    const spot = foot.named
      ? foot.named.at
      : w.spot !== undefined
        ? Math.min(w.spot, hips.p.x + reach)
        : speed < 0.25
          ? other.p.x + (foot.p.x > other.p.x ? 0.3 : -0.22)
          : hips.p.x + Math.min(reach, catching ? speed / TIP + 0.12 : (1 - w.s) * w.travel + s.lead)
    const to = trailing
      ? V(hips.p.x - 0.5, SIZE.ankle + 0.2)
      : V(lerp(w.from, spot, catching ? w.s * (2 - w.s) : smooth(w.s)), SIZE.ankle + (0.09 + 0.02 * speed) * Math.sin(Math.PI * w.s))
    if (trailing) w.from = foot.p.x
    else if (w.s > 0.6 && !foot.named && w.spot === undefined) w.spot = spot
    // the leg brings the foot there, and the foot pulls back on the trunk as a whole
    let pull = add(mul(sub(to, foot.p), 6000), mul(sub(foot.v, hips.v), -280))
    if (len(pull) > 1400) pull = mul(pull, 1400 / len(pull))
    const back = V(-pull.x, -pull.y - foot.kg * GRAVITY)
    const share = hips.kg / (hips.kg + chest.kg)
    push(foot, V(pull.x, pull.y + foot.kg * GRAVITY))
    push(hips, mul(back, share))
    push(chest, mul(back, 1 - share))
    // it is planted when it has come down within the leg's reach, not when its time is up
    if (w.s > 0.92 && foot.p.y <= SIZE.ankle + 0.02 && len(sub(foot.p, hips.p)) < LEG) {
      foot.p.y = SIZE.ankle
      foot.held = true
      foot.swing = null
      foot.braced = foot.named?.lands === 'braced'
      foot.give = 0
      foot.giveTo = LEG * (1 - Math.cos(rad((foot.named?.bend ?? 0) / 2)))
      foot.named = null
      landed = foot
    }
  })
  return landed
}
