import { Line3, Matrix4, Mesh, type Object3D, Quaternion, Vector3 } from 'three'
import type { Ahead } from './ahead'
import type { Bones } from './bones'
import type { Grip } from './fingers'
import type { Side, Size } from './size'
import { EXACT, clamp } from './world'

/**
 * how many times over in a step the thing is moved toward where the hands on it can have it, at the most, and how
 * many times over the turn for that is looked for; and how far into him it may be, at his skin as a stock is in the
 * shoulder (in lengths of his leg)
 */
const FIT = { most: 16, turns: 16, skin: 0.011 }
/** how far apart the points of a grip are that tell how a hand is turned on it (in lengths of his arm) */
const GRIP = 0.15
/**
 * how near a hand is to be to where it holds a thing to hold it (in lengths of his leg): within that it asks nothing of
 * the thing
 */
const HOLDS = 0.01
/** how far a hand come to its moment may be from where it is to hold a thing and take hold of it: as far as its fingers reach (in lengths of his leg) */
export const TAKES = 0.1
/** how far a hand is from where it holds a thing, counting how far it is turned off (rad) as far as that carries the points of its grip (m) */
const astray = ({ arm }: Size, far: number, turned: number) => far + turned * GRIP * arm
/** whether a hand so far from where it holds a thing and turned so far off holds it, or is `within` so far of it */
export const holds = (size: Size, far: number, turned: number, within = HOLDS) =>
  astray(size, far, turned) <= within * size.leg
/** how fast the hands carry it toward how it is to be, at the most: turning it (rad a beat) and moving it (in lengths of his arm a beat) */
const CARRY = { turn: 2, move: 2 }
const point = new Vector3()
const nearest = new Vector3()
const line = new Line3()
const turn = new Quaternion()

/**
 * where a hand is to be on a thing and where it can be or is, and what turns the hand from how it is to be turned to
 * how it can be or is: in the frame of the body
 */
type Reach = { want: Vector3; can: Vector3; turn: Quaternion }
/**
 * a point of a thing, in its frame, that rests in a shoulder: where the pocket of that shoulder is, in the frame of the
 * body, and which side it is
 */
export type Seat = { at: Vector3; pocket: Vector3; side: Side }
/**
 * a hand as what he holds sees it, on a side: what it holds and by which grip, and where that sits in it, from the
 * wrist and turned against the hand as it hangs, in the frame of the body; the thing it `keeps` to its grip on as that
 * is to be, holding it or on its way to, or whether it `leads` what it holds, taking it along wherever the hand goes;
 * where it can be on what it keeps to `seconds` on; and how a thing it carries to a place is to go there, if it does: from how it was against him to a pose, a
 * `share` of the way
 */
export type Holder = {
  side: Side
  holding?: { give: Give; grip: Grip }
  placed?: { at: Vector3; turned: Quaternion; part: Object3D }
  keeps?: Give
  leads: boolean
  nearest(seconds: number): Reach
  wants(seconds: number): { from: Matrix4; at: Vector3; turn: Quaternion; share: number } | undefined
}
/** a point of a thing, where it is to go, and how much that counts */
type Pair = { from: Vector3; to: Vector3; weight: number }

const parts = (is: Matrix4) => {
  const pose = { at: new Vector3(), turn: new Quaternion(), large: new Vector3() }
  is.decompose(pose.at, pose.turn, pose.large)
  return pose
}

/** a way of being moved so far */
const shifted = (is: Matrix4, by: Vector3) => new Matrix4().makeTranslation(by).multiply(is)

/** so far, as a share, from one way of being to another */
function partway(from: Matrix4, to: Matrix4, share: number) {
  const [one, other] = [parts(from), parts(to)]
  return new Matrix4().compose(one.at.lerp(other.at, share), one.turn.slerp(other.turn, share), other.large)
}

/**
 * so far from one way of being to another as the hands carry a thing in so many `beats`, turning it and moving it no
 * faster than they carry it (`arm` long): all the way, if they carry it so far
 */
