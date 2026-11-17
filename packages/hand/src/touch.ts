import { Line3, Matrix4, Vector3, Vector4 } from "three"
import { angles, type HandPart, type Finger, type HandPose, fist, flat, lerp, limits, fromAngles, type Segment, type Shape, square } from "./hand"
import type { Surface } from "./surface"

/** how far skin gives, as a share of a finger's thickness, about a millimetre: nearer counts as touching, deeper as
 * sinking in, and every search narrows to it */
const GIVE = 0.1
/** how far apart points along a rod may be, as a share of its thickness, for balls round them to cover it to `GIVE` */
const SPACING = 2 * Math.sqrt(1 - (1 - GIVE) ** 2)
/** which joint turns each of a finger's angles, as `LIMITS` lists them */
const JOINT = [0, 0, 1, 2]
/** the thumb standing out to its side, in the palm's plane, and standing up out of the palm */
export const SPLAYED = [limits("thumb")[0][1], 0, 0, 0]
export const UP = [0, limits("thumb")[1][1], 0, 0]
/** how far a finger's joints are bent in all, at least, for it to count as closing round an object (rad) */
export const CLOSING = 1.2
/** how far apart (rad) the poses lie that a finger sunk in tries, each joint over all its range, to get out */
const COARSE = 0.45
/** what each of a finger's angles may be, `COARSE` apart from its least to its most */
const tries = (finger: Finger) =>
  limits(finger).map(([low, high]) => {
    const n = Math.ceil((high - low) / COARSE)
    return Array.from({ length: n + 1 }, (_, i) => low + ((high - low) * i) / n)
  })

/** points along a rod close enough for balls of its thickness round them to cover it */
export function samples({ a, b, radius }: Segment) {
  const n = Math.max(1, Math.ceil(a.distanceTo(b) / (radius * SPACING)))
  return Array.from({ length: n + 1 }, (_, i) => a.clone().lerp(b, i / n))
}

/** how far a rod's skin stays from the nearest of some others' skins, negative where it presses into them */
export function apart(rod: Segment, others: Segment[]) {
  const [line, near] = [new Line3(), new Vector3()]
  const gap = (p: Vector3, o: Segment) => line.set(o.a, o.b).closestPointToPoint(p, true, near).distanceTo(p) - thick(o)
  return Math.min(...samples(rod).flatMap((p) => others.map((o) => gap(p, o) - thick(rod))))
}

/** A finger thins toward its tip: each bone's thickness as a share of the first's. Against the object a finger counts
 * as thick as its knuckle all along, which is what its pads are placed by; against another finger it counts as thick
 * as it is there, which is what lets closed fingertips lie nearer each other than the knuckles do. */
const TAPER = [1, 0.85, 0.7]
const thick = (s: Segment) => (s.part === "palm" || s.part === "thumb" ? s.radius : s.radius * TAPER[s.bone])

/** narrows `low`..`high`, where `low` passes and `high` fails, to within `fine` of where it changes */
export function bisect(low: number, high: number, passes: (x: number) => boolean, fine: number) {
  for (let mid = (low + high) / 2; Math.abs(high - low) > fine; mid = (low + high) / 2) passes(mid) ? (low = mid) : (high = mid)
  return [low, high]
}

/** Where a part of a hand meets the object it grips: the nearest point (`at`), how far its skin is off it (`gap`, m;
 * negative: sunk in), the way the object's face there faces (`normal`), and what the part ends against as it closes
 * (`stoppedBy`): the object, another finger (for the thumb, the fingers it rests on), its own joints' limits, or nothing */
export type Contact = { at: Vector3; gap: number; normal: Vector3; stoppedBy: "object" | "finger" | "limit" | "nothing" }
/** where a part meets the object, before what stops it is known */
export type Touching = Omit<Contact, "stoppedBy">

/** a hand against an object's surface: where its bones meet it, and how its fingers close onto it */
export class Touch {
  /** a finger's half thickness, the skin's give and the spacing that covers a rod, in the world */
  readonly radius: number
  readonly fine: number
  readonly spacing: number
  readonly rest: Segment[]

