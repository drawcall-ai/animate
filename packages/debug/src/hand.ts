import { Body } from '@drawcall/animate'
import { type Element, ELEMENTS, type Grip } from '@drawcall/hand'
import { Color, Group, type Object3D, Vector3 } from 'three'
import { bodies, warm } from './intent'
import { Labels } from './labels'
import { Pen } from './pen'

/** the colour of each element of a hand, and of what the grip asked */
export const FINGER_HUES: Record<Element | 'asked', number> = {
  asked: 0xffffff,
  palm: 0xb3a1ff,
  thumb: 0xff5cc8,
  index: 0xff9f43,
  middle: 0xffe14d,
  ring: 0x5be37a,
  little: 0x4fc3ff,
}
/** a gap this wide, in finger thicknesses, is drawn red; one narrower than so (m) is not told in numbers */
const GAP = { red: 2, told: 0.001 }
/** how large the marks are, in finger radii: the point asked, a normal, the way the hand comes */
const MARK = { at: 1.5, normal: 3, from: 7 }

const RED = new Color(0xff3030)
const hue = (e: Element | 'asked') => new Color(FINGER_HUES[e])
const mm = (m: number) => `${(m * 1000).toFixed(1)} mm`
type Asked = Grip['asked'][number]
const isGrip = (g: unknown): g is Grip => typeof g === 'object' && g !== null && 'contacts' in g && 'fault' in g

/**
 * Why a grip came out as it did, drawn over the things held, as the scene is drawn: what it asked (a white diamond at
 * the point, an arrow from the side the hand comes from, the elements taking part, a line along the target's long
 * way, or "round" where it has none and the arm chose the roll), what the solver found (each taking part's contact on
 * the surface, a dot in its colour with the surface's normal, a line to where its skin is for a gap, labelled in mm,
 * a line across from the thumb to the fingers), and how good it is (green "holds", or red "NOT HOLDING" and the
 * solver's measure of how far). The grips drawn are those of the things bound to the bodies in what it shows, and those
 * of things `hold` has put in a hand there.
 */
export class Grips extends Group {
  private readonly pen = new Pen()
  private readonly labels = new Labels()

  constructor(private readonly shows: Body | Object3D) {
    super()
    this.add(this.pen, this.labels)
  }

  override updateMatrixWorld(force?: boolean) {
    if (this.visible) this.draw()
    super.updateMatrixWorld(force)
  }

  private draw() {
    const { shows } = this
    const found = new Set<Grip>()
    for (const body of bodies(shows)) for (const { grips } of body.bound) for (const g of grips) if (isGrip(g)) found.add(g)
    if (!(shows instanceof Body))
      shows.traverse(({ userData }) => {
        if (isGrip(userData.grip)) found.add(userData.grip)
      })
    this.pen.begin()
    this.labels.begin()
    for (const grip of found) this.grip(grip)
    this.pen.show()
    this.labels.show()
  }

  private grip({ target, contacts, asked, roll, fault, radius, scale }: Grip) {
    const { pen, labels } = this
    target.updateWorldMatrix(true, false)
    // (sizes as they were when the hand gripped, drawn as large as the target is now)
    const big = target.matrixWorld.getMaxScaleOnAxis() / scale
    const [r, place, way] = [
      radius * big,
      (p: Vector3) => p.clone().applyMatrix4(target.matrixWorld),
      (v: Vector3) => v.clone().transformDirection(target.matrixWorld),
    ]
    const taking = new Set(asked.flatMap(({ using }) => using))
    const holds = fault === 0
    const color = hue('asked')
    // what is told is listed in rows at the end of the arrow the hand comes along, each led to what it is of
    const [first] = asked
    const start = place(first.at)
    const anchor = start.clone().addScaledVector(way(first.from ?? new Vector3(0, 1, 0)), r * MARK.from * 1.2)
    let row = 0
    const tell = (text: string, tint: Color, to: Vector3) => {
      pen.line(to, anchor, tint.clone().multiplyScalar(0.5))
      labels.say(anchor, text, tint, row++)
    }
    const names = ({ using }: Asked) => (using.length === ELEMENTS.length ? 'all' : using.join(' '))
    const verdict = holds ? hue('ring') : RED
    asked.forEach((ask, k) => {
      const there = place(ask.at)
      pen.diamond(there, r * MARK.at, holds ? color : RED)
      tell(k ? `then ${names(ask)}` : `${target.name || 'grip'} ${holds ? 'holds' : `NOT HOLDING ${mm(fault)}`}: ${names(ask)}`, verdict, there)
      if (ask.from) pen.arrow(there.clone().addScaledVector(way(ask.from), r * MARK.from), way(ask.from).negate(), r * MARK.from, color)
    })
    // the roll: the target's long way through the point first asked
    const long = way(roll.long).multiplyScalar(r * MARK.from)
    pen.line(start.clone().sub(long), start.clone().add(long), color.clone().multiplyScalar(0.6))
    tell(roll.round ? 'round: the arm chose the roll' : 'long way', color, start.clone().add(long))

    for (const e of ELEMENTS) {
      const { at, gap, normal } = contacts[e]
      const sunk = gap < -GAP.told
      if (!taking.has(e) && !sunk) continue
      const [on, out] = [place(at), way(normal)]
      const off = Math.abs(gap) >= GAP.told
      const tint = !taking.has(e) || (off && gap < 0) ? RED : hue(e)
      pen.dot(on, tint)
      pen.line(on, on.clone().addScaledVector(out, r * MARK.normal), tint)
      if (off) pen.line(on, on.clone().addScaledVector(out, gap * big), warm(Math.abs(gap), GAP.red * radius))
      tell(off ? `${e} ${gap > 0 ? 'short' : 'in'} ${mm(Math.abs(gap))}` : e, tint, on)
    }
    // the thumb across from the fingers
    const pads = ELEMENTS.filter((e) => e !== 'palm' && e !== 'thumb' && taking.has(e)).map((e) => place(contacts[e].at))
    if (taking.has('thumb') && pads.length)
      pen.line(place(contacts.thumb.at), pads.reduce((sum, p) => sum.add(p), new Vector3()).divideScalar(pads.length), hue('thumb'))
  }
}