function toward(from: Matrix4, to: Matrix4, beats: number, arm: number) {
  const [one, other] = [parts(from), parts(to)]
  const far = Math.max(one.turn.angleTo(other.turn) / CARRY.turn, one.at.distanceTo(other.at) / (CARRY.move * arm))
  return partway(from, to, Math.min(1, beats / far))
}

/**
 * the points of a hand on a thing, where they are to go: its wrist, and a grip's length off it along two ways in the
 * hand, carried as the hand is turned from how it is to be to how it can be or is
 */
const grips = ({ want, can, turn }: Reach, size: Size, slack = 0): Pair[] => {
  const long = GRIP * size.arm
  // (only as far as the hand is more than `slack` from where it can be)
  const far = astray(size, want.distanceTo(can), turn.angleTo(new Quaternion()))
  const share = far > slack ? 1 - slack / far : 0
  const [to, turned] = [want.clone().lerp(can, share), new Quaternion().slerp(turn, share)]
  return [new Vector3(), new Vector3(long, 0, 0), new Vector3(0, long, 0)].map((at) => ({
    from: want.clone().add(at),
    to: to.clone().add(at.applyQuaternion(turned)),
    weight: 1,
  }))
}

/**
 * what moves a thing, as a rigid one, so that its points come nearest where they are to go, each counting as much as
 * it weighs: turned as the largest of the turns that tell how they lie against each other, and shifted as their
 * middles are then apart
 */
function fit(pairs: Pair[]) {
  const total = pairs.reduce((sum, { weight }) => sum + weight, 0)
  const [from, to] = [new Vector3(), new Vector3()]
  for (const pair of pairs) {
    from.addScaledVector(pair.from, pair.weight / total)
    to.addScaledVector(pair.to, pair.weight / total)
  }
  const s = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  for (const pair of pairs) {
    const [a, b] = [pair.from.clone().sub(from).toArray(), pair.to.clone().sub(to).toArray()]
    for (let k = 0; k < 9; k++) s[k] += pair.weight * a[Math.floor(k / 3)] * b[k % 3]
  }
  const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = s
  const n = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, yy - xx - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, zz - xx - yy],
  ]
  // (shifted so that every turn of it counts more the nearer it lies to the largest, and raised to a power so high,
  // squared over and over, that only the largest is left)
  const shift = s.reduce((sum, value) => sum + Math.abs(value), 0)
  let m = n.map((row, r) => row.map((value, c) => value + (r === c ? shift : 0)))
  for (let k = 0; k < FIT.turns; k++) {
    const squared = m.map((row) => m.map((_, c) => row.reduce((sum, value, j) => sum + value * m[j][c], 0)))
    const most = Math.max(...squared.flat().map(Math.abs))
    if (!(most > 0)) break
    m = squared.map((row) => row.map((value) => value / most))
  }
  const columns = [0, 1, 2, 3].map((c) => m.map((row) => row[c]))
  const [q] = columns.sort((one, other) => Math.hypot(...other) - Math.hypot(...one))
  const long = Math.hypot(...q)
  if (long > 0) for (let k = 0; k < 4; k++) q[k] /= long
  else q.splice(0, 4, 1, 0, 0, 0)
  if (q[0] < 0) for (let k = 0; k < 4; k++) q[k] = -q[k]
  const turned = new Quaternion(q[1], q[2], q[3], q[0])
  return new Matrix4().compose(to.sub(from.applyQuaternion(turned)), turned, new Vector3(1, 1, 1))
}

/**
 * A thing he holds. How it is to be is decided here, and the hands follow: it is what was set last, by setting its
 * transform before an update, or the way a hand carries it to a place, from how it was against him to where it is sent,
 * eased in and out; with nothing new said it keeps how it was against him, going and turning with him. What holds of
 * it, first to last: the hands that keep to it are on it, it is out of him, a point of it that rests in a shoulder is in
 * its pocket, and it is as it is to be. So in each step it is moved from how it is to be, as little as that takes, to
 * where the hands that keep to it can have it, each hand getting there turned as it is to be before it is turned
 * short, and goes toward that no faster than the hands carry it; where they cannot all hold it, it gives, and comes
 * back as they can. A hand that leads it, alone on it, swinging it or let free, takes it along as the hand is. Looked `over` a point
 * of it, he has that point on the line from his eye to where he looks, and his head comes down to it. After each step it
 * is where the hands that hold it have it, written in its parent's frame: it lags as they do, and is never where they
 * are not. Held by none it is where it is set, as the scene has it.
 */
