import { Color, Group, type Object3D, Vector3 } from 'three'
import { Body, type Intent as Told, type Side } from '@drawcall/animate'
import { Labels } from './labels'
import { Memory } from './memory'
import { Pen } from './pen'
import { drawPlan } from './plan'

/** the colour of each part */
export const HUES = {
  'left hand': 0x4fc3ff,
  'right hand': 0xff9f43,
  'left foot': 0x5be37a,
  'right foot': 0xff5cc8,
  hips: 0xffe14d,
  thing: 0xffffff,
} as const
/** a gap this wide is drawn red, a shorter one from green through yellow (m); and one narrower than so is not told in numbers */
const GAP = { red: 0.25, told: 0.03 }
/** how large the marks are (m) */
const MARK = { goal: 0.035, fall: 0.07, arrow: 0.6 }
/** the way he is led is drawn as far as he goes in so long (s) */
const LED = 0.5

const hue = (name: keyof typeof HUES) => new Color(HUES[name])
/** a colour that warms with how wide a gap is */
export const warm = (gap: number, red = GAP.red) => new Color().setHSL(Math.max(0, 1 - gap / red) / 3, 1, 0.55)
const cm = (gap: number) => `${Math.round(gap * 100)} cm`
const soon = (seconds: number) => `${seconds.toFixed(2)}s`
/** a part's name, short: `L hand` */
const short = (name: string) => name.replace(/^left/, 'L').replace(/^right/, 'R')
const middle = (from: Vector3, to: Vector3) => from.clone().lerp(to, 0.5)

/**
 * What the bodies in a scene mean to do, drawn over it each frame as the scene is drawn, beside what they do: the
 * plan layer of every hand, foot and thing a story has (its way ahead and its frames), a line warming with the gap
 * from where a plan has a limb to where the limb could put it; the footfalls foreseen (rings, a square for one put by
 * a story, fainter while not yet aimed); the hips' way, where they are sent, the top of a jump asked for and the one he
 * comes to, which way he faces, is coming round to face, and is led. Add it to the scene, not to anything that moves:
 * given a body, it shows that one, given a scene or a part of it, every body made for a rig in it.
 */
export class Intent extends Group {
  private readonly pen = new Pen()
  private readonly labels = new Labels()
  private readonly memories = new WeakMap<Body, Memory>()
  /** the moment each body was last drawn at, so that it is drawn once a moment however often the scene is */
  private readonly drawn = new WeakMap<Body, number>()

  constructor(private readonly shows: Body | Object3D) {
    super()
    this.add(this.pen, this.labels)
  }

  override updateMatrixWorld(force?: boolean) {
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
      const memory = this.memories.get(body) ?? new Memory()
      this.memories.set(body, memory)
      this.body(body.intent(), memory)
    }
    this.pen.show()
    this.labels.show()
  }

  private body(told: Told, memory: Memory) {
    // what each hand, foot and thing the story has is to do, as its channel plans it
    drawPlan(this.pen, told.channels)
    for (const { name, planned, posed } of told.gaps) if (planned.distanceTo(posed) >= GAP.told) this.gap(planned, posed, `${short(name)} `)
    for (const side of ['left', 'right'] as const) this.steps(told, side)
    this.hips(told, memory)
  }

  /** a line between where something was meant to be and where it is, warming with the gap, and how wide it is if that tells */
  private gap(meant: Vector3, is: Vector3, said = '') {
    const far = meant.distanceTo(is)
    const color = warm(far)
    this.pen.line(meant, is, color)
    if (far >= GAP.told) this.labels.say(middle(meant, is), said + cm(far), color)
  }

  /** the footfalls foreseen for a foot the body steps with */
  private steps({ time, hips }: Told, side: Side) {
    const color = hue(side === 'left' ? 'left foot' : 'right foot')
    hips.footfalls
      .filter((fall) => fall.side === side)
      .forEach((fall, k) => {
        // (one foreseen later, not yet aimed, is drawn fainter)
        const shade = fall.swings ? color : color.clone().multiplyScalar(0.55)
        if (fall.put) this.pen.square(fall.at, MARK.fall, shade)
        else this.pen.ring(fall.at, MARK.fall, shade)
        if (k === 0) this.labels.say(fall.at, soon(fall.time - time), color)
      })
  }

  private hips(told: Told, memory: Memory) {
    const { pen, labels } = this
    const { hips, time } = told
    const color = hue('hips')
    pen.dot(hips.at, color)
    pen.through(
      hips.hips.map(({ at }) => at),
      color,
    )
    hips.hips.forEach(({ at, time: then }, k) => {
      if (k > 0 && Math.floor(then / 0.25) !== Math.floor(hips.hips[k - 1].time / 0.25)) pen.dot(at, color)
    })
    const foreseen = memory.foreseen(hips.hips, time)
    if (foreseen) this.gap(foreseen, hips.at, 'hips off foresight ')
    // the ways he faces and is led, on the ground under him
    const ground = Math.min(hips.at.y, ...hips.footfalls.map(({ at }) => at.y)) - 0.05
    const under = hips.at.clone().setY(ground)
    const way = (angle: number) => new Vector3(Math.sin(angle), 0, Math.cos(angle))
    pen.arrow(under, way(hips.facing), MARK.arrow, color)
    if (Math.abs(Math.sin((hips.face - hips.facing) / 2)) > 0.04) {
      pen.arrow(under, way(hips.face), MARK.arrow * 0.8, color.clone().lerp(new Color(0xffffff), 0.6))
      labels.say(under.clone().addScaledVector(way(hips.face), MARK.arrow * 0.8), 'to face', color)
    }
    if (hips.led && hips.led.length() > 0.05) {
      const led = new Color(0xffffff)
      pen.arrow(under, hips.led, hips.led.length() * LED, led)
      labels.say(under.clone().addScaledVector(hips.led, LED), 'led', led)
    }
    if (hips.to && hips.to.distanceTo(hips.at.clone().setY(hips.to.y)) > 0.1) {
      const to = hips.to.clone().setY(ground)
      pen.square(to, MARK.fall, color)
      labels.say(to, 'hips to', color)
    }
    const { asked, comes } = hips.top ?? {}
    if (asked) {
      pen.diamond(asked, MARK.goal * 1.5, color)
      labels.say(asked, 'top asked', color)
    }
    if (comes) {
      pen.dot(comes.at, color)
      labels.say(comes.at, `top ${soon(comes.time - time)}`, color)
      if (asked) this.gap(asked, comes.at, 'top ')
    }
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
