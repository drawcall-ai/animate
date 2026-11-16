import { Group, type Object3D } from 'three'
import { Body } from '@drawcall/animate'
import { drawBody } from './body'
import { drawGait } from './gait'
import { Grips } from './hand'
import { Labels } from './labels'
import type { Layer } from './layers'
import { Pen } from './pen'
import { drawPlan } from './plan'

/**
 * What the bodies in a scene mean to do beside what they do, a layer at a time, each drawn from its own package's
 * intent: `plan` every channel's way and frames, `gait` the lead, the stride and the footfalls, `hand` the grips,
 * `body` how far each limb came from its plan. Add it to the scene: given a body it shows that one, given a scene or
 * a part of it every body made for a rig in it.
 */
export class Debug extends Group {
  private readonly pen = new Pen()
  private readonly labels = new Labels()
  private readonly grips: Grips
  /** the moment each body was last drawn at, so that it is drawn once a moment however often the scene is */
  private readonly drawn = new WeakMap<Body, number>()

  constructor(
    private readonly shows: Body | Object3D,
    readonly showing: Set<Layer>,
  ) {
    super()
    this.grips = new Grips(shows)
    this.add(this.pen, this.labels, this.grips)
  }

  override updateMatrixWorld(force?: boolean) {
    this.grips.visible = this.showing.has('hand')
    if (this.visible) this.draw()
    super.updateMatrixWorld(force)
  }

  private draw() {
    const found = bodies(this.shows)
    if (found.every((body) => this.drawn.get(body) === body.time)) return
    this.pen.begin()
    this.labels.begin()
    for (const body of found) {
      this.drawn.set(body, body.time)
      const told = body.intent()
      if (this.showing.has('plan')) drawPlan(this.pen, told.channels)
      if (this.showing.has('gait')) drawGait(this.pen, body.gait.intent())
      if (this.showing.has('body')) drawBody(this.pen, this.labels, told)
    }
    this.pen.show()
    this.labels.show()
  }
}

/** the bodies a body, or a scene or a part of it, has: one, or every one made for a rig in it */
export function bodies(shows: Body | Object3D) {
  if (shows instanceof Body) return [shows]
  const found: Body[] = []
  shows.traverse((part) => {
    const body = Body.of(part)
    if (body) found.push(body)
  })
  return found
}
