import { Line3, Matrix4, Vector3, Vector4 } from 'three'
import { angles, type Element, type Finger, fist, flat, type Hand, lerp, limits, part, type Pose } from './hand'
import { type Segment, square } from './hand'
import type { Surface } from './surface'

/** how far skin gives, as a share of a finger's thickness, about a millimetre: nearer counts as touching, deeper as
 * sinking in, and every search narrows to it */
const GIVE = 0.1
/** how far apart points along a rod may be, as a share of its thickness, for balls round them to cover it to `GIVE` */
const SPACING = 2 * Math.sqrt(1 - (1 - GIVE) ** 2)
/** which joint turns each of a finger's angles, as `LIMITS` lists them */
const JOINT = [0, 0, 1, 2]

/** points along a rod close enough for balls of its thickness round them to cover it */
export function samples({ a, b, radius }: Segment) {
  const n = Math.max(1, Math.ceil(a.distanceTo(b) / (radius * SPACING)))
  return Array.from({ length: n + 1 }, (_, i) => a.clone().lerp(b, i / n))
}

/** how far a rod's skin stays from the nearest of some others' skins, negative where it presses into them */
export function apart(rod: Segment, others: Segment[]) {
  const [line, near] = [new Line3(), new Vector3()]
  const gap = (p: Vector3, o: Segment) => line.set(o.a, o.b).closestPointToPoint(p, true, near).distanceTo(p) - o.radius
  return Math.min(...samples(rod).flatMap((p) => others.map((o) => gap(p, o) - rod.radius)))
}

/** narrows `low`..`high`, where `low` passes and `high` fails, to within `fine` of where it changes */
export function bisect(low: number, high: number, passes: (x: number) => boolean, fine: number) {
  for (let mid = (low + high) / 2; Math.abs(high - low) > fine; mid = (low + high) / 2)
    passes(mid) ? (low = mid) : (high = mid)
  return [low, high]
}

/** where an element meets the target: the nearest point, how far its skin is off (negative: sunk in), the normal */
export type Contact = { at: Vector3; gap: number; normal: Vector3 }

/** a hand against a target's surface: where its bones meet it, and how its fingers close onto it */
export class Touch {
  /** a finger's half thickness, the skin's give and the spacing that covers a rod, in the world */
  readonly radius: number
  readonly fine: number
  readonly spacing: number
  readonly rest: Segment[]

  constructor(
    readonly hand: Hand,
    readonly skin: Surface,
    readonly scale: number,
  ) {
    this.rest = hand.segments(flat)
    this.radius = hand.radius * scale
    this.fine = GIVE * this.radius
    this.spacing = SPACING * this.radius
  }

  /** an element's bones at rest, in the hand's frame, and how long they are in the world */
  of = (e: Element) => this.rest.filter((s) => s.element === e)
  length = (e: Element) => this.of(e).reduce((sum, s) => sum + s.a.distanceTo(s.b), 0) * this.scale
  /** a finger's bones, held so in a pose, the hand placed by `place` */
  bones = (finger: Finger, values: number[], pose: Pose, place = new Matrix4()) =>
    this.hand.segments({ ...pose, [finger]: part(values) }, place).filter((s) => s.element === finger)
  /** whether a bone sinks into the target, or into one of `others`, past the give; first bones lie side by side */
  sinks = (s: Segment, others: Segment[]) =>
    samples(s).some((p) => this.skin.depth(p) < s.radius - this.fine) || apart(s, this.beside(s, others)) < -this.fine
  beside = (s: Segment, others: Segment[]) => others.filter((o) => s.bone + o.bone > 0)