  constructor(
    readonly shape: Shape,
    readonly skin: Surface,
    readonly scale: number,
  ) {
    this.rest = shape.segments(flat)
    this.radius = shape.radius * scale
    this.fine = GIVE * this.radius
    this.spacing = SPACING * this.radius
  }

  /** a part's bones at rest, in the hand's frame, and how long they are in the world */
  of = (part: HandPart) => this.rest.filter((s) => s.part === part)
  length = (part: HandPart) => this.of(part).reduce((sum, s) => sum + s.a.distanceTo(s.b), 0) * this.scale
  /** a finger's bones, held so in a pose, the hand placed by `place` */
  bones = (finger: Finger, values: number[], pose: HandPose, place = new Matrix4()) =>
    this.shape.segments({ ...pose, [finger]: fromAngles(values) }, place).filter((s) => s.part === finger)
  /** how deep a bone is sunk, past the give, into the object or into one of `others`: 0 where it is clear; first
   * bones lie side by side */
  sunk = (s: Segment, others: Segment[], slack = 0) =>
    Math.max(0, -this.fine - apart(s, this.beside(s, others)), ...this.room(s, slack).map((room) => -this.fine - room))
  beside = (s: Segment, others: Segment[]) => others.filter((o) => s.bone + o.bone > 0)
  /** how deep a finger's root is sunk where the wrist has put it: no pose brings the root out, so the finger's first
   * bone may be in the object as deep there, and less and less toward its end */
  slack = (finger: Finger, place: Matrix4) => Math.max(0, this.radius - this.skin.depth(this.of(finger)[0].a.clone().applyMatrix4(place)))
  /** how far the skin at each point along a bone is from the object, negative where it is in it, `slack` forgiven */
  room = (s: Segment, slack: number) =>
    samples(s).map((p, i, { length }) => {
      return this.skin.depth(p) - s.radius + (s.bone ? 0 : slack * (1 - i / (length - 1)))
    })

  /** how deep the parts named, held so and placed by `place`, are in the object past their skin, for the palm its flesh
   * between its rods too: points along each rod half a finger's thickness apart, closer than `samples` has them, find a
   * sharp edge pressed between two of them to within a few hundredths of the thickness */
  sunkIn(pose: HandPose, place: Matrix4, parts: readonly HandPart[]) {
    let deepest = 0
    const rods = [...this.shape.segments(pose, place), ...(parts.includes("palm") ? this.shape.flesh(place) : [])]
    for (const g of rods.filter((g) => parts.includes(g.part))) {
      const n = Math.max(1, Math.ceil(g.a.distanceTo(g.b) / (g.radius / 2)))
      for (let i = 0; i <= n; i++) deepest = Math.max(deepest, g.radius - this.skin.depth(g.a.clone().lerp(g.b, i / n)))
    }
    return deepest
  }

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
   * in; where something does all the way, the share at which it is `sunk` the least. Not a bisection: a finger may
   * sink in at both ends and be clear between, past a handle */
  clear(finger: Finger, place: Matrix4, pose: HandPose, from: number[], to: number[], others: Segment[]) {
    const slack = this.slack(finger, place)
    const steps = Math.max(1, Math.ceil(this.travel(finger, from, to) / this.spacing))
    let best = { share: 0, sunk: Infinity }
    for (let k = 0; k <= steps && best.sunk > 0; k++) {
      const bones = this.bones(finger, lerp(from, to, k / steps), pose, place)
      const sunk = Math.max(...bones.map((g) => this.sunk(g, others, slack)))
      if (sunk < best.sunk) best = { share: k / steps, sunk }
    }
    return best
  }