export class Give {
  /** as it was last written, which is not how it was set */
  private wrote?: Matrix4
  /**
   * how it is to be and how it is, in the frame of the body, going on with him as he goes and turns, and how what
   * carries the hands was as they were last looked at
   */
  private readonly framed = new Matrix4()
  private is = new Matrix4()
  private readonly from = new Matrix4()
  /** whether a hand holds it, and whether more than one does */
  held = false
  shared = false
  /** the point of it, in its frame, that rests in the shoulder of the hand that holds it nearest that point, if one does */
  rests?: Vector3
  /** points over the box of each mesh it is made of, in its own frame: no further apart than a thigh is thick */
  private readonly points: Vector3[] = []
  /** the point of it he looks over, in its frame, and the place he looks at, in the frame of the body */
  sight?: { over: Vector3; place: Vector3 }
  /** where that point is, resting, and the way to the place from there, and with which eye: the line his eye comes to */
  aimed?: { through: Vector3; way: Vector3; side: Side }

  /**
   * `bones` are those of the body whose hands hold it; `carries` tells how what carries the hands is `seconds` from
   * now in the frame of the body: the hips where they are, turned as he faces
   */
  constructor(
    readonly thing: Object3D,
    private readonly bones: Bones,
    private readonly carries: (seconds: number, to: Matrix4) => Matrix4,
  ) {
    thing.updateWorldMatrix(true, false)
    const apart = bones.shape.thigh / (thing.getWorldScale(point).x * bones.frame.getMaxScaleOnAxis())
    for (const mesh of [thing, ...thing.children]) {
      if (!(mesh instanceof Mesh)) continue
      mesh.geometry.computeBoundingBox()
      const box = mesh.geometry.boundingBox?.clone().applyMatrix4(mesh === thing ? new Matrix4() : mesh.matrix)
      if (!box) continue
      const long = box.getSize(new Vector3())
      const [x, y, z] = [long.x, long.y, long.z].map((side) => 1 + Math.ceil(side / apart))
      for (let k = 0; k < x * y * z; k++) {
        const share = new Vector3(k % x, Math.floor(k / x) % y, Math.floor(k / x / y)).divide(
          new Vector3(x - 1 || 1, y - 1 || 1, z - 1 || 1),
        )
        this.points.push(share.multiply(long).add(box.min))
      }
    }
    carries(0, this.from)
    this.begin()
    this.is.copy(this.framed)
  }

  /**
   * at the first step of an update: it goes on with him as he has gone and turned since it was looked at, and is to be
   * as it was set if it has been set anew, or held by none
   */
  begin() {
    const { thing } = this
    this.carry(0)
    thing.updateMatrix()
    if (this.held && this.wrote && thing.matrix.equals(this.wrote)) return
    thing.parent?.updateWorldMatrix(true, false)
    this.framed.multiplyMatrices(this.bones.frame, thing.parent?.matrixWorld ?? new Matrix4()).multiply(thing.matrix)
  }

  /** how he has gone and turned since it was looked at, to `seconds` from now, in the frame of the body */
  private gone(seconds: number) {
    return this.carries(seconds, new Matrix4()).multiply(this.from.clone().invert())
  }

  /** held, it goes on with him to `seconds` from now, and is looked at from there */
  private carry(seconds: number) {
    const gone = this.gone(seconds)
    if (this.held) [this.is, this.framed].forEach((pose) => pose.premultiply(gone))
    this.carries(seconds, this.from)
  }

  /** how it is `seconds` from now, in the frame of the body: carried on with him as he goes and turns */
  private pose(seconds: number) {
    return this.gone(seconds).multiply(this.is)
  }

  /** how it is to be turned now, in the frame of the body */
  turned() {
    return parts(this.framed).turn
  }

