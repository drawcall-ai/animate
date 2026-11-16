import { Matrix4, type Object3D, Quaternion, Vector3 } from 'three'
import { all, angles, check, each, ELEMENTS, type Element, FINGERS, fist, type Hand, lerp } from './hand'
import { type Finger, limits, part, type Pose, relaxed, type Segment, square } from './hand'
import { surface } from './surface'
import { apart, bisect, type Contact, samples, SPLAYED, Touch, UP } from './touch'

/** How a hand holds a target, fixed for as long as it holds it: where the hand bone is in the target's frame
 * (`position`, `quaternion`), the fingers' `pose`, where each element meets the target (`contacts`, in its frame), and
 * how far the hand is from holding it (`fault`, 0: holds) */
export type Grip = { position: Vector3; quaternion: Quaternion; pose: Pose; contacts: Record<Element, Contact>; fault: number }

/** What a grip says, in the target's frame: the point (`at`), the side the hand comes from (`from`) and the side the
 * thumb goes to (`thumb`, the part of it across `from`), which together fix how the hand is turned; the palm and
 * fingers `using` (all by default); and how the rest is held (`start`, `relaxed` by default). Started from an earlier
 * grip of the same target, the hand stays where that one has it, `from` and `thumb` are not needed, and only what is
 * `using` moves: a finger taking part alone goes to `at`, as onto a trigger */
export type Statement = { at: Vector3; from?: Vector3; thumb?: Vector3; using?: readonly Element[]; start?: Pose | Grip }

/** how far off level with the fingers' pads the thumb's may land and squeeze, not shear: skin rolling, about 3 mm */
const PRESS = 0.3
/** how hard skin pulls along a smooth thing at most, for how hard it presses: how far a squeeze may slant, unsheared */
const FRICTION = 0.5

const shift = (place: Matrix4, by: Vector3) => new Matrix4().makeTranslation(by).multiply(place)
const mean = (points: Vector3[]) => points.reduce((sum, p) => sum.addScaledVector(p, 1 / points.length), new Vector3())
/** where a finger's last bone presses: its pad, two thirds of the way to the tip */
const pad = ({ a, b }: Segment) => a.clone().lerp(b, 2 / 3)
/** a rotation that turns the directions `x`, `y` (square to it) into `toX`, `toY` */
const turning = (x: Vector3, y: Vector3, toX: Vector3, toY: Vector3) => {
  const basis = (x: Vector3, y: Vector3) => new Matrix4().makeBasis(x, y, new Vector3().crossVectors(x, y))
  return new Quaternion().setFromRotationMatrix(basis(toX, toY).multiply(basis(x, y).transpose()))
}
/** a hand against a target as it stands in the world: throws for a statement with nothing to hold, or to hold by */
function against(hand: Hand, target: Object3D, using: readonly Element[], start: Pose) {
  if (!using.length) throw new Error('a grip needs the palm or a finger to take part')
  check(start)
  target.updateWorldMatrix(true, true)
  hand.bone.updateWorldMatrix(true, false)
  return new Touch(hand, surface(target), hand.size())
}

/** The fingers fitted to the target from where the hand is: `place` is the hand bone in the world, and nothing here
 * moves it. Closing is enclosing. The fingers taking part close one by one from straight, each kept from those before,
 * till each bone meets something; a finger alone, given a `point` (world), reaches for it instead. What is left out
 * keeps its pose in `held` where the target and those fingers allow, else moves the least that clears. The thumb,
 * taking part, closes last: with the palm from standing out of it, lowered toward its side as far as the target is in
 * the way, folding till each bone meets something; with fingers but no palm its tip presses the target against their
 * pads, from across it. Nothing closes through the target: a finger the target is in the way of gets out of its way,
 * and one no pose brings out, as when the wrist puts its knuckle in the target, is held where it is in it the least.
 * The contacts are in the world */
