import type { Channel } from '@drawcall/plan'
import type { Gait } from '@drawcall/gait'
import type { Vector3 } from 'three'
import { drawGait } from './gait'
import { Pen } from './pen'
import { drawGaps, drawPlan } from './plan'

/** what a body tells of what it means to do, layer by layer */
export type Told = { channels: ReturnType<Channel['intent']>[]; gait: ReturnType<Gait['intent']>; gaps: { planned: Vector3; posed: Vector3 }[] }

/** each layer's own view, each shown on its own or all together: `?debug=plan,gait` or `?debug` for all */
export class Layers extends Pen {
  constructor(readonly shown = new Set(['plan', 'gait', 'body'])) {
    super()
  }

  draw(told: Told) {
    this.begin()
    if (this.shown.has('plan')) drawPlan(this, told.channels)
    if (this.shown.has('gait')) drawGait(this, told.gait)
    if (this.shown.has('body')) drawGaps(this, told.gaps)
    this.show()
  }
}
