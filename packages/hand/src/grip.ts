import { Matrix4, type Object3D, Quaternion, Vector3 } from "three"
import { fit, type Fitted, mean, pad, taking } from "./fit"
import {
  all,
  angles,
  check,
  each,
  type HandPart,
  HAND_PARTS,
  type Finger,
  FINGERS,
  type HandPose,
  fist,
  type Hand,
  limits,
  shapeOf,
  fromAngles,
  relaxed,
  square,
} from "./hand"
import { surface } from "./surface"
import { bisect, type Contact, samples, Touch } from "./touch"

/** How a hand holds an object, fixed for as long as it holds it. Nothing in it says the grip is good: a finger may end
 * against its neighbour short of the object, or lie straight along it. `describeGrip` puts it in words. */
export type Grip = {
  /** Where the hand bone is in the object's frame: hang the hand there, or attach the object to the hand bone so that this place is the bone's. */
  position: Vector3
  /** How the hand bone is turned in the object's frame. */
  quaternion: Quaternion
  /** The fingers' pose, for `hand.setPose`. */
  pose: HandPose
  /** What holds: the parts the grip used, and for a grip `on` an earlier one, that one's too. */
  using: readonly HandPart[]
  /** For each part, where it meets the object and what it ends against, in the object's frame. */
  contacts: Record<HandPart, Contact>
  /** For a finger taking part alone, how far its tip ends from `at` (m). */
  missedBy?: number
}

/** What a grip says, all in the object's frame: a fresh grip, or one `on` an earlier grip of the same object. */
export type GripOptions = {
  /**
   * The point the grip is about. With the palm: the point the hand takes hold of, on the object or in it; the palm
   * comes in along `approachFrom` through it to the surface, meeting it at the crease at the base of the fingers.
   * Without the palm: the point the thumb and fingers hold between them, in the object (a point outside is taken in).
   * A finger taking part alone: the point on the surface its tip goes to.
   */
  at: Vector3
  /** What takes part: the palm and fingers, all of them by default. */
  using?: readonly HandPart[]
} & (
  | {
      /** The direction from `at` to the side the hand comes from. With the palm, the palm faces the object from there; without it, the hand is behind the thing, fingertips leading. */
      approachFrom: Vector3
      /** The direction from `at` to the side of the object the thumb goes to; only its part across `approachFrom` counts. With `approachFrom` it fixes how the hand is turned. With the palm the knuckles run from the little finger to the index toward that side; without it the thumb squeezes the object across that side. */
      thumbToward: Vector3
      /** How the parts that take no part are held, as far as the object allows: `HandPose.relaxed` by default. */
      idlePose?: HandPose
      on?: never
    }
  | {
      /** An earlier grip of the same object: the hand stays where that one has it and the rest as it holds them, and only what is `using` moves. */
      on: Grip
      approachFrom?: never
      thumbToward?: never
      idlePose?: never
    }
)

/** how far off level with the fingers' pads the thumb's may land and squeeze, not shear: skin rolling, about 3 mm */
const PRESS = 0.3

const shift = (place: Matrix4, by: Vector3) => new Matrix4().makeTranslation(by).multiply(place)
/** a rotation that turns the directions `x`, `y` (square to it) into `toX`, `toY` */
const turning = (x: Vector3, y: Vector3, toX: Vector3, toY: Vector3) => {
  const basis = (x: Vector3, y: Vector3) => new Matrix4().makeBasis(x, y, new Vector3().crossVectors(x, y))
  return new Quaternion().setFromRotationMatrix(basis(toX, toY).multiply(basis(x, y).transpose()))
}
/** a hand meeting an object as it stands in the world: throws for nothing taking part, or a pose past a person's */
function meet(hand: Hand, object: Object3D, using: readonly HandPart[], idle: HandPose) {
  if (!using.length) throw new Error("a grip needs the palm or a finger to take part")
  check(idle)
  const shape = shapeOf(hand)
  object.updateWorldMatrix(true, true)
  shape.bone.updateWorldMatrix(true, false)
  return new Touch(shape, surface(object), shape.size())
}

/** Finds how a hand grips an object, as the options say: where the hand bone goes on the object and the fingers'
 * pose there, closed onto it with nothing through it. Where the hand cannot hold as stated it gives the nearest grip it
 * can, clear of the object. The result is relative to the object, to be kept as it is while the hand holds it: hang the
 * hand there, or the object from the hand. Throws only for options it cannot read: an object with no mesh, nothing
 * taking part, a zero `approachFrom`, or a `thumbToward` along it. */
