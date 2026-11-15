import { Matrix4, type Object3D, Quaternion, Vector3 } from 'three'
import { all, angles, check, each, ELEMENTS, type Element, FINGERS, fist, flat, type Hand, lerp } from './hand'
import { type Finger, limits, part, type Pose, relaxed, type Segment, square } from './hand'
import { surface } from './surface'
import { apart, bisect, type Contact, samples, Touch } from './touch'

/** how a hand holds a target: its place in the hand bone's frame, the pose, and each element's contact, in its frame.
 * For a debug view, what was asked and how it came out: each statement's point, side and elements in the target's
 * frame, the target's long way (`round`: it has none, and the arm chose the roll), how far it is from holding (0:
 * holds), and a finger's half thickness (m) and the target's world scale, when the hand gripped */
export type Grip = {
  target: Object3D
  position: Vector3
  quaternion: Quaternion
  pose: Pose
  contacts: Contacts
  asked: Asked[]
  roll: { long: Vector3; round: boolean }
  fault: number
  radius: number
  scale: number
}
type Contacts = Record<Element, Contact>
type Asked = { at: Vector3; from?: Vector3; using: readonly Element[] }

/** what a grip says: where on the target, the side the hand comes from, what takes part, and how the rest is held */
export type Statement = { at: Vector3; from?: Vector3; using?: readonly Element[]; start?: Pose | Grip }

