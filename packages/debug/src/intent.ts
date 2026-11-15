import { Box3, Color, Group, Matrix4, Mesh, type Object3D, Vector3 } from 'three'
import { Body, type Intent as Told, type Meant, type Side } from '@drawcall/animate'
import { Labels } from './labels'
import { Memory } from './memory'
import { Pen } from './pen'

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
/** a way an end arrives moving is drawn as far as it goes in so long (s) */
const ARRIVES = 0.04
/** the way he is led is drawn as far as he goes in so long (s) */
const LED = 0.5

const hue = (name: keyof typeof HUES) => new Color(HUES[name])
/** a colour that warms with how wide a gap is */
export const warm = (gap: number) => new Color().setHSL(Math.max(0, 1 - gap / GAP.red) / 3, 1, 0.55)
const cm = (gap: number) => `${Math.round(gap * 100)} cm`
const soon = (seconds: number) => `${seconds.toFixed(2)}s`
/** a part's name, short: `L hand` */
const short = (name: string) => name.replace(/^left/, 'L').replace(/^right/, 'R')
const middle = (from: Vector3, to: Vector3) => from.clone().lerp(to, 0.5)

/**
 * What the bodies in a scene mean to do, drawn over it each frame as the scene is drawn, beside what they do: where
 * each hand and foot a story has is to be and when (a diamond, the seconds until), the way its joints are driven
 * there, where the plan as first made has it now (a line to it from where it is, warming with the gap), and what came
 * of each moment (a miss shown for a while); the footfalls foreseen (rings, a square for one put by a story, fainter
 * while not yet aimed) and how far each came down from where it was aimed as the foot left the ground; the hips' way, where they are sent, the top of a jump asked
 * for and the one he comes to, which way he faces, is coming round to face, and is led; and a box where each thing
 * he holds is meant to be. Add it to the scene, not to anything that moves: given a body, it shows that one, given a
 * scene or a part of it, every body made for a rig in it.
 */
export class Intent extends Group {
  private readonly pen = new Pen()
  private readonly labels = new Labels()
  private readonly memories = new WeakMap<Body, Memory>()
  private readonly boxes = new WeakMap<Object3D, Box3>()
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

  private bodies() {
    const { shows } = this
    if (shows instanceof Body) return [shows]
    const found: Body[] = []
    shows.traverse((part) => {
      const body = Body.of(part)
      if (body) found.push(body)
    })
    return found
  }

  private draw() {
    const bodies = this.bodies()
    if (bodies.every((body) => this.drawn.get(body) === body.time)) return
    this.pen.begin()
    this.labels.begin()
    for (const body of bodies) {
      this.drawn.set(body, body.time)
      const memory = this.memories.get(body) ?? new Memory()
      this.memories.set(body, memory)
      this.body(body.intent(), memory)
    }
    this.pen.show()
    this.labels.show()
  }

  private body(told: Told, memory: Memory) {
    for (const side of ['left', 'right'] as const) {
      this.end(told, told.hand[side], `${side} hand`, memory)
      const foot = told.foot[side]
      if (foot.held) this.end(told, foot, `${side} foot`, memory)
      else this.steps(told, side, memory)
    }
    this.hips(told, memory)
    for (const { thing, at, time } of told.things) this.thing(thing, at, time - told.time)
    for (const { name, meant, was } of memory.misses) this.gap(meant, was, `${name} missed `)
  }

  /** a line between where something was meant to be and where it is, warming with the gap, and how wide it is if that tells */
  private gap(meant: Vector3, is: Vector3, said = '') {
    const far = meant.distanceTo(is)
    const color = warm(far)
    this.pen.line(meant, is, color)
    if (far >= GAP.told) this.labels.say(middle(meant, is), said + cm(far), color)
  }

