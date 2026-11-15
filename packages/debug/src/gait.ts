import type { Gait } from '@drawcall/gait'
import type { Vector3 } from 'three'
import { type Pen, tint } from './pen'

const COLOR = { lead: tint(0xffe14d), hips: tint(0x80ff80), stands: tint(0x80ff80), lands: tint(0xffe14d), plant: tint(0xff40ff), faces: tint(0xff8040) }
/** how long the lead's arrow is for every m/s (s), and how high over the ground the stride clock goes round (m) */
const ARROW = 0.3
const CLOCK = 2.1

/**
 * the `gait` layer: the lead as an arrow on the ground and the way he faces, the hips' way ahead, where each foot
 * stands and where it comes down next (a ring growing as it comes due), the planted spot of a run, and the stride clock
 * as a hand going round over his head, the left foot leaving the ground as it points ahead
 */
export function drawGait(pen: Pen, { lead, phase, stepping, plant, feet, hips, facing }: ReturnType<Gait['intent']>) {
  const ground = (at: Vector3) => at.clone().setY(0.01)
  const under = ground(hips[0])
  if (lead.lengthSq() > 0) pen.arrow(under, lead.clone().normalize(), ARROW * lead.length(), COLOR.lead)
  pen.arrow(under, under.clone().set(Math.sin(facing), 0, Math.cos(facing)), 0.25, COLOR.faces)
  pen.through(hips.map(ground), COLOR.hips)
  for (const foot of feet) {
    pen.square(ground(foot.stands), 0.05, COLOR.stands)
    if (foot.lands) pen.ring(ground(foot.lands), 0.04 + 0.04 / (1 + 4 * Math.max(0, foot.in ?? 0)), COLOR.lands)
  }
  if (plant) pen.diamond(ground(plant), 0.08, COLOR.plant)
  const clock = hips[0].clone().setY(CLOCK)
  pen.ring(clock, 0.1, COLOR.lead)
  const hand = clock.clone().add({ x: 0.1 * Math.sin(2 * Math.PI * phase + facing), y: 0, z: 0.1 * Math.cos(2 * Math.PI * phase + facing) })
  if (stepping) pen.line(clock, hand, COLOR.lead)
}