  /** how far a point of a finger's bone `upto` (its tip by default) moves at most, the joints from `first` on turning
   * from some angles to others: each angle's turn times the length from its joint out to that bone's end (world) */
  travel(finger: Finger, from: number[], to: number[], upto = 2, first = 0) {
    const lengths = this.of(finger).map((s) => s.a.distanceTo(s.b) * this.scale)
    return from.reduce((sum, v, i) => {
      if (JOINT[i] < first || JOINT[i] > upto) return sum
      return sum + Math.abs(to[i] - v) * lengths.slice(JOINT[i], upto + 1).reduce((a, b) => a + b)
    }, 0)
  }

  /** the first share of the way from `from` to `to`, a spacing's move at a time, at which nothing of the finger sinks
   * in: undefined if none. Not a bisection: a finger may sink in at both ends and be clear between, past a handle */
  clear(finger: Finger, place: Matrix4, pose: Pose, from: number[], to: number[], others: Segment[]) {
    const steps = Math.max(1, Math.ceil(this.travel(finger, from, to) / this.spacing))
    for (let k = 0; k <= steps; k++)
      if (!this.bones(finger, lerp(from, to, k / steps), pose, place).some((g) => this.sinks(g, others)))
        return k / steps
  }

  /** closes a finger from `open` toward `shut`, from the first share at which nothing of it sinks in, joint by joint:
   * each stops when a bone it carries meets the target or presses into `others` past the give, and those past it go
   * on, so the finger wraps. A step turns the joints as far as the room between each bone and the target lets, so none
   * passes through, till that room is less than the give; neighbours, slid along, only cut short a step into them */
  close(finger: Finger, place: Matrix4, pose: Pose, open: number[], shut: number[], others: Segment[]) {
    let [share, moving] = [this.clear(finger, place, pose, open, shut, others) ?? 1, 0]
    let values = lerp(open, shut, share)
    const at = (s: number) => values.map((v, i) => (JOINT[i] >= moving ? open[i] + (shut[i] - open[i]) * s : v))
    const room = (g: Segment) => Math.min(...samples(g).map((p) => this.skin.nearest(p).distance - g.radius))
    const presses = (g: Segment, k: number) => k >= moving && apart(g, this.beside(g, others)) < -this.fine
    const pressing = (s: number) => this.bones(finger, at(s), pose, place).findIndex(presses)
    // the share of the way that moves no point of the finger further than the give
    const finest = this.fine / this.travel(finger, open, shut)
    while (moving < 3 && share < 1) {
      const bones = this.bones(finger, values, pose, place)
      const steps = bones.map((g, k) => (k < moving ? Infinity : room(g) / this.travel(finger, open, shut, k, moving)))
      const met = steps.findIndex((step) => step <= finest / 4)
      if (met >= 0) {
        moving = met + 1
        continue
      }
      const next = Math.min(1, share + Math.min(...steps))
      const [low, high] = pressing(next) < 0 ? [next, -1] : bisect(share, next, (s) => pressing(s) < 0, finest)
      ;[values, share, moving] = [at(low), low, high < 0 ? moving : pressing(high) + 1]
    }
    return values
  }

  /** a finger closed till it touches: straight from its knuckle if the plane it folds in passes within its thickness
   * and `half` (the target's half width) of the segment `core` (world), else spread only as far as brings that plane
   * through the segment's nearer end, so that it neither crosses its neighbours nor splays */
  curl(finger: Finger, place: Matrix4, pose: Pose, core: Vector3[], half: number, others: Segment[]) {
    const [{ a: knuckle, b: joint }] = this.of(finger)
    const way = square(joint.clone().sub(knuckle), this.hand.normal)
    const side = new Vector3().crossVectors(this.hand.normal, way)
    if (side.dot(this.hand.thumbward) < 0) side.negate()
    const ends = core.map((p) => p.clone().applyMatrix4(place.clone().invert()).sub(knuckle))
    const [a, b] = ends.map((q) => q.dot(side) * this.scale)
    const nearer = ends[Math.abs(a) < Math.abs(b) ? 0 : 1]
    const off = a * b <= 0 ? 0 : Math.min(Math.abs(a), Math.abs(b))
    const [least, most] = limits(finger)[0]
    const turn = off <= this.radius + half ? 0 : Math.atan(nearer.dot(side) / Math.abs(nearer.dot(way)))
    const spread = Math.min(most, Math.max(least, turn))
    return this.close(finger, place, pose, [spread, 0, 0, 0], [spread, ...angles(fist[finger]).slice(1)], others)
  }