  private end({ time }: Told, end: Meant, name: 'left hand' | 'right hand' | 'left foot' | 'right foot', memory: Memory) {
    const color = hue(name)
    const { pen, labels } = this
    // (what it is sent with, a fingertip or what sits in the hand, as far from the wrist as it is now)
    const offset = memory.tip(name, end.tip, end.sent.length > 0)
    const tip = end.at.clone().add(offset)
    pen.dot(tip, color)
    const path = end.path.map(({ at, time }) => ({ at: at.clone().add(end.tip), time }))
    pen.through(
      path.map(({ at }) => at),
      color,
    )
    end.sent.forEach((sent, k) => {
      const due = sent.time - time
      pen.diamond(sent.at, MARK.goal, sent.there === false ? warm(GAP.red) : color)
      if (sent.velocity.lengthSq() > 0) pen.line(sent.at, sent.at.clone().addScaledVector(sent.velocity, ARRIVES), color)
      const far = sent.short?.by === 'reach' ? sent.short.far : undefined
      // (out of reach by no number: no plan was found, and it goes after it as near as it comes)
      const reach = far === undefined ? '' : Number.isFinite(far) ? ` short ${cm(far)}` : ' no plan'
      const short = reach || (sent.short ? ` ${sent.short.by}` : '')
      if (due > 0 && k < 2) labels.say(sent.at, soon(due) + short, color)
    })
    const [first] = end.sent
    const planned = first && memory.planned(name, first.time, path, time)
    if (planned) this.gap(planned, tip, `${short(name)} `)
    memory.due(short(name), time, tip, first)
  }

  /** the footfalls foreseen for a foot the body steps with, and the way to the next */
  private steps({ time, foot, hips }: Told, side: Side, memory: Memory) {
    const name = side === 'left' ? 'left foot' : 'right foot'
    const color = hue(name)
    const falls = hips.footfalls.filter((fall) => fall.side === side)
    const at = foot[side].at
    this.pen.dot(at, color)
    falls.forEach((fall, k) => {
      // (one foreseen later, not yet aimed, is drawn fainter)
      const shade = fall.swings ? color : color.clone().multiplyScalar(0.55)
      if (fall.put) this.pen.square(fall.at, MARK.fall, shade)
      else this.pen.ring(fall.at, MARK.fall, shade)
      if (k === 0) this.labels.say(fall.at, soon(fall.time - time), color)
    })
    const [next] = falls
    if (next && next.time - time < 1) this.pen.line(at, next.at, color)
    memory.due(`${side === 'left' ? 'L' : 'R'} step`, time, at, next?.swings ? next : undefined)
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
    const ground = Math.min(told.foot.left.at.y, told.foot.right.at.y) - 0.05
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

  /** a box where a thing is meant to be: and how far that is from where it is, or meant to be later, in how long */
  private thing(thing: Object3D, meant: Matrix4, due: number) {
    const box = this.boxes.get(thing) ?? bounds(thing)
    this.boxes.set(thing, box)
    const color = hue('thing')
    this.pen.box(box, meant, color)
    thing.updateWorldMatrix(true, false)
    const centre = box.getCenter(new Vector3())
    const [there, is] = [centre.clone().applyMatrix4(meant), centre.clone().applyMatrix4(thing.matrixWorld)]
    const name = thing.name || 'thing'
    if (due > 0) this.labels.say(there, `${name} ${soon(due)}`, color)
    else this.gap(there, is, `${name} `)
  }
}

/** the box of the meshes a thing is made of, in its own frame */
function bounds(thing: Object3D) {
  thing.updateWorldMatrix(true, true)
  const into = new Matrix4().copy(thing.matrixWorld).invert()
  const box = new Box3()
  thing.traverse((part) => {
    if (!(part instanceof Mesh)) return
    part.geometry.computeBoundingBox()
    const own = part.geometry.boundingBox
    if (own) box.union(own.clone().applyMatrix4(new Matrix4().multiplyMatrices(into, part.matrixWorld)))
  })
  return box.isEmpty() ? new Box3(new Vector3(-0.05, -0.05, -0.05), new Vector3(0.05, 0.05, 0.05)) : box
}
