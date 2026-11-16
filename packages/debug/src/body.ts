import { Color, type Vector3 } from 'three'
import type { Intent } from '@drawcall/animate'
import type { Labels } from './labels'
import type { Pen } from './pen'

/** a gap this wide is drawn red, a shorter one from green through yellow (m); and one narrower than so is not drawn */
const GAP = { red: 0.25, told: 0.01 }

/** a colour that warms with how wide a gap is */
export const warm = (gap: number, red = GAP.red) => new Color().setHSL(Math.max(0, 1 - gap / red) / 3, 1, 0.55)

/** the `body` layer: from where a hand's or a foot's plan has it to where the limb put it, a line warming with the gap and how many centimetres */
export function drawBody(pen: Pen, labels: Labels, { gaps }: Intent) {
  for (const { name, planned, posed } of gaps) {
    const far = planned.distanceTo(posed)
    if (far < GAP.told) continue
    const color = warm(far)
    pen.line(planned, posed, color)
    labels.say(middle(planned, posed), `${name.replace(/^left/, 'L').replace(/^right/, 'R')} ${Math.round(far * 100)} cm`, color)
  }
}

const middle = (from: Vector3, to: Vector3) => from.clone().lerp(to, 0.5)