  /** a finger kept as it is held (`now`) where nothing of it sinks in. Else it gets out of the way: of all its
   * poses that are clear, toward the one that moves it least, as far as clears; where none is, to the one sunk the
   * least. The poses are tried joint by joint from the knuckle out: a bone sunk deeper than the best pose so far
   * rules out all that the joints past it could do */
  free(finger: Finger, place: Matrix4, pose: HandPose, others: Segment[], now = angles(pose[finger])) {
    const slack = this.slack(finger, place)
    const sunk = (values: number[], bone: number) => this.sunk(this.bones(finger, [...values, 0, 0].slice(0, 4), pose, place)[bone], others, slack)
    let best = { values: now, sunk: Math.max(...[0, 1, 2].map((bone) => sunk(now, bone))), moved: 0 }
    if (!best.sunk) return now
    const [spreads, ...bends] = tries(finger)
    const search = (values: number[], above: number) => {
      const bone = values.length - 2
      const deep = Math.max(above, sunk(values, bone))
      if (deep > best.sunk) return
      if (bone < 2) return bends[bone + 1].forEach((bend) => search([...values, bend], deep))
      const moved = this.travel(finger, now, values)
      if (deep < best.sunk || moved < best.moved) best = { values, sunk: deep, moved }
    }
    for (const spread of spreads) for (const bend of bends[0]) search([spread, bend], 0)
    const { values } = best
    return best.sunk ? values : lerp(now, values, this.clear(finger, place, pose, now, values, others).share)
  }