export function grip(hand: Hand, object: Object3D, options: GripOptions): Grip {
  const { at, using = HAND_PARTS } = options
  const held = options.on?.pose ?? options.idlePose ?? relaxed
  const touch = meet(hand, object, using, held)
  const inverse = object.matrixWorld.clone().invert()
  /** the grip a hand bone placed so in the world makes: the place and the contacts taken into the object's frame */
  const relative = (place: Matrix4, { pose, contacts }: Fitted): Grip => {
    const [position, quaternion] = [new Vector3(), new Quaternion()]
    inverse.clone().multiply(place).decompose(position, quaternion, new Vector3())
    const local = (c: Fitted["contacts"][HandPart]) => {
      return { ...c, at: c.at.clone().applyMatrix4(inverse), normal: c.normal.clone().transformDirection(inverse) }
    }
    // a grip on an earlier one holds with what that one held with too
    const holding = HAND_PARTS.filter((part) => using.includes(part) || options.on?.using.includes(part))
    // where a finger alone reaches for `at`, how far its tip ends from it
    const { fingers, thumb, palm } = taking(using)
    const alone = fingers.length === 1 && !thumb && !palm ? touch.shape.segments(pose, place).find((g) => g.part === fingers[0] && g.bone === 2) : undefined
    const missedBy = alone && alone.b.clone().applyMatrix4(inverse).distanceTo(at)
    return { position, quaternion, pose, using: holding, contacts: all((part) => local(contacts[part])), missedBy }
  }
  if (options.on) {
    const size = new Vector3().setScalar(touch.scale / object.getWorldScale(new Vector3()).x)
    const { position, quaternion } = options.on
    const place = object.matrixWorld.clone().multiply(new Matrix4().compose(position, quaternion, size))
    return relative(place, fit(touch, place, using, held, object.localToWorld(at.clone())))
  }
  const { approachFrom, thumbToward } = options
  if (!approachFrom || !thumbToward)
    throw new Error("a grip must say which side the hand comes from (`approachFrom`) and the thumb goes to (`thumbToward`), or be `on` an earlier grip")
  if (!approachFrom.lengthSq()) throw new Error("a grip must say which side the hand comes from: `approachFrom` is zero")
  const toward = approachFrom.clone().transformDirection(object.matrixWorld).negate()
  const thumbward = thumbToward.clone().transformDirection(object.matrixWorld).projectOnPlane(toward)
  if (thumbward.length() < 1e-6) throw new Error("a grip must say which side the thumb goes to, across `approachFrom`: `thumbToward` lies along it")
  const way = approach(touch, using, held, object.localToWorld(at.clone()), toward, thumbward.normalize())
  const { palm, pinch } = taking(using)
  return relative(...settle(way, palm ? inPalm(way) : pinch ? pinched(way) : pressed(way)))
}

/** How a fresh grip comes to the object: what takes part and how the rest is held, the hand turned to come along
 * `toward` with its thumb on the `thumbward` side; the point it is about (a point the approach misses, or one pinched,
 * taken into the object); where the line along the approach through it enters the object and how far it then goes
 * through; `far`, how far back from there no part of the hand meets it; and the object's width across the way the hand
 * closes round it, about its `middle` */
type Approach = ReturnType<typeof approach>

function approach(touch: Touch, using: readonly HandPart[], held: HandPose, at: Vector3, toward: Vector3, thumbward: Vector3) {
  const { skin, fine, scale } = touch
  const { pinch } = taking(using)
  /** a point outside the object taken in to the middle of the object's thickness under its nearest point */
  const inside = (p: Vector3) => {
    if (skin.depth(p) <= 0) return p
    const { at } = skin.nearest(p)
    const into = at.clone().sub(p).normalize()
    const deep = skin.cast(at.clone().addScaledVector(into, fine), into)
    return at.addScaledVector(into, Number.isFinite(deep) ? deep / 2 : 0)
  }
  const span = Math.max(...touch.rest.map((s) => s.b.length())) * scale
  const clearing = (p: Vector3) => p.distanceTo(skin.bounds.center) + skin.bounds.radius + span
  const enters = (p: Vector3) => skin.cast(p.clone().addScaledVector(toward, -clearing(p)), toward)
  const point = pinch || enters(at) === Infinity ? inside(at) : at
  const far = clearing(point)
  const entry = point.clone().addScaledVector(toward, enters(point) - far)
  const through = skin.cast(entry.clone().addScaledVector(toward, 1e-6), toward)
  // the palm and a lone press meet the object's surface, a pinch holds it at the point
  const centre = pinch ? point.clone() : entry.clone().addScaledVector(toward, Number.isFinite(through) ? through / 2 : 0)
  // a pinch squeezes the object across the thumb's side, a palm closes round it across the line of the knuckles, which
  // runs to the thumb's side; a pinch's pads land on the faces either side of the point
  const reaches = (u: Vector3) => Math.min(far, skin.cast(centre, u))
  const thin = pinch ? thumbward : new Vector3().crossVectors(toward, thumbward)
  const across = reaches(thin) + reaches(thin.clone().negate())
  const middle = pinch ? centre.clone().addScaledVector(thin, (reaches(thin) - reaches(thin.clone().negate())) / 2) : centre
  return { touch, using, held, toward, thumbward, point, entry, through, far, across, middle }
}