  /** how it is turned in the frame of the body as a hand has it that hangs straight down */
  hung(hand: Holder) {
    return parts(this.posed(hand, new Vector3(), new Quaternion())).turn
  }

  /** how it is to be against him: in the frame of his hips as he faces */
  against() {
    return this.from.clone().invert().multiply(this.framed)
  }

  /** how far it is drawn now from a pose in the frame of the body: apart (m), and turned (rad) */
  off(at: Vector3, turn: Quaternion) {
    const drawn = parts(this.drawn(this.thing, new Matrix4()))
    return { far: drawn.at.distanceTo(at), turned: drawn.turn.angleTo(turn) }
  }

  /** where a part of it is to be `seconds` from now, in the frame of the body: held by none, where it is set */
  at(part: Object3D, seconds: number, to: Matrix4) {
    part.updateWorldMatrix(true, false)
    const on = this.thing.matrixWorld.clone().invert().multiply(part.matrixWorld)
    return to.copy(this.held ? this.pose(seconds) : this.framed).multiply(on)
  }

  /** where a part of it is drawn now, in the frame of the body */
  drawn(part: Object3D, to: Matrix4) {
    part.updateWorldMatrix(true, false)
    return to.multiplyMatrices(this.bones.frame, part.matrixWorld)
  }

  /**
   * how it is in the frame of the body as a hand has it that holds it, the hand turned so from hanging and its wrist
   * there: the part of it the hand holds sits in the hand so
   */
  private posed(hand: Holder, wrist: Vector3, turned: Quaternion) {
    const { thing } = this
    const { at, turned: sits, part } = hand.placed ?? { at: new Vector3(), turned: new Quaternion(), part: thing }
    part.updateWorldMatrix(true, false)
    const on = thing.matrixWorld.clone().invert().multiply(part.matrixWorld)
    const large = parts(this.framed).large.multiply(parts(on).large)
    const held = new Matrix4().compose(at.clone().applyQuaternion(turned).add(wrist), turned.clone().multiply(sits), large)
    return held.multiply(on.invert())
  }

  /**
   * where the wrist of a hand that holds it is from a point of it, in its frame, as it is to be: in the frame of the
   * body
   */
  wrist(hand: Holder, point: Vector3) {
    const wrist = new Vector3().applyMatrix4(this.posed(hand, new Vector3(), new Quaternion()).invert())
    return wrist.applyMatrix4(this.framed).sub(point.clone().applyMatrix4(this.framed))
  }

  /**
   * it posed so, moved out of him as far as its deepest point is in beyond his skin: the way each point in him is out of
   * the line in him it is in deepest from, counting as much as it is in
   */
  private out(is: Matrix4, seated?: Seat) {
    const skin = FIT.skin * this.bones.size.leg
    const [away, at] = [new Vector3(), new Vector3()]
    let most = 0
    for (const each of this.points) {
      // (what rests against him, the end of a stock in his shoulder, is at his skin where it rests)
      if (seated && each.distanceTo(seated.at) < GRIP * this.bones.size.arm) continue
      at.copy(each).applyMatrix4(is)
      const by = this.bones.depth(at, line) - skin
      if (!(by > 0)) continue
      most = Math.max(most, by)
      away.addScaledVector(at.sub(line.closestPointToPoint(at, false, nearest)).normalize(), by)
    }
    return most > 0 ? new Matrix4().makeTranslation(away.setLength(most)).multiply(is) : is
  }

