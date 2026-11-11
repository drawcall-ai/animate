import { type Figure, planted, speed as speedOf } from './figure'
import { GRAVITY, push } from './physics'
import { BODY, LEG, SIZE, STAND } from './skeleton'
import { V, clamp } from './vec'

/** the most the ground pushes and brakes a figure through its legs (m/s²), and how hard a braced leg stops it (1/s) */
const PUSH = 4
const BRAKE = 12
const BLOCK = 4

/**
 * The forces of the ground on the hips through the planted legs: lift enough to ride at standing height, a push or a braking
 * toward the pace asked, and what a braced leg ahead stops. None of it without a foot down. Returns the push it gave (m/s²).
 */
export function ground(figure: Figure, dt: number) {
  const { hips } = figure
  const down = figure.legs.map((leg) => leg.foot).filter(planted)
  if (!down.length) return 0
  const speed = speedOf(figure)
  const under = down.reduce((a, b) => (Math.abs(a.p.x - hips.p.x) < Math.abs(b.p.x - hips.p.x) ? a : b))
  const dx = under.p.x - hips.p.x
  // a figure shedding its speed sinks into the foot it brakes on
  const sink = figure.pace === 0 && under.p.x > hips.p.x + 0.1 ? clamp(0.06 * speed, 0, 0.2) : 0
  const ride = Math.min(STAND, SIZE.ankle + Math.sqrt(Math.max(0.01, (LEG * 0.985) ** 2 - dx * dx))) - sink - under.give
  // a knee gives after its foot has landed, and straightens once the figure is only settling
  under.give += clamp((figure.settling === null ? under.giveTo : 0) - under.give, -dt * 0.4, dt * 0.5)
  push(hips, V(0, clamp(30000 * (ride - hips.p.y) - 2200 * hips.v.y + BODY * GRAVITY, 0, 4 * BODY * GRAVITY)))
  // a foot brakes the body only from ahead of it
  const ahead = down.some((foot) => foot.p.x > hips.p.x + 0.1)
  let a = clamp((figure.pace - speed) / 0.08, ahead ? -Math.min(BRAKE, 3 + 5 * Math.abs(speed)) : 0, PUSH)
  // standing on both feet, the hips come to rest between them
  if (figure.pace === 0 && Math.abs(speed) < 0.6 && down.length === 2) {
    a = clamp(14 * ((down[0].p.x + down[1].p.x) / 2 - hips.p.x) - 6 * speed, -2.5, 2.5)
  }
  if (down.some((foot) => foot.braced && foot.p.x > hips.p.x - 0.05)) a -= BLOCK * speed
  push(hips, V(BODY * a, 0))
  return a
}
