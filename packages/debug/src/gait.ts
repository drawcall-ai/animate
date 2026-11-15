import type { Gait } from '@drawcall/gait'
import { Vector3 } from 'three'
import { type Pen, tint } from './pen'

const COLOR = { lead: tint(0xffe14d), hips: tint(0x80ff80), stands: tint(0x80ff80), lands: tint(0xffe14d), plant: tint(0xff40ff) }

/** the `gait` layer: the lead as an arrow on the ground, the hips' way ahead, where each foot stands and where it comes down next, the planted spot of a run, and the stride clock as a hand going round over his head */
export function drawGait(pen: Pen, { lead, phase, stepping, plant, feet, hips }: ReturnType<Gait['intent']>) {
  const ground = (at: Vector3) => at.clone().setY(0.01)
  const under = ground(hips[0])
  if (lead.lengthSq() > 0) pen.arrow(under, lead.clone().normalize(), 0.3 * lead.length(), COLOR.lead)
  pen.through(hips.map(ground), COLOR.hips)
  for (const foot of feet) {
    pen.square(ground(foot.stands), 0.05, COLOR.stands)
    if (foot.lands) pen.ring(ground(foot.lands), 0.04 + 0.04 / (1 + 4 * Math.max(0, foot.in ?? 0)), COLOR.lands)
  }
  if (plant) pen.diamond(ground(plant), 0.08, COLOR.plant)
  const clock = hips[0].clone().setY(2.1)
  pen.ring(clock, 0.1, COLOR.lead)
  if (stepping) pen.line(clock, clock.clone().add({ x: 0, y: 0.1 * Math.cos(2 * Math.PI * phase), z: 0.1 * Math.sin(2 * Math.PI * phase) }), COLOR.lead)
}