/** the fingers on a target, before they are taken into its frame */
type Fitted = Omit<Grip, 'position' | 'quaternion'>

function fit(touch: Touch, place: Matrix4, using: readonly Element[], held: Pose, point?: Vector3): Fitted {
  const { hand, skin, radius, fine } = touch
  const fingers = FINGERS.filter((f) => f !== 'thumb' && using.includes(f))
  const [thumb, palm] = [using.includes('thumb'), using.includes('palm')]
  const pinch = !palm && thumb && fingers.length > 0
  /** the bones of a pose, but for the palm and those `but` names */
  const rods = (pose: Pose, but = (_: Element) => false) =>
    hand.segments(pose, place).filter((g) => g.element !== 'palm' && !but(g.element))
  const pose: Pose = { ...held }
  for (const [k, f] of fingers.entries()) {
    const others = rods(pose, (e) => !fingers.slice(0, k).some((g) => g === e))
    // without the palm the fingers lie side by side, spread as when relaxed
    const spread = palm ? 0 : relaxed[f].spread
    const alone = point && !palm && !thumb
    pose[f] = part(alone ? touch.reach(f, place, pose, point, others) : touch.wrap(f, place, pose, spread, others))
  }
  const taking = rods(pose, (e) => !fingers.some((g) => g === e))
  for (const f of FINGERS.filter((f) => !using.includes(f))) pose[f] = part(touch.free(f, place, pose, taking))
  const thumbs = limits('thumb')
  const others = rods(pose, (e) => e === 'thumb')
  if (pinch) {
    // each pad's contact taken through the target to its other side: there the thumb's tip presses
    const pads = fingers.map((f) => touch.contact(pose, place, f, pad(rods(pose).filter((g) => g.element === f)[2])))
    const out = mean(pads.map((c) => c.normal.clone().negate())).normalize()
    const across = (c: Contact) => {
      const through = skin.cast(c.at.clone().addScaledVector(out, fine), out)
      return c.at.clone().addScaledVector(out, Number.isFinite(through) ? through + fine : 0)
    }
    pose.thumb = part(touch.press('thumb', place, pose, mean(pads.map(across)), out, others, angles(fist.thumb)))
  } else if (thumb) {
    const open = lerp(UP, SPLAYED, touch.clear('thumb', place, pose, UP, SPLAYED, []).share)
    const shut = [...angles(fist.thumb).slice(0, 2), thumbs[2][1], thumbs[3][1]]
    pose.thumb = part(touch.close('thumb', place, pose, open, shut, others))
  }
  check(pose)

  /** how far an element taking part is from holding: sunk in, or short, unless it is the thumb resting on the fingers
   * round a handle, or a finger closed as far as its fist or its neighbours let it round something within its
   * thickness */
  const missing = (e: Element, { gap }: Contact) => {
    if (gap < -fine) return -gap
    if (gap <= fine) return 0
    const rest = rods(pose, (o) => o === 'thumb')
    const ends = rods(pose).filter((g) => g.element === 'thumb' && g.bone > 0)
    const rests = palm && e === 'thumb' && ends.some((g) => apart(g, rest) <= fine)
    const neighbours = rods(pose, (o) => o === e || o === 'thumb')
    const stopped = rods(pose).some((g) => g.element === e && apart(g, touch.beside(g, neighbours)) <= fine)
    const fisted = (finger: Finger) => pose[finger].bend.every((v, i) => v === fist[finger].bend[i])
    const closed = e !== 'palm' && e !== 'thumb' && gap <= radius && (stopped || fisted(e))
    return rests || closed ? 0 : gap
  }

  // how far from holding: by how much what takes part misses, what is left out sinks in, the thumb comes round to the
  // fingers' side, and a squeeze is off level. A finger's side along a flat thing touches all along it: where it
  // squeezes is across from the thumb
  const near = pinch ? touch.contact(pose, place, 'thumb').at : undefined
  const contacts = all((e) => touch.contact(pose, place, e, near))
  let fault = 0
  for (const e of ELEMENTS)
    fault += using.includes(e) ? missing(e, contacts[e]) : Math.max(0, -contacts[e].gap - fine)
  const pushing = fingers.filter((f) => contacts[f].gap <= fine)
  const squeeze = mean(pushing.map((f) => contacts[f].normal)).normalize()
  const opposed = contacts.thumb.normal.angleTo(squeeze)
  const holds = thumb && pushing.length && contacts.thumb.gap <= fine
  if (holds) fault += Math.max(0, Math.PI / 2 - opposed) * radius
  // without the palm the thumb squeezes the target against the fingers' pads, directly across it from their middle
  const theirs = mean(pushing.map((f) => contacts[f].at))
  const off = contacts.thumb.at.clone().sub(theirs).projectOnPlane(squeeze).length()
  if (holds && !palm) fault += Math.max(0, off - PRESS * radius - FRICTION * contacts.thumb.at.distanceTo(theirs))
  return { pose, contacts, fault }
}

