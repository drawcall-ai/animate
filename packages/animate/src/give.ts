import { Line3, Matrix4, Mesh, type Object3D, Quaternion, Vector3 } from 'three'
import type { Bones } from './bones'
import type { Side } from './size'

/**
 * how many times over a thing is moved nearer where every hand on it can have it, and out of him; how near they count
 * as having it there (in lengths of his arm); and how far into him it may be, at his skin as a stock is in the
 * shoulder (in lengths of his leg)
 */
const FIT = { most: 8, near: 0.002, skin: 0.011 }
/**
 * how fast the hands carry it from how it was in the last step toward how it is to be, at the most: turning it (rad a
 * beat) and moving it (in lengths of his arm a beat)
 */
const CARRY = { turn: 2, move: 2 }
const turn = new Quaternion()
const middle = new Vector3()
const point = new Vector3()
const nearest = new Vector3()
const line = new Line3()
const deepest = new Line3()

/**
 * where a hand is to be on a thing, where it is or can be, and what turns it from how it is to be to how it is or can
 * be: in the frame of the body
 */
type Reach = { want: Vector3; can: Vector3; turn: Quaternion }

/**
 * a point of a thing, in its frame, that rests in a shoulder: where the pocket of that shoulder is, in the frame of the
 * body, and which side it is
 */
export type Seat = { at: Vector3; pocket: Vector3; side: Side }
/** a hand on a thing that gives way to it: where it can be, `seconds` on, or is, `held` */
export type Holder = { nearest(seconds: number, held?: boolean): Reach }

/**
 * what moves a thing as the hands on it are moved: two turn it about the middle of them, so that the way from one to
 * the other is as they are apart; and it is shifted on as far as is left, as the hands furthest off have it go. Or,
 * `placed` where they are, it is turned as they are on the whole first, and shifted as all of them have it go. It is
 * not turned with hands that only can be turned so: a wrist at the end of how far it turns would have it turn on, step
 * after step
 */
const move = (reach: Reach[], placed = false, turns = true) => {
  middle.set(0, 0, 0)
  for (const { want } of reach) middle.addScaledVector(want, 1 / reach.length)
  turn.identity()
  if (placed && turns) reach.forEach((each, k) => turn.slerp(each.turn, 1 / (k + 1)))
  const [one, other] = reach
  if (other && turns) {
    const apart = new Vector3().subVectors(other.want, one.want).applyQuaternion(turn).normalize()
    turn.premultiply(
      new Quaternion().setFromUnitVectors(apart, new Vector3().subVectors(other.can, one.can).normalize()),
    )
  }
  const [shift, weights] = [new Vector3(), reach.map(({ want, can }) => (placed ? 1 : want.distanceTo(can) + 1e-9))]
  reach.forEach(({ want, can }, k) =>
    shift.addScaledVector(can.clone().sub(want.clone().sub(middle).applyQuaternion(turn).add(middle)), weights[k]),
  )
  shift.divideScalar(weights.reduce((sum, weight) => sum + weight)).add(middle)
  return new Matrix4()
    .makeRotationFromQuaternion(turn)
    .setPosition(shift)
    .multiply(new Matrix4().makeTranslation(middle.negate()))
}

/**
 * A thing that gives way to the hands that hold it. Where it is to be is said by setting its transform before an
 * update, every frame or once. Where a hand on it, holding it or on its way to, cannot be where that has it, or it
 * would be in him, it is moved the least that has every hand reach and keeps it out of him, and the hands are sent
 * to have it so. A point of it that rests in a shoulder has it there instead of where it was set, turned as it was set,
 * and it slides and never turns for the hands; looked `over` a point of it, he has that point on the line from his
 * eye to where he looks, and his head comes down to it. After each step it is where the hands that hold it have it,
 * written in its parent's frame: it lags as they do, and is never where they are not. Let go by all of them it goes on
 * with him as they left it, until it is set anew.
 */
