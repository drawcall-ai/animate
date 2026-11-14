import { Line3, Matrix4, type Object3D, Quaternion, Vector3 } from 'three'
import { all, angles, check, each, ELEMENTS, type Element, FINGERS, fist, flat, type Hand, lerp } from './hand'
import { type Finger, limits, part, type Pose, relaxed, type Segment, square } from './hand'
import { surface } from './surface'
import { apart, bisect, type Contact, samples, Touch } from './touch'

/** how a hand holds a target: its place in the hand bone's frame, the pose, and each element's contact, in its frame */
export type Grip = { target: Object3D; position: Vector3; quaternion: Quaternion; pose: Pose; contacts: Contacts }
type Contacts = Record<Element, Contact>

/** what a grip says: where on the target, the side the hand comes from, what takes part, and how the rest is held */
export type Statement = { at: Vector3; from?: Vector3; using?: readonly Element[]; start?: Pose | Grip }

/** how far off level with the fingers' pads the thumb's may land and squeeze, not shear: skin rolling, about 3 mm */
const PRESS = 0.3
/** how hard skin pulls along a smooth thing at most, for how hard it presses: how far a squeeze may slant, unsheared */
const FRICTION = 0.5

const cm = (m: number) => `${(m * 100).toFixed(1)} cm`
const shift = (place: Matrix4, by: Vector3) => new Matrix4().makeTranslation(by).multiply(place)
const mean = (points: Vector3[]) => points.reduce((sum, p) => sum.addScaledVector(p, 1 / points.length), new Vector3())
/** where a finger's last bone presses: its pad, two thirds of the way to the tip */
const pad = ({ a, b }: Segment) => a.clone().lerp(b, 2 / 3)
/** a rotation that turns the directions `x`, `y` (square to it) into `toX`, `toY` */
const turning = (x: Vector3, y: Vector3, toX: Vector3, toY: Vector3) => {
  const basis = (x: Vector3, y: Vector3) => new Matrix4().makeBasis(x, y, new Vector3().crossVectors(x, y))
  return new Quaternion().setFromRotationMatrix(basis(toX, toY).multiply(basis(x, y).transpose()))
}
/** a direction's parts along the axes, those less than half the largest left out */
const counted = (v: Vector3) =>
  v.toArray().map((c, _, all) => (Math.abs(c) < Math.max(...all.map(Math.abs)) / 2 ? 0 : c))
/** whether the thumb is more on the second side than the first (1), less (-1) or neither (0): +y before +z before +x */
const preferred = ([a, b]: number[][]) => {
  const which = [1, 2, 0].find((i) => a[i] !== b[i])
  return which === undefined ? 0 : Math.sign(b[which] - a[which])
}

/** Finds how a hand grips a target with the elements `using` (all by default), coming from `from`, held at `at`, both
 * in the target's frame. What is left out keeps its part of `start`: a pose, or an earlier grip of the same target,
 * whose placement is kept. Throws naming the element, by how much, and what to change. */