/** the hand turned so, with its point `mine` (in its frame) at `there` (world) */
function placed({ touch }: Approach, turn: Quaternion, mine: Vector3, there: Vector3) {
  const place = new Matrix4().compose(new Vector3(), turn, new Vector3().setScalar(touch.scale))
  return place.setPosition(there.clone().sub(mine.clone().applyMatrix4(place)))
}

/** the hand turned so, `mine` on the approach through `there`, come in from far till what `meets` picks touches */
function come(way: Approach, turn: Quaternion, mine: Vector3, there: Vector3, pose: HandPose, meets: (part: HandPart) => boolean) {
  const { touch, toward, far, entry } = way
  const { shape, skin, radius, spacing, fine } = touch
  const back = shift(placed(way, turn, mine, there), toward.clone().multiplyScalar(-far))
  const points = shape.segments(pose, back).flatMap((g) => (meets(g.part) ? samples(g) : []))
  const clears = (d: number) => points.every((p) => skin.nearest(p.clone().addScaledVector(toward, d)).distance >= radius)
  let low = far - there.clone().sub(entry).dot(toward)
  while (!clears(low)) low -= spacing
  return shift(back, toward.clone().multiplyScalar(bisect(low, low + spacing, clears, fine)[0]))
}

/** With the palm: it faces along the approach, the knuckles running to the thumb's side, and comes in till it touches
 * on the crease. The line of the pads, which the knuckles' line is taken for, is where it lies once the fingers have
 * closed from flat till the pads come as near the palm's middle as the object is thick. A handle seats in the crease:
 * on the palm's middle line, level with where the middle finger's middle bone ends in a fist. Nearer the wrist the thumb
 * no longer comes round a thick handle, nearer the knuckles the first bones cannot stand along a thin one; a thing
 * deeper than a finger is long seats on the palm's middle, the fingers hooked over */
function inPalm(way: Approach) {
  const { touch, using, held, toward, thumbward, point, through, across } = way
  const { shape, radius, scale, spacing } = touch
  const { fingers } = taking(using)
  const palmMiddle = mean(touch.of("palm").flatMap((s) => [s.a, s.b]))
  const pads = (s: number) => {
    const pose = each((f) => fromAngles([fist[f].spread, ...fist[f].bend.map((v) => v * s)]))
    return FINGERS.slice(1).map((f) => pad(touch.bones(f, angles(pose[f]), pose)[2]))
  }
  const near = (s: number) => {
    const taking = pads(s).filter((_, k) => !fingers.length || fingers.includes(FINGERS[k + 1]))
    return mean(taking).distanceTo(palmMiddle) * scale <= across + 2 * radius
  }
  const steps = Math.ceil((4 * touch.length("middle")) / spacing)
  const closed = pads((Array.from({ length: steps }, (_, k) => k).find((k) => near(k / steps)) ?? steps) / steps)
  const line = square(closed[0].clone().sub(closed[3]), shape.normal)
  const up = touch.of("palm")[1].b.clone().normalize()
  const fold = shape.segments(fist).filter((g) => g.part === "middle")[1].b
  const level = through > touch.length("middle") ? 0 : fold.sub(palmMiddle).dot(up)
  const seat = palmMiddle.clone().addScaledVector(up, level).addScaledVector(shape.normal, shape.radius)
  return come(way, turning(shape.normal, line, toward, thumbward), seat, point, held, (part) => part === "palm")
}

/** A pinch: the hand behind the object, the fingers, spread as when relaxed to lie side by side, curled in only till
 * the thumb can close onto the first two's pads across the object, an O the object interrupts, so that they bend at
 * every joint and face the thumb however thin the object is. Turned so, the thumb on its side, the object comes in
 * across from the thumb till it meets the fingers */