export class Give {
  /** how it is to be, as it was last set: and as it was last written, which is not that */
  private readonly wish = new Matrix4()
  private wrote = new Matrix4()
  /**
   * how it is to be in the frame of the body, as it was looked at last, and how what carries the hands was then; and
   * how it is, moved from that for the hands to reach it and out of him
   */
  private readonly framed = new Matrix4()
  private readonly from = new Matrix4()
  private is = new Matrix4()
  /** whether a hand has held it since it was last set: until one does it is where it was set */
  private held = false
  /** points over the box of each mesh it is made of, in its own frame: no further apart than a thigh is thick */
  private readonly points: Vector3[] = []
  private readonly middle = new Vector3()
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
    for (const at of this.points) this.middle.addScaledVector(at, 1 / this.points.length)
    this.begin()
  }

  /**
   * at the first step of an update: it has been set anew, or is to be as it was last set. How it is goes on with him
   * as he has gone and turned since it was last looked at: it is judged against him, where what he carries is nearly
   * still however fast he goes, not against the scene
   */
  begin() {
    const { thing, wish } = this
    thing.updateMatrix()
    const set = !thing.matrix.equals(this.wrote)
    if (set) wish.copy(thing.matrix)
    thing.parent?.updateWorldMatrix(true, false)
    this.framed.multiplyMatrices(this.bones.frame, thing.parent?.matrixWorld ?? new Matrix4()).multiply(wish)
    this.is = this.held ? this.pose(0) : this.framed.clone()
    // (set anew, it stays where it was set until a hand has it again)
    if (set) this.held = false
    this.carries(0, this.from)
  }

  /**
   * how it is `seconds` from now, in the frame of the body: carried on with him as he has gone and turned since it
   * was looked at, as it is set from where he is once an update
   */
  private pose(seconds: number) {
    const gone = this.carries(seconds, new Matrix4()).multiply(this.from.clone().invert())
    return gone.multiply(this.is)
  }

  /** where a part of it is to be `seconds` from now, in the frame of the body */
  at(part: Object3D, seconds: number, to: Matrix4) {
    part.updateWorldMatrix(true, false)
    const on = this.thing.matrixWorld.clone().invert().multiply(part.matrixWorld)
    return to.copy(this.pose(seconds)).multiply(on)
  }

  /**
   * how far it is to go out of him for its deepest point to be at his skin: away from the line in him it is in deepest
   * from, toward the middle of it, which tells a way out that holds from one step to the next (m)
   */
  private out(seconds: number) {
    const to = this.pose(seconds)
    const skin = FIT.skin * this.bones.size.leg
    let most = skin
    for (const at of this.points) {
      const by = this.bones.depth(point.copy(at).applyMatrix4(to), line)
      if (by <= most) continue
      most = by
      deepest.copy(line)
    }
    if (most === skin) return new Vector3()
    point.copy(this.middle).applyMatrix4(to)
    return point.sub(deepest.closestPointToPoint(point, false, nearest)).setLength(most - skin)
  }

  /**
   * before a step of so many `seconds`: how it is moved for the hands `on` it to reach it, and out of him, as little
   * as has every one reach, or with a point of it in a shoulder, `seated` there. That is looked for from how it was in
   * the last step, carried toward how it is to be no faster than the hands carry it, so that it trails where they
   * cannot follow and never jumps to another way of being held
   */
  correct(on: Holder[], seconds: number, seated?: Seat) {
    const pose = () => ({ at: new Vector3(), turn: new Quaternion(), large: new Vector3() })
    const [from, to] = [pose(), pose()]
    this.is.decompose(from.at, from.turn, from.large)
    this.framed.decompose(to.at, to.turn, to.large)
    this.aimed = undefined
    if (seated) this.seat(seated, to)
    const { arm, beat } = this.bones.size
    const turns = from.turn.angleTo(to.turn) / CARRY.turn
    const share = Math.min(1, seconds / beat / Math.max(turns, from.at.distanceTo(to.at) / (CARRY.move * arm)))
    from.at.lerp(to.at, share)
    from.turn.slerp(to.turn, share)
    this.is = new Matrix4().compose(from.at, from.turn, to.large)
    // (how far off the hands are at the most, in times what counts as near: the nearest it is moved to is kept, as a
    // hand that can only just reach so may reach no longer once it is moved)
    const off = ({ want, can }: Reach) => want.distanceTo(can) / (FIT.near * this.bones.size.arm)
    let [best, nearest] = [this.is, Infinity]
    for (let k = 0; k <= FIT.most && nearest >= 1; k++) {
      this.is = new Matrix4().makeTranslation(this.out(seconds)).multiply(this.is)
      const reach = on.map((hand) => hand.nearest(seconds))
      const worst = Math.max(...reach.map(off))
      if (worst < nearest) [best, nearest] = [this.is, worst]
      this.is = move(reach, false, !seated).multiply(this.is)
    }
    this.is = best
  }

  /**
   * it is to be where its point rests in the pocket of the shoulder, and looked over, where the point it is looked
   * over is on the line from his eye to where he looks
   */
  private seat({ at, pocket, side }: Seat, to: { at: Vector3; turn: Quaternion; large: Vector3 }) {
    const placed = () => new Matrix4().compose(to.at, to.turn, to.large)
    to.at.add(pocket.clone().sub(at.clone().applyMatrix4(placed())))
    if (!this.sight) return
    const through = this.sight.over.clone().applyMatrix4(placed())
    const way = this.sight.place.clone().sub(through).normalize()
    this.aimed = { through, way, side }
    const eye = this.bones.eye(side)
    to.at.add(eye.addScaledVector(way, through.clone().sub(eye).dot(way)).sub(through))
  }

  /** after a step of so many `seconds`: it is where the hands `holding` it have it, in its parent's frame, unturned by them if it `rests` in a shoulder */
  write(holding: Holder[], seconds: number, rests: boolean) {
    const { thing } = this
    const { frame } = this.bones
    this.held ||= holding.length > 0
    if (!this.held) return
    const reach = holding.map((hand) => hand.nearest(seconds, true))
    const to = this.pose(seconds)
    if (holding.length) to.premultiply(move(reach, true, !rests))
    thing.parent?.updateWorldMatrix(true, false)
    const into = new Matrix4().multiplyMatrices(frame, thing.parent?.matrixWorld ?? new Matrix4()).invert()
    to.premultiply(into).decompose(thing.position, thing.quaternion, thing.scale)
    thing.updateMatrix()
    this.wrote = thing.matrix.clone()
  }
}