  /** closes a finger from `open` toward `shut`, from the first share at which nothing of it sinks in, joint by joint:
   * each stops when a bone it carries meets the object or presses into `others` past the give, and those past it go
   * on, so the finger wraps. A step turns the joints as far as the room between each point of a bone and the object
   * lets, for how far that point moves, so none passes through, till that room is less than the give; neighbours,
   * slid along, only cut short a step into them. A finger sunk in all the way does not close: it gets out of the way
   * as one left out does */
  close(finger: Finger, place: Matrix4, pose: HandPose, open: number[], shut: number[], others: Segment[]) {
    const start = this.clear(finger, place, pose, open, shut, others)
    let [share, moving] = [start.share, 0]
    let values = lerp(open, shut, share)
    const whole = this.travel(finger, open, shut)
    if (start.sunk) return this.free(finger, place, pose, others, values)
    if (!whole) return values
    const slack = this.slack(finger, place)
    const at = (s: number) => values.map((v, i) => (JOINT[i] >= moving ? open[i] + (shut[i] - open[i]) * s : v))
    /** the share of the way a bone may go on: each of its points moves at most as far as its place between the bone's
     * ends, and the joint it turns about not at all */
    const step = (g: Segment, k: number) => {
      const [near, far] = [k - 1, k].map((upto) => this.travel(finger, open, shut, upto, moving))
      const steps = this.room(g, slack).map((room, i, { length }) => {
        const moves = near + ((far - near) * i) / (length - 1)
        return moves ? room / moves : Infinity
      })
      return Math.min(...steps)
    }
    const presses = (g: Segment, k: number) => k >= moving && apart(g, this.beside(g, others)) < -this.fine
    const pressing = (s: number) => this.bones(finger, at(s), pose, place).findIndex(presses)
    // the share of the way that moves no point of the finger further than the give
    const finest = this.fine / whole
    while (moving < 3 && share < 1) {
      const bones = this.bones(finger, values, pose, place)
      const steps = bones.map((g, k) => (k < moving ? Infinity : step(g, k)))
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

  /** a finger closed from straight till it closes round the object: at `spread`, else turned at its knuckle toward the
   * nearest of the object, else at each spread it has, nearest `spread` first, as a finger the object lies along
   * crosses it to wrap it. Where no spread closes round it, the one that touches, else as in a fist, as far as the
   * object and the others let it: it does not stop short, held open where it met its neighbours */
  wrap(finger: Finger, place: Matrix4, pose: HandPose, spread: number, others: Segment[]) {
    const [{ a: knuckle, b: joint }] = this.of(finger)
    const way = square(joint.clone().sub(knuckle), this.shape.normal)
    const side = new Vector3().crossVectors(this.shape.normal, way)
    if (side.dot(this.shape.thumbward) < 0) side.negate()
    const near = this.skin.nearest(knuckle.clone().applyMatrix4(place)).at
    const off = near.applyMatrix4(place.clone().invert()).sub(knuckle)
    const [least, most] = limits(finger)[0]
    const aimed = Math.min(most, Math.max(least, Math.atan(off.dot(side) / Math.abs(off.dot(way))) || 0))
    const spreads = tries(finger)[0].sort((a, b) => Math.abs(a - spread) - Math.abs(b - spread))
    let touching: number[] | undefined
    for (const turned of [spread, aimed, ...spreads]) {
      const values = this.close(finger, place, pose, [turned, 0, 0, 0], [turned, ...fist[finger].bend], others)
      if (this.contact({ ...pose, [finger]: fromAngles(values) }, place, finger).gap > this.fine) continue
      if (values.slice(1).reduce((a, b) => a + b) >= CLOSING) return values
      touching ??= values
    }
    const fisted = fist[finger].spread
    return touching ?? this.close(finger, place, pose, [fisted, 0, 0, 0], [fisted, ...fist[finger].bend], others)
  }

  /** a finger folded from straight till it touches, aimed a finger's thickness off `point` (world) on its knuckle's
   * side: a point on the object, or for one off it, where the way to it from the knuckle meets the object */
  reach(finger: Finger, place: Matrix4, pose: HandPose, point: Vector3, others: Segment[]) {
    const knuckle = this.of(finger)[0].a.clone().applyMatrix4(place)
    const way = point.clone().sub(knuckle).normalize()
    const [on, met] = [this.skin.nearest(point), this.skin.cast(knuckle, way)]
    const at = on.distance > this.fine && Number.isFinite(met) ? knuckle.clone().addScaledVector(way, met) : on.at
    const there = at.addScaledVector(way, -this.radius)
    const values = this.toward(finger, place, pose, there, angles(flat[finger]))
    return this.close(finger, place, pose, [values[0], 0, 0, 0], values, others)
  }

  /** a finger brought onto the object at `point` (world), on the side `out` faces, from near `start`: its tip comes in
   * square to the surface from a finger's thickness off, so that it lands there and not where its fold first grazes.
   * Where the object is in the way of that, it closes onto the point from `start`, or else from straight */
  press(finger: Finger, place: Matrix4, pose: HandPose, point: Vector3, out: Vector3, others: Segment[], start: number[]) {
    const at = this.skin.nearest(point).at
    const off = this.toward(finger, place, pose, at.clone().addScaledVector(out, 2 * this.radius), start)
    const into = this.toward(finger, place, pose, at.addScaledVector(out, this.radius - this.fine), start)
    const clears = (open: number[]) => !this.clear(finger, place, pose, open, into, others).sunk
    return this.close(finger, place, pose, [off, start, angles(flat[finger])].find(clears) ?? off, into, others)
  }

  /** a finger's angles, from `start` and within its limits, that bring its tip nearest `goal` (world): least squares
   * damped by a finger's thickness, till a step moves the tip less than the give */
  toward(finger: Finger, place: Matrix4, pose: HandPose, goal: Vector3, start: number[]) {
    const there = goal.clone().applyMatrix4(place.clone().invert())
    const tip = (values: number[]) => this.bones(finger, values, pose)[2].b
    const [range, h] = [limits(finger), 1e-4]
    let values = start
    for (let k = 0, moved = Infinity; k < this.length(finger) / this.fine && moved > this.fine / this.scale; k++) {
      const at = tip(values)
      const nudged = (i: number) => values.map((v, j) => (i === j ? v + h : v))
      const columns = values.map((_, i) => tip(nudged(i)).sub(at).divideScalar(h))
      const square = columns.flatMap((a, i) => columns.map((b, j) => a.dot(b) + (i === j ? this.shape.radius ** 2 : 0)))
      const miss = there.clone().sub(at)
      const inverse = new Matrix4().fromArray(square).invert()
      const step = new Vector4(...columns.map((c) => c.dot(miss))).applyMatrix4(inverse)
      values = values.map((v, i) => Math.min(range[i][1], Math.max(range[i][0], v + step.getComponent(i))))
      moved = tip(values).distanceTo(at)
    }
    return values
  }

  /** where a part of a hand held so and placed by `place` meets the object: where it comes nearest, or, where it
   * lies along the surface, as a finger's side along a flat thing, the touching point nearest `near` (world) */
  contact(pose: HandPose, place: Matrix4, part: HandPart, near?: Vector3): Touching {
    const all: Touching[] = []
    for (const g of this.shape.segments(pose, place).filter((g) => g.part === part))
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