function pinched(way: Approach) {
  const { touch, using, held, toward, thumbward, across, middle } = way
  const { shape, radius, scale, spacing, fine } = touch
  const { fingers } = taking(using)
  const thumbs = limits("thumb")
  /** the way a finger's pad faces in a pose: where its tip goes as its last joint folds on */
  const facing = (f: Finger, pose: HandPose) => {
    const [g, h] = [0, 1e-3].map((d) => touch.bones(f, [...angles(pose[f]).slice(0, 3), pose[f].bend[2] + d], pose)[2])
    return square(h.b.clone().sub(g.b), g.b.clone().sub(g.a).normalize())
  }
  const curled = (s: number) => {
    const pose: HandPose = { ...held, thumb: fromAngles([thumbs[0][1], fist.thumb.bend[0], thumbs[2][1] * s, thumbs[3][1] * s]) }
    for (const f of fingers) pose[f] = fromAngles([relaxed[f].spread, ...fist[f].bend.map((v) => v * s)])
    const theirs = mean(fingers.slice(0, 2).map((f) => pad(touch.bones(f, angles(pose[f]), pose)[2])))
    const squeeze = mean(fingers.slice(0, 2).map((f) => facing(f, pose))).normalize()
    const goal = theirs.clone().addScaledVector(squeeze, 2 * shape.radius + across / scale)
    pose.thumb = fromAngles(touch.toward("thumb", new Matrix4(), pose, goal, angles(fist.thumb)))
    const miss = touch.bones("thumb", angles(pose.thumb), pose)[2].b.distanceTo(goal) * scale
    return { miss, pose, squeeze, theirs }
  }
  // curled no further than the thumb reaches across; an object thicker than any pinch spans is met as near as the
  // thumb comes, the hand open round it, not closed into a fist beside it
  const steps = Math.ceil((4 * touch.length("middle")) / spacing)
  let best = curled(0)
  for (let k = 1; k <= steps && best.miss > PRESS * radius; k++) {
    const next = curled(k / steps)
    if (next.miss < best.miss || next.miss <= PRESS * radius) best = next
  }
  const { pose, squeeze, theirs } = best
  const turn = turning(square(pointing(touch, using, pose), squeeze), squeeze, toward, thumbward)
  const beside = (t: number) => placed(way, turn, theirs.clone().addScaledVector(squeeze, t), middle)
  const clears = (t: number) => fingers.every((f) => touch.contact(pose, beside(t), f).gap >= 0)
  return beside(bisect(2 * (shape.radius + across / scale), 0, clears, fine / scale / 2)[0])
}

/** A press: the hand behind the object, relaxed, the fingers pointing along the approach and the thumb on its side,
 * come in till the pads touch */
function pressed(way: Approach) {
  const { touch, using, held, toward, thumbward, entry } = way
  const ready = each((f) => (using.includes(f) ? relaxed : held)[f])
  const ahead = pointing(touch, using, ready)
  const crossing = square(touch.shape.thumbward, ahead)
  const tips = touch.shape.segments(ready).filter((g) => g.bone === 2 && g.part !== "palm" && using.includes(g.part))
  const turn = turning(square(ahead, crossing), crossing, toward, thumbward)
  return come(way, turn, mean(tips.map((g) => g.b)), entry, ready, () => true)
}

/** the way the fingers taking part point in a pose, in the hand's frame: from their knuckles to their tips */
function pointing({ shape }: Touch, using: readonly HandPart[], pose: HandPose) {
  const { fingers } = taking(using)
  const leading = shape.segments(pose).filter((g) => (fingers.length ? fingers : using).includes(g.part) && g.part !== "palm")
  const ends = mean(leading.filter((g) => g.bone === 2).map((g) => g.b))
  return ends.sub(mean(leading.filter((g) => g.bone === 0).map((g) => g.a))).normalize()
}

/** The fingers fitted from where the hand is placed; where something is sunk in still, which no pose of the fingers
 * clears, the hand backs out along the approach, twice as far each time, till nothing is, and then comes in again as
 * far as it stays so */
function settle({ touch, using, held, toward, point, far }: Approach, place: Matrix4): [Matrix4, Fitted] {
  const fitted = (back: number): [Matrix4, Fitted, number] => {
    const at = shift(place, toward.clone().multiplyScalar(-back))
    const found = fit(touch, at, using, held, point)
    // what takes part closes onto the object to within its skin's give; what does not, looked at finer, the palm's flesh
    // between its rods included, may be in it no deeper
    const idle = HAND_PARTS.filter((part) => !using.includes(part))
    return [at, found, Math.max(-Math.min(...HAND_PARTS.map((part) => found.contacts[part].gap)), touch.sunkIn(found.pose, at, idle))]
  }
  let [found, last, back] = [fitted(0), 0, 0]
  for (let step = found[2]; found[2] > touch.fine && back < far; step *= 2) {
    ;[last, back] = [back, back + step]
    found = fitted(back)
  }
  const [at, grip] = back ? fitted(bisect(back, last, (b) => fitted(b)[2] <= touch.fine, (back - last) / 8)[0]) : found
  return [at, grip]
}
