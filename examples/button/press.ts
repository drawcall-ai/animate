import type { Body, Story } from 'animate-2d'
import { PANEL, type Panel } from './panel'

/** how far short of the button he comes to rest, and how long the finger stays on it (m, s) */
const SHORT = 0.4
const HELD = 0.3

/** He walks up to a panel, presses the button on it with the tip of his right index finger, the hand pointing, palm down, and lowers the hand. */
export function* press(body: Body, panel: Panel): Story {
  const hand = body.hand.right
  body.walk(panel.button.z - SHORT)
  hand.shape('point')
  // the fingertip is on the button, pushed in as far as it goes
  const { x, y, z } = panel.button
  yield* hand.to({ x, y, z: z + PANEL.travel }, { with: 'index', palm: { x: 0, y: -1, z: 0 } })
  panel.pressed = true
  yield* body.until(body.time + HELD)

  panel.pressed = false
  yield* body.stand()
}
