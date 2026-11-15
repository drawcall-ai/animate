import type { Channel } from '@drawcall/plan'
import { type Pen, tint } from './pen'

const COLOR = { path: tint(0x40c0ff), frame: tint(0xffffff), velocity: tint(0xff8040), dropped: tint(0x505050) }
/** how long a velocity arrow is for every m/s (s) */
const ARROW = 0.05

/** the `plan` layer: each channel's way ahead, its frames (a diamond, larger the sooner it is due) with how fast they arrive, and frames cancelled fading out */
export function drawPlan(pen: Pen, channels: ReturnType<Channel['intent']>[]) {
  for (const { path, frames, dropped } of channels) {
    pen.through(path, COLOR.path)
    for (const frame of frames) {
      pen.diamond(frame.place, 0.02 + 0.03 / (1 + 4 * Math.max(0, frame.in)), COLOR.frame)
      if (frame.velocity.lengthSq() > 0) pen.arrow(frame.place, frame.velocity.clone().normalize(), ARROW * frame.velocity.length(), COLOR.velocity)
    }
    for (const frame of dropped) pen.diamond(frame.place, 0.03 * (1 - frame.ago), COLOR.dropped)
  }
}