  /** a finger folded from straight till it touches, aimed a finger's thickness off `point` (world) on `out`'s side */
  reach(finger: Finger, place: Matrix4, pose: Pose, point: Vector3, out: Vector3, others: Segment[]) {
    const there = this.skin.nearest(point).at.addScaledVector(out, this.radius)
    const values = this.toward(finger, place, pose, there, angles(flat[finger]))
    return this.close(finger, place, pose, [values[0], 0, 0, 0], values, others)
  }

  /** a finger brought onto the target at `point` (world), on the side `out` faces, from near `start`: its tip comes in
   * square to the surface from a finger's thickness off, so that it lands there and not where its fold first grazes */
  press(finger: Finger, place: Matrix4, pose: Pose, point: Vector3, out: Vector3, others: Segment[], start: number[]) {
    const at = this.skin.nearest(point).at
    const off = this.toward(finger, place, pose, at.clone().addScaledVector(out, 2 * this.radius), start)
    const into = this.toward(finger, place, pose, at.addScaledVector(out, this.radius - this.fine), start)
    return this.close(finger, place, pose, off, into, others)
  }

  /** a finger's angles, from `start` and within its limits, that bring its tip nearest `goal` (world): least squares
   * damped by a finger's thickness, till a step moves the tip less than the give */
  toward(finger: Finger, place: Matrix4, pose: Pose, goal: Vector3, start: number[]) {
    const there = goal.clone().applyMatrix4(place.clone().invert())
    const tip = (values: number[]) => this.bones(finger, values, pose)[2].b
    const [range, h] = [limits(finger), 1e-4]
    let values = start
    for (let k = 0, moved = Infinity; k < this.length(finger) / this.fine && moved > this.fine / this.scale; k++) {
      const at = tip(values)
      const nudged = (i: number) => values.map((v, j) => (i === j ? v + h : v))
      const columns = values.map((_, i) => tip(nudged(i)).sub(at).divideScalar(h))
      const square = columns.flatMap((a, i) => columns.map((b, j) => a.dot(b) + (i === j ? this.hand.radius ** 2 : 0)))
      const miss = there.clone().sub(at)
      const inverse = new Matrix4().fromArray(square).invert()
      const step = new Vector4(...columns.map((c) => c.dot(miss))).applyMatrix4(inverse)
      values = values.map((v, i) => Math.min(range[i][1], Math.max(range[i][0], v + step.getComponent(i))))
      moved = tip(values).distanceTo(at)
    }
    return values
  }

  /** where an element of a hand held so and placed by `place` meets the target: where it comes nearest, or, where it
   * lies along the surface, as a finger's side along a flat thing, the touching point nearest `near` (world) */
  contact(pose: Pose, place: Matrix4, e: Element, near?: Vector3): Contact {
    const all: Contact[] = []
    for (const g of this.hand.segments(pose, place).filter((g) => g.element === e))
      for (const p of samples(g)) {
        const close = this.skin.nearest(p)
        const depth = this.skin.depth(p, close)
        const normal = p.clone().sub(close.at).normalize().multiplyScalar(Math.sign(depth))
        all.push({ at: close.at, gap: depth - g.radius, normal })
      }
    const best = all.reduce((a, b) => (b.gap < a.gap ? b : a))
    if (!near) return best
    const touching = all.filter((c) => c.gap <= best.gap + this.fine)
    return touching.reduce((a, b) => (b.at.distanceTo(near) < a.at.distanceTo(near) ? b : a))
  }
}