  /**
   * before a step of so many `seconds`, with the `hands`, those of them that hold it, and a point of it `seated` in its
   * shoulder: led by a hand, it is as that hand has it. Otherwise it is to be as the hand that carries it has it go, or
   * as it was to be; from there it is moved, over and over until it moves no further, as little as has the hands that
   * keep to it reach it and that point stay in its pocket, out of him: moved so from how it was to be, gone toward how
   * it is to be no faster than the hands carry it, so that it never jumps, and never settles anywhere else
   */
  correct(hands: Holder[], seconds: number, seated?: Seat) {
    const holding = hands.filter((hand) => hand.holding?.give === this)
    const lead = holding.find((hand) => hand.leads)
    const held = (this.held = holding.length > 0)
    this.shared = holding.length > 1
    if (lead) this.is = this.posed(lead, this.bones.wrist[lead.side].clone(), this.bones.hand[lead.side].clone())
    // (carried on with him to the end of the step first: what is moved and written below is then where it is at the
    // end of the step, whatever step of an update this is)
    this.carry(seconds)
    this.aimed = undefined
    if (!held) return void this.is.copy(this.framed)
    if (lead) return void this.framed.copy(this.is)
    const wants = holding.map((hand) => hand.wants(seconds)).find((wants) => wants)
    if (wants) this.framed.copy(this.along(wants, seconds))
    const { size } = this.bones
    const set = this.seated(this.framed, seated)
    const keeps = hands.filter((hand) => hand.keeps === this)
    // (moved over and over until it moves no further: a hand that holds it as it is asks nothing of it)
    const settled = (from: Matrix4) => {
      let is = from
      for (let k = 0, moved = Infinity; k < FIT.most && moved > EXACT; k++) {
        this.is = is
        const pairs = keeps.flatMap((hand) => grips(hand.nearest(seconds), size, HOLDS * size.leg))
        if (seated)
          pairs.push({ from: seated.at.clone().applyMatrix4(is), to: seated.at.clone().applyMatrix4(set), weight: 1 })
        const next = this.out(pairs.length ? fit(pairs).multiply(is) : is, seated)
        moved = parts(next).at.distanceTo(parts(is).at) + GRIP * size.arm * parts(next).turn.angleTo(parts(is).turn)
        is = next
      }
      return (this.is = is)
    }
    const is = settled(toward(this.is, set, seconds / size.beat, size.arm))
    if (seated && this.sight) this.aimed = this.sighted(seated, is)
  }

  /** how it is to be `seconds` from now as a hand carries it, a share of the way from how it was against him, eased in and out */
  along({ from, at, turn, share }: NonNullable<ReturnType<Holder['wants']>>, seconds: number) {
    const eased = clamp(share, 0, 1) ** 2 * (3 - 2 * clamp(share, 0, 1))
    const to = new Matrix4().compose(at, turn, parts(this.framed).large)
    return partway(this.carries(seconds, new Matrix4()).multiply(from), to, eased)
  }

  /**
   * it posed so, moved to where its point that rests is in the pocket of the shoulder; and looked over, on to where the
   * point it is looked over is on the line from his eye to where he looks
   */
  private seated(is: Matrix4, seat?: Seat) {
    if (!seat) return is
    const placed = shifted(is, seat.pocket.clone().sub(seat.at.clone().applyMatrix4(is)))
    const aimed = this.sighted(seat, placed)
    if (!aimed) return placed
    const { through, way, side } = aimed
    const eye = this.bones.eye(side)
    return shifted(placed, eye.addScaledVector(way, through.clone().sub(eye).dot(way)).sub(through))
  }

  /** where the point it is looked over is, it posed so, and the way from there to where he looks: the line his eye is to be on */
  private sighted({ side }: Seat, is: Matrix4) {
    if (!this.sight) return undefined
    const through = this.sight.over.clone().applyMatrix4(is)
    return { through, way: this.sight.place.clone().sub(through).normalize(), side }
  }

  /**
   * where a hand that holds it is to be as it is posed so, and where it is, and what turns the hand from how it is to be
   * turned to how it is
   */
  private reach(hand: Holder, is: Matrix4): Reach {
    // (where it would be with the hand hanging at his feet, against where it is: what turns and moves the hand there)
    const hung = parts(this.posed(hand, new Vector3(), new Quaternion()))
    const pose = parts(is)
    const turn = pose.turn.multiply(hung.turn.invert())
    const want = pose.at.sub(hung.at.applyQuaternion(turn))
    const { wrist, hand: turned } = this.bones
    return { want, can: wrist[hand.side].clone(), turn: turned[hand.side].clone().multiply(turn.invert()) }
  }