/** how far off level with the fingers' pads the thumb's may land and squeeze, not shear: skin rolling, about 3 mm */
const PRESS = 0.3
/** how hard skin pulls along a smooth thing at most, for how hard it presses: how far a squeeze may slant, unsheared */
const FRICTION = 0.5
/** how little a target's widths across the approach differ, of their size, for it to count as round */
const ROUND = 0.05

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
 * whose placement is kept. Where the hand cannot hold as stated it gives the nearest it can; it throws only for a
 * statement that says nothing to hold by. */
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
  const inverse = target.matrixWorld.clone().invert()
  /** a finger's half thickness in the target's frame */
  const thick = radius * inverse.getMaxScaleOnAxis()
  const asked = [...(earlier?.asked ?? []), { at: at.clone(), from: from?.clone(), using }]
  const roll = earlier ? { ...earlier.roll } : { long: new Vector3(), round: false }
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
  /** the bones of a pose placed so, but for the palm and those `but` names */
  const rods = (pose: Pose, place: Matrix4, but = (_: Element) => false) =>
    hand.segments(pose, place).filter((g) => g.element !== 'palm' && !but(g.element))

  /** Closing is enclosing. The fingers taking part close one by one, each kept from those before, and in a composed
   * grip from what it holds already. What is left out then keeps its pose where the target and those fingers allow,
   * else moves the least that clears: opening, folding, or for the thumb standing out to its side. The thumb, taking
   * part, closes last, from standing out of the palm, lowered toward its side as far as the target is in the way,
   * folding till each bone meets something. Without the palm its tip presses instead, from where it reached, on where
   * the fingers touch (nearest `near`) mirrored through `middle` */
  const close = (place: Matrix4, middle: Vector3, near?: Vector3) => {
    const pose: Pose = { ...held }
    for (const [k, f] of fingers.entries()) {
      const kept = (e: Element) => fingers.slice(0, k).some((g) => g === e) || (earlier && !using.includes(e))
      const others = rods(pose, place, (e) => !kept(e))
      // what a composed grip adds reaches for its point from its knuckle's side; a fresh grip's fingers wrap the core
      const knuckle = touch.of(f)[0].a.clone().applyMatrix4(place)
      const out = knuckle.sub(skin.nearest(point).at).normalize()
      const reached = earlier && touch.reach(f, place, pose, point, out, others)
      const curled = () => touch.curl(f, place, pose, core, across / 2, others)
      const closed = () => touch.close(f, place, pose, angles(ready[f]), angles(fist[f]), others)
      pose[f] = part(reached || (palm ? curled() : closed()))
    }
    const taking = rods(pose, place, (e) => !fingers.some((g) => g === e))
    for (const f of FINGERS.filter((f) => !using.includes(f))) {
      const now = angles(pose[f])
      if (!touch.bones(f, now, pose, place).some((g) => touch.sinks(g, taking))) continue
      const ways = [angles(flat[f]), angles(fist[f]), ...(f === 'thumb' ? [splayed] : [])].flatMap((to) => {
        const share = touch.clear(f, place, pose, now, to, taking)
        return share === undefined ? [] : [lerp(now, to, share)]
      })
      const moved = (values: number[]) => touch.travel(f, now, values)
      if (ways.length) pose[f] = part(ways.reduce((a, b) => (moved(b) < moved(a) ? b : a)))
    }
    if (!thumb) return pose
    const others = rods(pose, place, (e) => e === 'thumb')
    if (fingers.length && !palm) {
      const contacts = fingers.map((f) => touch.contact(pose, place, f, near))
      const theirs = mean(contacts.map((c) => c.at))
      const out = mean(contacts.map((c) => c.normal.clone().negate())).normalize()
      const aim = theirs.addScaledVector(out, -2 * theirs.clone().sub(middle).dot(out))
      pose.thumb = part(touch.press('thumb', place, pose, aim, out, others, angles((earlier ? pose : ready).thumb)))
      return pose
    }
    const up = [0, thumbs[1][1], 0, 0]
    const open = lerp(up, splayed, touch.clear('thumb', place, pose, up, splayed, []) ?? 1)
    const shut = [...angles(fist.thumb).slice(0, 2), thumbs[2][1], thumbs[3][1]]
    pose.thumb = part(touch.close('thumb', place, pose, open, shut, others))
    return pose
  }

  /** how far an element taking part is from holding: sunk in, or short, unless it is the thumb resting on the fingers
   * round a handle, or a finger closed as far as its fist or its neighbours let it round something within its
   * thickness */
  const missing = (e: Element, pose: Pose, place: Matrix4, { gap }: Contact) => {
    if (gap < -fine) return -gap
    if (gap <= fine) return 0
    const rest = rods(pose, place, (o) => o === 'thumb')
    const thumbs = rods(pose, place).filter((g) => g.element === 'thumb' && g.bone > 0)
    const rests = palm && e === 'thumb' && thumbs.some((g) => apart(g, rest) <= fine)
    const neighbours = rods(pose, place, (o) => o === e || o === 'thumb')
    const stopped = rods(pose, place).some((g) => g.element === e && apart(g, touch.beside(g, neighbours)) <= fine)
    const fisted = (finger: Finger) => pose[finger].bend.every((v, i) => v === fist[finger].bend[i])
    const closed = e !== 'palm' && e !== 'thumb' && gap <= radius && (stopped || fisted(e))
    return rests || closed ? 0 : gap
  }

  /** The grip a pose and placement make, and how far it is from holding: by how much what takes part misses, what is
   * left out sinks in, the thumb comes round to the fingers' side, and a squeeze is off level */
  const finish = (place: Matrix4, pose: Pose) => {
    check(pose)
    // a finger's side along a flat thing touches all along it: where it squeezes is across from the thumb
    const near = pinch ? touch.contact(pose, place, 'thumb').at : undefined
    const contacts = all((e) => touch.contact(pose, place, e, near))
    let fault = 0
    for (const e of ELEMENTS)
      fault += using.includes(e) ? missing(e, pose, place, contacts[e]) : Math.max(0, -contacts[e].gap - fine)
    const pushing = fingers.filter((f) => contacts[f].gap <= fine)
    const squeeze = mean(pushing.map((f) => contacts[f].normal)).normalize()
    const opposed = contacts.thumb.normal.angleTo(squeeze)
    const holds = thumb && pushing.length && contacts.thumb.gap <= fine
    if (holds) fault += Math.max(0, Math.PI / 2 - opposed) * radius
    // without the palm the thumb squeezes the target against the fingers' pads, directly across it from their middle
    const theirs = mean(pushing.map((f) => contacts[f].at))
    const off = contacts.thumb.at.clone().sub(theirs).projectOnPlane(squeeze).length()
    if (holds && !palm) fault += Math.max(0, off - PRESS * radius - FRICTION * contacts.thumb.at.distanceTo(theirs))
    const [position, quaternion] = [new Vector3(), new Quaternion()]
    place.clone().invert().multiply(target.matrixWorld).decompose(position, quaternion, new Vector3())
    const local = (e: Element) => {
      const { at, gap, normal } = contacts[e]
      return { at: target.worldToLocal(at.clone()), gap, normal: normal.clone().transformDirection(inverse) }
    }
    const scale = 1 / inverse.getMaxScaleOnAxis()
    return { grip: { target, position, quaternion, pose, contacts: all(local), asked, roll, fault, radius, scale }, fault }
  }

  const thumbs = limits('thumb')
  /** the thumb standing out to its side, in the palm's plane */
  const splayed = [thumbs[0][1], 0, 0, 0]
  if (earlier) {
    const turn = target.getWorldQuaternion(new Quaternion()).multiply(earlier.quaternion.clone().invert())
    const place = placed(turn, earlier.position, target.getWorldPosition(new Vector3()))
    return finish(place, close(place, point)).grip
  }
  if (!from?.lengthSq()) throw new Error('a grip must say which side the hand comes from')

  // the line along the approach through the point enters the target; from `far` back no part of the hand meets it.
  // A point the line misses, or one pinched, is taken inside
  const toward = from.clone().transformDirection(target.matrixWorld).negate()
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
  // a target as wide every way across the approach has no long way: the hand lies on it as the arm comes to it, the
  // fingers going on away from the shoulder, unless the arm comes along the approach itself
  const shoulder = hand.bone.parent?.parent
  const out = shoulder ? point.clone().sub(shoulder.getWorldPosition(new Vector3())) : new Vector3()
  const reaching = out.clone().projectOnPlane(toward)
  const onward =
    !pinch && Math.hypot(xx - yy, 2 * xy) < ROUND * (xx + yy) && reaching.length() > out.length() / 2
      ? reaching.normalize()
      : undefined
  // a pinch squeezes the thinnest way across, as a cube's faces and not its corners; a palm lies along the target
  const long = onward
    ? new Vector3().crossVectors(toward, onward)
    : way(pinch ? thinnest + Math.PI / 2 : Math.atan2(2 * xy, xx - yy) / 2)
  Object.assign(roll, { long: long.clone().transformDirection(inverse), round: !!onward })
  const thin = new Vector3().crossVectors(toward, long)
  const across = width(thin)
  // a pinch's pads land on the faces either side of the point across the thin direction
  const aside = (reaches(thin) - reaches(thin.clone().negate())) / 2
  const middle = pinch ? centre.clone().addScaledVector(thin, aside) : centre
  // the fingers close over the target's core: its long line through the middle, short of its ends by half its width
  const core = [long, long.clone().negate()].map((v) =>
    middle.clone().addScaledVector(v, Math.max(0, reaches(v) - across / 2)),
  )

  /** the way a finger's pad faces in a pose: where its tip goes as its last joint folds on */
  const facing = (f: Finger, pose: Pose) => {
    const [g, h] = [0, 1e-3].map((d) => touch.bones(f, [...angles(pose[f]).slice(0, 3), pose[f].bend[2] + d], pose)[2])
    return square(h.b.clone().sub(g.b), g.b.clone().sub(g.a).normalize())
  }
  // The fingers close from flat as the thumb, turned out, folds to meet them, till the pads come as near the palm's
  // middle as the target is thick: their line is then the target's long way. A pinch's fingers, spread as when relaxed
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
    return { near, line, thumbside: tip.sub(mean(pads)), pose, squeeze, contact: theirs }
  }
  const steps = Math.ceil((4 * touch.length('middle')) / spacing)
  const k = Array.from({ length: steps }, (_, k) => k).find((k) => closing(k / steps).near) ?? steps
  const { line, thumbside, pose: closed, squeeze, contact } = closing(k / steps)
  // Without the palm the hand is behind the target, the fingers pointing the way it comes: a press's relaxed, its palm
  // across the thin way; a pinch's curled in as above, squeezing the target from their pads' side
  const ready = each((f) => (!using.includes(f) ? held : pinch ? closed : relaxed)[f])
  const leading = hand.segments(ready).filter((g) => (fingers.length ? fingers : using).includes(g.element))
  const ends = leading.filter((g) => g.bone === 2)
  const knuckles = leading.filter((g) => g.bone === 0).map((g) => g.a)
  const pointing = new Vector3().subVectors(mean(ends.map((g) => g.b)), mean(knuckles)).normalize()
  const crossing = pinch ? squeeze : square(hand.normal, pointing)
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

  /** The grip with the hand turned so. With the palm, it comes in along the approach till the palm touches, on the
   * crease, and the fingers close round. A press comes in till the pads touch. A pinch's target comes in across from
   * the thumb till it meets the fingers, and the thumb goes across it */
  const solve = (turn: Quaternion) => {
    if (palm) {
      const place = come(turn, seat, point, held, (e) => e === 'palm')
      return finish(place, close(place, middle))
    }
    if (!pinch) return finish(come(turn, mean(ends.map((g) => g.b)), entry, ready), ready)
    const at = (t: number) => placed(turn, contact.clone().addScaledVector(crossing, t), middle)
    const clear = (t: number) => fingers.every((f) => touch.contact(ready, at(t), f).gap >= 0)
    const t = bisect(2 * (hand.radius + across / scale), 0, clear, fine / scale / 2)[0]
    return finish(at(t), close(at(t), middle, contact.clone().applyMatrix4(at(t))))
  }

  // the palm faces along the approach, the target's long way along the pads' line; without it the fingers point along
  // the approach, the thumb (or a press's palm) across the thin way. The target's bulk goes out on the thumb's side;
  // within a finger's breadth of the point it does not say which way round the hand goes, and both may hold
  const base = palm
    ? turning(hand.normal, line, toward, long)
    : turning(square(pointing, crossing), crossing, toward, thin)
  const bulk = skin.centroid.clone().sub(point).projectOnPlane(toward)
  const over = new Quaternion().setFromAxisAngle(toward, Math.PI)
  const turns = [base, base.clone().premultiply(over)].filter(
    (t) => bulk.length() <= breadth || hand.thumbward.clone().applyQuaternion(t).dot(bulk) >= 0,
  )
  // where both hold, the thumb goes to the target's +y side, else +z, else +x, not to whichever is tried first. The
  // way the pads close says which that likely is, to try first; where the grip found is not it, or does not hold, the
  // other is tried, and the nearer to holding kept. Where neither side is the thumb's more, as when it lies along the
  // approach, the hand keeps the first way round
  if (onward) {
    const led = turns.filter((t) => pointing.clone().applyQuaternion(t).dot(onward) > 0)
    if (led.length === 1) return solve(led[0]).grip
  }
  const sides = turns.map((t) => counted(thumbside.clone().applyQuaternion(t).transformDirection(inverse)))
  const [one, other] = sides.length > 1 && preferred(sides) > 0 ? [...turns].reverse() : turns
  const first = solve(one)
  if (!other) return first.grip
  // the side the thumb ended on, from the fingers' bones, past a finger's thickness: thin things leave little between
  const { contacts } = first.grip
  const bone = (e: Element) => contacts[e].at.clone().addScaledVector(contacts[e].normal, thick)
  const side = bone('thumb').sub(mean((fingers.length ? fingers : FINGERS.slice(1)).map(bone)))
  const beyond = (v: Vector3) => v.toArray().map((c) => (Math.abs(c) < thick ? 0 : c))
  const along = toward.clone().transformDirection(inverse)
  const better = preferred([side, along.multiplyScalar(2 * side.dot(along)).sub(side)].map(beyond))
  if (!first.fault && !(better > 0 || (!better && other === turns[0]))) return first.grip
  const second = solve(other)
  return (first.fault ? second.fault < first.fault : !second.fault) ? second.grip : first.grip
}

/** Puts a hand in a grip's pose and the target in it: moving the target if it hangs from the hand, else the hand */
export function hold(hand: Hand, target: Object3D, held: Grip) {
  const { position, quaternion, pose } = held
  hand.pose(pose)
  target.userData.grip = held // for a debug view to find
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