export function grip(hand: Hand, target: Object3D, { at, from, using = ELEMENTS, start = relaxed }: Statement): Grip {
  const earlier = 'target' in start ? start : undefined
  if (!using.length) throw new Error('a grip needs the palm or a finger to take part')
  if (earlier && earlier.target !== target)
    throw new Error(`the grip started from holds ${earlier.target.name || 'another target'}: start from this one's`)
  if (earlier && (from || using.includes('palm')))
    throw new Error('a grip composed onto another keeps its placement: leave out `from` and the palm')
  const held: Pose = { ...('target' in start ? start.pose : start) }
  check(held)
  target.updateMatrixWorld(true)
  const touch = new Touch(hand, surface(target), hand.size())
  const { skin, radius, fine, spacing, scale } = touch
  /** how wide a finger is: what a grip may be off by and still meet what it aims at */
  const breadth = 2 * radius
  const point = target.localToWorld(at.clone())
  const inverse = target.matrixWorld.clone().invert()
  /** a finger's half thickness in the target's frame */
  const thick = radius * inverse.getMaxScaleOnAxis()
  /** a direction of the world as the target's axes name it, the lesser parts left out: `+x`, `-y+z` */
  const named = (v: Vector3) =>
    counted(v.clone().transformDirection(inverse))
      .map((c, i) => (c ? (c < 0 ? '-' : '+') + 'xyz'[i] : ''))
      .join('')
  /** a miss as the move that mends it: `1.2 cm toward +x` */
  const by = (v: Vector3) => `${cm(v.length())} toward ${named(v)}`
  const fingers = FINGERS.filter((f) => f !== 'thumb' && using.includes(f))
  const [thumb, palm] = [using.includes('thumb'), using.includes('palm')]
  const pinch = !palm && thumb && fingers.length > 0
  const placed = (turn: Quaternion, mine: Vector3, there: Vector3) => {
    const place = new Matrix4().compose(new Vector3(), turn, new Vector3(scale, scale, scale))
    return place.setPosition(there.clone().sub(mine.clone().applyMatrix4(place)))
  }
  /** the bones of a pose placed so, but for the palm and those `but` names */
  const rods = (pose: Pose, place: Matrix4, but = (_: Element) => false) =>
    hand.segments(pose, place).filter((g) => g.element !== 'palm' && !but(g.element))

  /** Closing is enclosing. What is left out keeps its pose where the target allows, else moves the least that clears.
   * The fingers taking part close one by one, each kept from those before; the thumb last, from standing out of the
   * palm, lowered as far as the target is in the way, folding till each bone meets something. Without the palm its tip
   * presses instead, from near `opposing`, on where the fingers touch (nearest `near`) mirrored through `middle` */
  const close = (place: Matrix4, middle: Vector3, near?: Vector3, opposing?: number[]) => {
    const pose: Pose = { ...held }
    for (const f of FINGERS.filter((f) => !using.includes(f))) {
      const now = angles(pose[f])
      if (!touch.bones(f, now, pose, place).some((g) => touch.sinks(g, []))) continue
      const ways = [flat, fist].flatMap((to) => {
        const share = touch.clear(f, place, pose, now, angles(to[f]), [])
        return share === undefined ? [] : [lerp(now, angles(to[f]), share)]
      })
      if (!ways.length) throw new Error(`the ${f}, left out, cannot clear the target: let it take part`)
      const moved = (values: number[]) => touch.travel(f, now, values)
      pose[f] = part(ways.reduce((a, b) => (moved(b) < moved(a) ? b : a)))
    }
    for (const [k, f] of fingers.entries()) {
      const others = rods(pose, place, (e) => using.includes(e) && !fingers.slice(0, k).some((g) => g === e))
      // what a composed grip adds reaches for its point from its knuckle's side; a fresh grip's fingers wrap the core
      const knuckle = touch.of(f)[0].a.clone().applyMatrix4(place)
      const out = knuckle.sub(skin.nearest(point).at).normalize()
      const reached = earlier && touch.reach(f, place, pose, point, out, others)
      const curled = () => touch.curl(f, place, pose, core, across / 2, others)
      const closed = () => touch.close(f, place, pose, angles(relaxed[f]), angles(fist[f]), others)
      pose[f] = part(reached || (palm ? curled() : lateral ? angles(relaxed[f]) : closed()))
    }
    if (!thumb) return pose
    const others = rods(pose, place, (e) => e === 'thumb')
    if (fingers.length && !palm) {
      const contacts = fingers.map((f) => touch.contact(pose, place, f, near))
      const theirs = mean(contacts.map((c) => c.at))
      const out = mean(contacts.map((c) => c.normal.clone().negate())).normalize()
      const aim = theirs.addScaledVector(out, -2 * theirs.clone().sub(middle).dot(out))
      pose.thumb = part(touch.press('thumb', place, pose, aim, out, others, opposing ?? angles(pose.thumb)))
      return pose
    }
    const up = [0, thumbs[1][1], 0, 0]
    const open = lerp(up, angles(flat.thumb), touch.clear('thumb', place, pose, up, angles(flat.thumb), []) ?? 1)
    const shut = [...angles(fist.thumb).slice(0, 2), thumbs[2][1], thumbs[3][1]]
    pose.thumb = part(touch.close('thumb', place, pose, open, shut, others))
    return pose
  }

  /** what keeps an element taking part from holding: it sinks in, or closes short, unless it is the thumb resting on
   * the fingers round a handle, or a finger closed as far as its fist or its neighbours let it round something within
   * its thickness */
  const failing = (e: Element, pose: Pose, place: Matrix4, { gap, normal }: Contact) => {
    const mend = `move the point ${by(normal.clone().multiplyScalar(-gap))}`
    if (gap < -fine) return `sinks ${cm(-gap)} into the target: ${mend}`
    if (gap <= fine) return
    const rest = rods(pose, place, (o) => o === 'thumb')
    const thumbs = rods(pose, place).filter((g) => g.element === 'thumb' && g.bone > 0)
    const rests = palm && e === 'thumb' && thumbs.some((g) => apart(g, rest) <= fine)
    const neighbours = rods(pose, place, (o) => o === e || o === 'thumb')
    const stopped = rods(pose, place).some((g) => g.element === e && apart(g, touch.beside(g, neighbours)) <= fine)
    const fisted = (finger: Finger) => pose[finger].bend.every((v, i) => v === fist[finger].bend[i])
    const closed = e !== 'palm' && e !== 'thumb' && gap <= radius && (stopped || fisted(e))
    if (!rests && !closed) return `closes ${cm(gap)} short of the target: ${mend}, or leave the ${e} out`
  }

  /** the grip a pose and placement make, once nothing sinks in, all taking part hold, and the thumb opposes */
  const finish = (place: Matrix4, pose: Pose, advice: string): Grip => {
    check(pose)
    // a finger's side along a flat thing touches all along it: where it squeezes is across from the thumb
    const near = pinch ? touch.contact(pose, place, 'thumb').at : undefined
    const contacts = all((e) => touch.contact(pose, place, e, near))
    for (const e of ELEMENTS) {
      const { gap } = contacts[e]
      if (!using.includes(e) && gap < -fine)
        throw new Error(`the ${e}, left out, lies ${cm(-gap)} in the target: let it take part, or \`start\` it clear`)
      const why = using.includes(e) && failing(e, pose, place, contacts[e])
      if (why) throw new Error(`the ${e} ${why}`)
    }
    const pushing = fingers.filter((f) => contacts[f].gap <= fine)
    const squeeze = mean(pushing.map((f) => contacts[f].normal)).normalize()
    const opposed = contacts.thumb.normal.angleTo(squeeze)
    const holds = thumb && pushing.length && contacts.thumb.gap <= fine
    const degrees = Math.round((opposed * 180) / Math.PI)
    if (holds && opposed < Math.PI / 2)
      throw new Error(`the thumb presses on the fingers' side, ${degrees}° from them: ${advice}`)
    // without the palm the thumb squeezes the target against the fingers' pads, directly across it from their middle
    const theirs = mean(pushing.map((f) => contacts[f].at))
    const off = contacts.thumb.at.clone().sub(theirs).projectOnPlane(squeeze)
    if (holds && !palm && off.length() > PRESS * radius + FRICTION * contacts.thumb.at.distanceTo(theirs))
      throw new Error(`the thumb lands ${cm(off.length())} off level with the fingers: move the point ${by(off)}`)
    for (const e of earlier ? using : []) {
      const ends = hand.segments(pose, place).flatMap((g) => (g.element === e ? samples(g) : []))
      const end = ends.reduce((a, b) => (a.distanceTo(point) < b.distanceTo(point) ? a : b))
      const miss = end.distanceTo(point) - radius
      if (miss > breadth)
        throw new Error(`the ${e} ends ${cm(miss)} from the point: move it toward ${named(end.sub(point))}`)
    }
    const [position, quaternion] = [new Vector3(), new Quaternion()]
    place.clone().invert().multiply(target.matrixWorld).decompose(position, quaternion, new Vector3())
    const local = (e: Element) => {
      const { at, gap, normal } = contacts[e]
      return { at: target.worldToLocal(at.clone()), gap, normal: normal.clone().transformDirection(inverse) }
    }
    return { target, position, quaternion, pose, contacts: all(local) }
  }

  if (earlier) {
    const turn = target.getWorldQuaternion(new Quaternion()).multiply(earlier.quaternion.clone().invert())
    const place = placed(turn, earlier.position, target.getWorldPosition(new Vector3()))
    return finish(place, close(place, point), 'start from a grip coming from another side')
  }
  if (!from?.lengthSq()) throw new Error('a grip must say which side the hand comes from')
  // without the palm the thumb and fingers hold the point between them, so it lies inside the target
  if (pinch && skin.depth(point) > 0)
    throw new Error(`the point pinched lies outside the target: move it ${by(skin.nearest(point).at.sub(point))}`)

  // the line along the approach through the point enters the target; from `far` back no part of the hand meets it
  const toward = from.clone().transformDirection(target.matrixWorld).negate()
  const span = Math.max(...touch.rest.map((s) => s.b.length())) * scale
  const far = point.distanceTo(skin.bounds.center) + skin.bounds.radius + span
  const entered = skin.cast(point.clone().addScaledVector(toward, -far), toward)
  if (entered === Infinity) {
    const off = skin.nearest(point).at.sub(point).projectOnPlane(toward)
    throw new Error(`the hand coming from ${named(from)} meets nothing of the target: move the point ${by(off)}`)
  }
  const entry = point.clone().addScaledVector(toward, entered - far)
  const deep = point.clone().sub(entry).dot(toward)
  const short = `${cm(Math.abs(deep))} ${deep > 0 ? 'behind' : 'short of'} the surface the palm meets`
  if (palm && Math.abs(deep) > breadth)
    throw new Error(`the point lies ${short}: move it toward ${named(toward.clone().multiplyScalar(-deep))}`)
  const through = skin.cast(entry.clone().addScaledVector(toward, 1e-6), toward)
  // the palm and a lone press meet the target's surface, a pinch holds it at the point
  const centre = pinch
    ? point.clone()
    : entry.clone().addScaledVector(toward, Number.isFinite(through) ? through / 2 : 0)
  // the target's widths through its centre across the approach: their moments give its long and thin directions
  const reaches = (u: Vector3) => Math.min(far, skin.cast(centre, u))
  const width = (u: Vector3) => reaches(u) + reaches(u.clone().negate())
  const x = square(Math.abs(toward.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0), toward)
  const y = new Vector3().crossVectors(toward, x)
  const ways = Math.ceil((Math.PI * touch.length('middle')) / spacing)
  const way = (a: number) => x.clone().multiplyScalar(Math.cos(a)).addScaledVector(y, Math.sin(a))
  let [xx, xy, yy, least, thinnest] = [0, 0, 0, Infinity, 0]
  for (let k = 0, a = 0; k < ways; a = (Math.PI * ++k) / ways) {
    const w = width(way(a))
    if (w < least) [least, thinnest] = [w, a]
    const [c, s] = [w * Math.cos(a), w * Math.sin(a)]
    ;[xx, xy, yy] = [xx + c * c, xy + c * s, yy + s * s]
  }
  // a pinch squeezes the thinnest way across, as a cube's faces and not its corners; a palm lies along the target
  const long = way(pinch ? thinnest + Math.PI / 2 : Math.atan2(2 * xy, xx - yy) / 2)
  const thin = new Vector3().crossVectors(toward, long)
  const across = width(thin)
  // a pinch's pads land on the faces either side of the point across the thin direction
  const aside = (reaches(thin) - reaches(thin.clone().negate())) / 2
  const middle = pinch ? centre.clone().addScaledVector(thin, aside) : centre
  // the fingers close over the target's core: its long line through the middle, short of its ends by half its width
  const core = [long, long.clone().negate()].map((v) =>
    middle.clone().addScaledVector(v, Math.max(0, reaches(v) - across / 2)),
  )
  const axis = named(thin).replace(/[+-]/g, '±')
  const thinner = palm && through < across ? `come from ${axis}, across which the target is thinner, or ` : ''
  const advice = `${thinner}leave the thumb out`

  // the fingers close from flat as the thumb, turned out, folds to meet them, till the pads come as near what opposes
  // them (the palm's middle, or the thumb's tip) as the target is thick: their line is then the target's long way
  const palmMiddle = mean(touch.of('palm').flatMap((s) => [s.a, s.b]))
  const thumbs = limits('thumb')
  const closing = (s: number) => {
    const pose: Pose = { ...held, thumb: part([thumbs[0][1], fist.thumb.bend[0], thumbs[2][1] * s, thumbs[3][1] * s]) }
    for (const f of FINGERS.slice(1)) pose[f] = part(angles(fist[f]).map((v, i) => (i ? v * s : v)))
    const pads = FINGERS.slice(1).map((f) => pad(touch.bones(f, angles(pose[f]), pose)[2]))
    const tip = touch.bones('thumb', angles(pose.thumb), pose)[2].b
    // a pinch's thumb meets the first two fingers' pads, the others closing round beside them
    const taking = pads.filter((_, k) => !fingers.length || using.includes(FINGERS[k + 1]))
    const theirs = mean(palm ? taking : taking.slice(0, 2))
    const near = theirs.distanceTo(palm ? palmMiddle : tip) * scale <= across + breadth
    const line = square(pads[0].clone().sub(pads[3]), hand.normal)
    return { near, line, thumbside: tip.sub(mean(pads)), pose }
  }
  const steps = Math.ceil((4 * touch.length('middle')) / spacing)
  const k = Array.from({ length: steps }, (_, k) => k).find((k) => closing(k / steps).near) ?? steps
  const { line, thumbside, pose: closed } = closing(k / steps)
  // Without the palm the fingers point the way the hand comes, what they hold at their tips, a pinch's closed as above.
  // A thing thinner than half a finger, held by one, the thumb folding in the palm's plane presses against the side of
  // the relaxed finger instead: to meet the thumb's pad so near, the finger would curl back over the hand
  const lateral = pinch && fingers.length === 1 && across < radius
  const ready = each((f) => (!using.includes(f) ? held : pinch && !lateral ? closed : relaxed)[f])
  const leading = hand.segments(ready).filter((g) => (fingers.length ? fingers : using).includes(g.element))
  const ends = leading.filter((g) => g.bone === 2)
  const knuckles = leading.filter((g) => g.bone === 0).map((g) => g.a)
  const pointing = new Vector3().subVectors(mean(ends.map((g) => g.b)), mean(knuckles)).normalize()
  const folds = Math.ceil((4 * touch.length('thumb')) / spacing)
  const folded = (k: number) => part([0, relaxed.thumb.bend[0], (thumbs[2][1] * k) / folds, (thumbs[3][1] * k) / folds])
  const meets = (k: number) => apart(touch.bones('thumb', angles(folded(k)), ready)[2], leading) * scale <= across
  if (lateral) ready.thumb = folded(Array.from({ length: folds }, (_, k) => k).find(meets) ?? folds)
  // the thumb meets a lone finger's side where it comes nearest, and pads at their middle; a pinch squeezes across
  // the plane a lone finger folds in, or the row of pads, or straight at a lone pad
  const tip = touch.bones('thumb', angles(ready.thumb), ready)[2].b
  const beside = (g: Segment) => new Line3(g.a, g.b).closestPointToPoint(tip, true, new Vector3())
  const nearest = (a: Vector3, b: Vector3) => (a.distanceTo(tip) < b.distanceTo(tip) ? a : b)
  const contact = lateral ? leading.map(beside).reduce(nearest) : mean(ends.slice(0, 2).map(pad))
  const [row, end] = fingers.length > 1 ? [ends[0].b, ends[ends.length - 1].b] : [leading[0].b, leading[0].a]
  const crossing = new Vector3().crossVectors(pointing, row.clone().sub(end)).normalize()
  crossing.multiplyScalar(Math.sign(crossing.dot(hand.normal.clone().add(hand.thumbward))))
  if (pinch && !lateral && fingers.length === 1) crossing.copy(square(tip.clone().sub(contact), pointing))
  // a handle seats in the crease: on the palm's middle line, level with where the middle finger's middle bone ends in
  // a fist. Nearer the wrist the thumb no longer comes round a thick handle, nearer the knuckles the first bones cannot
  // stand along a thin one; a thing deeper than a finger is long seats on the palm's middle, the fingers hooked over
  const up = touch.of('palm')[1].b.clone().normalize()
  const fold = hand.segments(fist).filter((g) => g.element === 'middle')[1].b
  const level = through > touch.length('middle') ? 0 : fold.sub(palmMiddle).dot(up)
  const seat = palmMiddle.clone().addScaledVector(up, level).addScaledVector(hand.normal, hand.radius)

  /** the hand turned so, `mine` on the approach through `there`, come in from far till what `meets` picks touches */
  const come = (turn: Quaternion, mine: Vector3, there: Vector3, pose: Pose, meets = (_: Element) => true) => {
    const back = shift(placed(turn, mine, there), toward.clone().multiplyScalar(-far))
    const points = hand.segments(pose, back).flatMap((g) => (meets(g.element) ? samples(g) : []))
    const clear = (d: number) =>
      points.every((p) => skin.nearest(p.clone().addScaledVector(toward, d)).distance >= radius)
    let low = far - there.clone().sub(entry).dot(toward)
    while (!clear(low)) low -= spacing
    return shift(back, toward.clone().multiplyScalar(bisect(low, low + spacing, clear, fine)[0]))
  }

  /** The grip with the hand turned so. With the palm, it comes in along the approach till the palm touches, on the
   * crease, and the fingers close round. A press comes in till the pads touch. A pinch's target comes in across from
   * the thumb till it meets the fingers, and the thumb goes across it */
  const solve = (turn: Quaternion): Grip => {
    if (palm) {
      const place = come(turn, seat, point, held, (e) => e === 'palm')
      return finish(place, close(place, middle), advice)
    }
    if (!pinch) return finish(come(turn, mean(ends.map((g) => g.b)), entry, ready), ready, advice)
    const at = (t: number) => placed(turn, contact.clone().addScaledVector(crossing, t), middle)
    const clear = (t: number) => fingers.every((f) => touch.contact(ready, at(t), f).gap >= 0)
    const t = bisect(2 * (hand.radius + across / scale), 0, clear, fine / scale / 2)[0]
    const mirrored = contact.clone().addScaledVector(crossing, 2 * t)
    const opposing = touch.toward('thumb', new Matrix4(), ready, mirrored, angles(ready.thumb))
    return finish(at(t), close(at(t), middle, contact.clone().applyMatrix4(at(t)), opposing), advice)
  }

  // the palm faces along the approach, the target's long way along the pads' line; without it the fingers point along
  // the approach, the thumb (or a press's palm) across the thin way. The target's bulk goes out on the thumb's side;
  // within a finger's breadth of the point it does not say which way round the hand goes, and both may hold
  const base = palm
    ? turning(hand.normal, line, toward, long)
    : turning(pointing, pinch ? crossing : square(hand.normal, pointing), toward, thin)
  const bulk = skin.centroid.clone().sub(point).projectOnPlane(toward)
  const over = new Quaternion().setFromAxisAngle(toward, Math.PI)
  const turns = [base, base.clone().premultiply(over)].filter(
    (t) => bulk.length() <= breadth || hand.thumbward.clone().applyQuaternion(t).dot(bulk) >= 0,
  )
  const errors: string[] = []
  const attempt = (turn: Quaternion) => {
    try {
      return solve(turn)
    } catch (error) {
      if (!(error instanceof Error)) throw error
      errors.push(error.message)
    }
  }
  // where both hold, the thumb goes to the target's +y side, else +z, else +x, not to whichever is tried first. The
  // way the pads close says which that likely is, to try first; where the grip found is not it, the other is tried.
  // Where neither side is the thumb's more, as when it lies along the approach, the hand keeps the first way round
  const sides = turns.map((t) => counted(thumbside.clone().applyQuaternion(t).transformDirection(inverse)))
  const [one, other] = sides.length > 1 && preferred(sides) > 0 ? [...turns].reverse() : turns
  const first = attempt(one)
  if (!other || !first) return first ?? (other && attempt(other)) ?? fail(errors)
  // the side the thumb ended on, from the fingers' bones, past a finger's thickness: thin things leave little between
  const { contacts } = first
  const bone = (e: Element) => contacts[e].at.clone().addScaledVector(contacts[e].normal, thick)
  const side = bone('thumb').sub(mean((fingers.length ? fingers : FINGERS.slice(1)).map(bone)))
  const beyond = (v: Vector3) => v.toArray().map((c) => (Math.abs(c) < thick ? 0 : c))
  const along = toward.clone().transformDirection(inverse)
  const better = preferred([side, along.multiplyScalar(2 * side.dot(along)).sub(side)].map(beyond))
  return ((better > 0 || (!better && other === turns[0])) && attempt(other)) || first
}

const fail = (errors: string[]): never => {
  throw new Error([...new Set(errors)].join('; turned over, '))
}

/** Puts a hand in a grip's pose and the target in it: moving the target if it hangs from the hand, else the hand */
export function hold(hand: Hand, target: Object3D, { position, quaternion, pose }: Grip) {
  hand.pose(pose)
  hand.bone.updateWorldMatrix(true, false)
  target.updateWorldMatrix(true, false)
  const sizes = target.getWorldScale(new Vector3()).divide(hand.bone.getWorldScale(new Vector3()))
  const inHand = new Matrix4().compose(position, quaternion, sizes)
  const [moved, world] = hand.bone.getObjectById(target.id)
    ? [target, hand.bone.matrixWorld.clone().multiply(inHand)]
    : [hand.bone, target.matrixWorld.clone().multiply(inHand.invert())]
  if (moved.parent) world.premultiply(moved.parent.matrixWorld.clone().invert())
  world.decompose(moved.position, moved.quaternion, moved.scale)
  moved.updateMatrixWorld(true)
}