  /**
   * after a step of so many `seconds`: it is where the hands that hold it have it, as they are posed, in its parent's
   * frame. So it is in every hand that holds it however far they lag behind where they are to have it: it lags with
   * them. Held by none it is the scene's
   */
  write(hands: Holder[], seconds: number) {
    const { thing } = this
    const { frame } = this.bones
    if (!this.held) return
    const holding = hands.filter((hand) => hand.holding?.give === this)
    const to = this.pose(seconds)
    if (holding.length) to.premultiply(fit(holding.flatMap((holder) => grips(this.reach(holder, to), this.bones.size))))
    thing.parent?.updateWorldMatrix(true, false)
    const into = new Matrix4().multiplyMatrices(frame, thing.parent?.matrixWorld ?? new Matrix4()).invert()
    to.premultiply(into).decompose(thing.position, thing.quaternion, thing.scale)
    thing.updateMatrix()
    this.wrote = thing.matrix.clone()
  }
}

/** the place he looks at, in the scene, and the point of a thing he looks over at it */
type Look = { place?: Vector3; over?: { on: Object3D; at: Vector3 } }

/**
 * The things he holds: one for each thing, so that both hands on one have it give way to both; and the pocket of each
 * shoulder that a point of one rests in, from its joint, he upright. Which hands hold what is told anew from the hands
 * each time it is asked, as a hand may be sent elsewhere within a step.
 */
export class Gives {
  private readonly all = new Map<Object3D, Give>()

  constructor(
    private readonly bones: Bones,
    private readonly ahead: Ahead,
    private readonly pockets: Record<Side, Vector3>,
  ) {}

  /** he holds a thing from now on, a point of it, in its frame, resting in a shoulder if that is said */
  hold(thing: Object3D, rests?: Vector3) {
    const { ahead } = this
    const found =
      this.all.get(thing) ??
      new Give(thing, this.bones, (seconds, to) =>
        to.makeRotationY(ahead.facing(seconds)).setPosition(ahead.hips(seconds, new Vector3(), new Vector3())),
      )
    found.rests = rests
    this.all.set(thing, found)
    return found
  }

  /** he holds a thing no more */
  drop(thing: Object3D) {
    this.all.delete(thing)
  }

  /** the thing he holds that a part is, or is part of, if he holds one */
  held(part: Object3D) {
    for (let on: Object3D | null = part; on; on = on.parent) {
      const found = this.all.get(on)
      if (found) return found
    }
    return undefined
  }

  /** at the first step of an update: what he holds is looked at as it was last set, not as it was last written */
  begin() {
    for (const give of this.all.values()) give.begin()
  }

  /**
   * where the point of a thing that rests in a shoulder is to be `seconds` from now, if it does: in the pocket of the
   * shoulder of the hand that holds it nearest that point
   */
  private seat(give: Give, hands: Holder[], seconds: number): Seat | undefined {
    const { rests } = give
    const [hand] = hands
      .filter(({ holding }) => holding?.give === give)
      .map((hand) => ({ hand, far: give.wrist(hand, rests ?? new Vector3()).length() }))
      .sort((one, other) => one.far - other.far)
    if (!rests || !hand) return undefined
    const { side } = hand.hand
    const pocket = this.ahead.shoulder(side, seconds, new Vector3(), turn).add(this.pockets[side].clone().applyQuaternion(turn))
    return { at: rests, pocket, side }
  }

  /**
   * before a step of so many `seconds`: each is moved for the hands on it to reach it and out of him, and looked over at
   * the place he looks, if it is. Tells how his head is to be turned against the trunk to have his eye on that line
   */
  correct(hands: Holder[], seconds: number, { place, over }: Look) {
    for (const give of this.all.values()) {
      const sighted = place && over?.on === give.thing
      give.sight = sighted ? { over: over.at, place: place.clone().applyMatrix4(this.bones.frame) } : undefined
      give.correct(hands, seconds, this.seat(give, hands, seconds))
    }
    const { aimed } = [...this.all.values()].find((give) => give.aimed) ?? {}
    return aimed && this.bones.sighting(aimed.side, aimed.through, aimed.way)
  }

  /** after a step of so many `seconds`: each is where the hands that hold it have it */
  write(hands: Holder[], seconds: number) {
    for (const give of this.all.values()) give.write(hands, seconds)
  }
}