/** Finds how a hand grips a target, as a statement says: where the hand bone goes on the target and the fingers'
 * pose there, closed onto it with nothing through it. Where the hand cannot hold as stated it gives the nearest grip it
 * can, clear of the target. The result is relative to the target, to be kept as it is while the hand holds it: hang the
 * hand there, or the target from the hand. Throws only for a statement it cannot read: a target with no mesh, nothing
 * taking part, a fresh grip with no side to come from. */
export function grip(hand: Hand, target: Object3D, { at, from, thumb: side, using = ELEMENTS, start = relaxed }: Statement): Grip {
  const earlier = 'pose' in start ? start : undefined
  const held = earlier?.pose ?? (start as Pose)
  const touch = against(hand, target, using, held)
  const { skin, radius, fine, spacing, scale } = touch
  const inverse = target.matrixWorld.clone().invert()
  /** the grip a hand bone placed so in the world makes: the place and the contacts taken into the target's frame */
  const relative = (place: Matrix4, { pose, contacts, fault }: Fitted): Grip => {
    const [position, quaternion] = [new Vector3(), new Quaternion()]
    inverse.clone().multiply(place).decompose(position, quaternion, new Vector3())
    const local = ({ at, gap, normal }: Contact) => {
      return { at: at.clone().applyMatrix4(inverse), gap, normal: normal.clone().transformDirection(inverse) }
    }
    return { position, quaternion, pose, contacts: all((e) => local(contacts[e])), fault }
  }
  if (earlier) {
    const size = new Vector3().setScalar(scale / target.getWorldScale(new Vector3()).x)
    const place = target.matrixWorld.clone().multiply(new Matrix4().compose(earlier.position, earlier.quaternion, size))
    return relative(place, fit(touch, place, using, held, target.localToWorld(at.clone())))
  }
  if (!from?.lengthSq()) throw new Error('a grip must say which side the hand comes from')
  const toward = from.clone().transformDirection(target.matrixWorld).negate()
  const thumbward = side?.clone().transformDirection(target.matrixWorld).projectOnPlane(toward)
  if (!thumbward || thumbward.length() < 1e-6) throw new Error('a grip must say which side the thumb goes to, across `from`')
  thumbward.normalize()
  /** how wide a finger is: what a grip may be off by and still meet what it aims at */
  const breadth = 2 * radius
  /** a point outside the target taken in to the middle of the target's thickness under its nearest point */
  const inside = (p: Vector3) => {
    if (skin.depth(p) <= 0) return p
    const { at } = skin.nearest(p)
    const into = at.clone().sub(p).normalize()
    const through = skin.cast(at.clone().addScaledVector(into, fine), into)
    return at.addScaledVector(into, Number.isFinite(through) ? through / 2 : 0)
  }
  let point = target.localToWorld(at.clone())
  const fingers = FINGERS.filter((f) => f !== 'thumb' && using.includes(f))
  const [thumb, palm] = [using.includes('thumb'), using.includes('palm')]
  const pinch = !palm && thumb && fingers.length > 0
  const placed = (turn: Quaternion, mine: Vector3, there: Vector3) => {
    const place = new Matrix4().compose(new Vector3(), turn, new Vector3(scale, scale, scale))
    return place.setPosition(there.clone().sub(mine.clone().applyMatrix4(place)))
  }
  const thumbs = limits('thumb')

  // the line along the approach through the point enters the target; from `far` back no part of the hand meets it.
  // A point the line misses, or one pinched, is taken inside
  const span = Math.max(...touch.rest.map((s) => s.b.length())) * scale
  const reach = (p: Vector3) => p.distanceTo(skin.bounds.center) + skin.bounds.radius + span
  const enters = (p: Vector3) => skin.cast(p.clone().addScaledVector(toward, -reach(p)), toward)
  if (pinch || enters(point) === Infinity) point = inside(point)
  const far = reach(point)
  const entry = point.clone().addScaledVector(toward, enters(point) - far)
  const through = skin.cast(entry.clone().addScaledVector(toward, 1e-6), toward)
  // the palm and a lone press meet the target's surface, a pinch holds it at the point
  const centre = pinch
    ? point.clone()
    : entry.clone().addScaledVector(toward, Number.isFinite(through) ? through / 2 : 0)
  // the target's widths through its centre: a pinch squeezes it across the thumb's side, a palm closes round it across
  // the line of the knuckles, which runs to the thumb's side
  const reaches = (u: Vector3) => Math.min(far, skin.cast(centre, u))
  const width = (u: Vector3) => reaches(u) + reaches(u.clone().negate())
  const thin = pinch ? thumbward : new Vector3().crossVectors(toward, thumbward)
  const across = width(thin)
  // a pinch's pads land on the faces either side of the point across the thin direction
  const aside = (reaches(thin) - reaches(thin.clone().negate())) / 2
  const middle = pinch ? centre.clone().addScaledVector(thin, aside) : centre
  /** the way a finger's pad faces in a pose: where its tip goes as its last joint folds on */
  const facing = (f: Finger, pose: Pose) => {
    const [g, h] = [0, 1e-3].map((d) => touch.bones(f, [...angles(pose[f]).slice(0, 3), pose[f].bend[2] + d], pose)[2])
    return square(h.b.clone().sub(g.b), g.b.clone().sub(g.a).normalize())
  }
  // The fingers close from flat as the thumb, turned out, folds to meet them, till the pads come as near the palm's
  // middle as the target is thick. A pinch's fingers, spread as when relaxed
  // to lie side by side, curl in only till the thumb can close onto the first two's pads across the target, an O the
  // target interrupts: so they bend at every joint and face the thumb, however thin the target
  const palmMiddle = mean(touch.of('palm').flatMap((s) => [s.a, s.b]))
  const up = touch.of('palm')[1].b.clone().normalize()
  const closing = (s: number) => {
    const pose: Pose = { ...held, thumb: part([thumbs[0][1], fist.thumb.bend[0], thumbs[2][1] * s, thumbs[3][1] * s]) }
    for (const f of FINGERS.slice(1))
      pose[f] = part([(pinch ? relaxed : fist)[f].spread, ...fist[f].bend.map((v) => v * s)])
    const pads = FINGERS.slice(1).map((f) => pad(touch.bones(f, angles(pose[f]), pose)[2]))
    const tip = touch.bones('thumb', angles(pose.thumb), pose)[2].b
    const taking = pads.filter((_, k) => !fingers.length || using.includes(FINGERS[k + 1]))
    const theirs = mean(palm ? taking : taking.slice(0, 2))
    const line = square(pads[0].clone().sub(pads[3]), hand.normal)
    const squeeze = mean(fingers.slice(0, 2).map((f) => facing(f, pose))).normalize()
    const goal = theirs.clone().addScaledVector(squeeze, 2 * hand.radius + across / scale)
    if (pinch) pose.thumb = part(touch.toward('thumb', new Matrix4(), pose, goal, angles(fist.thumb)))
    const reached = touch.bones('thumb', angles(pose.thumb), pose)[2].b.distanceTo(goal) * scale <= PRESS * radius
    const near = pinch ? reached : theirs.distanceTo(palm ? palmMiddle : tip) * scale <= across + breadth
    return { near, line, pose, squeeze, contact: theirs }
  }
  const steps = Math.ceil((4 * touch.length('middle')) / spacing)
  const k = Array.from({ length: steps }, (_, k) => k).find((k) => closing(k / steps).near) ?? steps
  const { line, pose: closed, squeeze, contact } = closing(k / steps)
  // Without the palm the hand is behind the target, the fingers pointing the way it comes: a press's relaxed; a
  // pinch's curled in as above, squeezing the target from their pads' side
  const ready = each((f) => (!using.includes(f) ? held : pinch ? closed : relaxed)[f])
  const leading = hand.segments(ready).filter((g) => (fingers.length ? fingers : using).includes(g.element))
  const ends = leading.filter((g) => g.bone === 2)
  const knuckles = leading.filter((g) => g.bone === 0).map((g) => g.a)
  const pointing = new Vector3().subVectors(mean(ends.map((g) => g.b)), mean(knuckles)).normalize()
  const crossing = pinch ? squeeze : square(hand.thumbward, pointing)
  // a handle seats in the crease: on the palm's middle line, level with where the middle finger's middle bone ends in
  // a fist. Nearer the wrist the thumb no longer comes round a thick handle, nearer the knuckles the first bones cannot
  // stand along a thin one; a thing deeper than a finger is long seats on the palm's middle, the fingers hooked over
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

  /** The hand turned so, where it holds. With the palm, it comes in along the approach till the palm touches, on the
   * crease. A press comes in till the pads touch. A pinch's target comes in across from the thumb till it meets the
   * fingers. The fingers are fitted from there; where something is sunk in still, which no pose of the fingers
   * clears, the hand backs out along the approach, twice as far each time, till nothing is, and then comes in again
   * as far as it stays so */
  const solve = (turn: Quaternion) => {
    const beside = (t: number) => placed(turn, contact.clone().addScaledVector(crossing, t), middle)
    const clear = (t: number) => fingers.every((f) => touch.contact(ready, beside(t), f).gap >= 0)
    const place = palm
      ? come(turn, seat, point, held, (e) => e === 'palm')
      : pinch
        ? beside(bisect(2 * (hand.radius + across / scale), 0, clear, fine / scale / 2)[0])
        : come(turn, mean(ends.map((g) => g.b)), entry, ready)
    const fitted = (back: number) => {
      const at = shift(place, toward.clone().multiplyScalar(-back))
      const found = fit(touch, at, using, held, point)
      return { place: at, ...found, sunk: -Math.min(...ELEMENTS.map((e) => found.contacts[e].gap)) }
    }
    let [found, last, back] = [fitted(0), 0, 0]
    for (let step = found.sunk; found.sunk > fine && back < far; step *= 2) {
      ;[last, back] = [back, back + step]
      found = fitted(back)
    }
    return back ? fitted(bisect(back, last, (b) => fitted(b).sunk <= fine, (back - last) / 8)[0]) : found
  }

  // The hand is turned as stated: with the palm, it faces along the approach and the knuckles run to the thumb's
  // side; without it, the fingers point along the approach and the thumb is on its side of them
  const turn = palm
    ? turning(hand.normal, line, toward, thumbward)
    : turning(square(pointing, crossing), crossing, toward, thumbward)
  const { place, ...found } = solve(turn)
  return relative(place, found)
}
