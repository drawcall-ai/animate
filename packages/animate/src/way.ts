import { Vector3 } from 'three'
import { KEEPS, PUSH, SETTLE, SIDLE, STILL, THERE, TOGETHER, WALK, stride } from './gait'
import { type Footing, Pelvis, socket } from './pelvis'
import { SIDES, SIGN, type Side } from './size'
import { EXACT, clamp, wrap, UP } from './world'

/** how fast he turns round (rad a beat), and how near the way he is to face counts as facing it (rad) */
export const SPIN = { rate: 0.7, there: 0.02 }
/**
 * how far the way he is going turns in a stride at the most, and how far off it he faces at the most as he sets off
 * along it (rad); how far on he is to have come round to a way he is led, with no place to come round to (in lengths of
 * his leg); and how near the middle of him his turning brings a foot on the ground at the most, in shares of how far
 * out its hip is: nearer, his legs would cross
 */
const TURNS = { twist: 0.6, bend: 4, clear: 0.85 }
/**
 * how far ahead of the pelvis the trunk turns at the most, and the head, to face as he is to before his feet have him
 * round, while his pelvis is turned to the way he goes, or to look somewhere (rad)
 */
export const LEADS = { trunk: 0.8, head: 1.2 }
const pivot = new Vector3()
const skew = new Vector3()
/** what of a foot stands still in the scene as the way he is going turns: where it is and where it was put, and of a step round, from where to where it goes: any other step goes with him */
const stands = ({ at, step, put }: Footing) => [at, put, ...(step?.points === undefined ? [] : [step.from, step.to])]

/**
 * The hips in the scene. The way he is going runs a `heading` there, from an `origin`, and turns about the hips to
 * where he is to go: a place he was sent to, or the way he is led. He faces it, or as a story has him `face`, or as he
 * did, stepping to a place close by: then he backs or sidesteps along it rather than turn.
 */
export class Way extends Pelvis {
  readonly origin = new Vector3()
  heading = 0
  /**
   * how fast he turns in the scene, and the way he is going does (rad/s); how far round from the way he faces he is to
   * face, which his trunk does first, and how much of that his pelvis gives to the way he goes, for good (rad)
   */
  spins = 0
  curves = 0
  aims = 0
  yields = 0
  /** the way a story has him face in the scene, if it does (rad about y, from +z toward +x) */
  face?: number
  /** where he looks, if he does, from his shoulders in the scene: about y from +z toward +x, and up (rad) */
  look?: { yaw: number; pitch: number }
  /** standing, the way he turns to face where he looks, when that is further round than his head turns, until he faces it (rad about y) */
  toward?: number

  /** which way he faces in the scene (rad about y, from +z toward +x) */
  get facing() {
    return this.heading + this.faces
  }

  get faced() {
    return this.face === undefined || Math.abs(wrap(this.face - this.facing) - this.yields) < SPIN.there
  }

  /** where a place told along the way he is going is in the scene: a foot's, of a `side`, is there under its hip as he faces */
  scene(place: Vector3, side?: Side, to = place) {
    to.copy(place)
    if (side) to.add(this.askew(side))
    return to.applyAxisAngle(UP, this.heading).add(this.origin)
  }

  /** where a place in the scene is along the way he is going: a foot's, as if he faced that way */
  local(place: Vector3, side?: Side, to = place) {
    to.copy(place).sub(this.origin).applyAxisAngle(UP, -this.heading)
    return side ? to.sub(this.askew(side)) : to
  }

  /** how far a hip is from where it would be if he faced the way he goes */
  private askew(side: Side) {
    return skew.set(Math.cos(this.faces) - 1, 0, -Math.sin(this.faces)).multiplyScalar(SIGN[side] * this.size.hip)
  }

  /** where a hip is in the scene: the pelvis turns and lists against the way he faces */
  hip(side: Side, to: Vector3) {
    socket(this.size, side, this.turn, this.list, to).applyAxisAngle(UP, this.faces)
    return this.scene(to.add(this.value))
  }

  /**
   * The way he is going turns about the hips by an angle, or shifts with them, and he turns `round` in the scene by
   * another: what stands still in the scene is told anew along it. That is what `stays` of each foot, the top of a
   * jump, and a place he was sent to.
   */
  private reframe(turn: number, round: number, shift?: Vector3, stays = stands) {
    const { course, spring, plant, value } = this
    const still = new Map<Vector3, Side | undefined>()
    for (const side of SIDES) for (const place of stays(this.foot[side])) if (place) still.set(place, side)
    if (spring) still.set(spring.top, undefined)
    const sent = course.z === undefined ? undefined : new Vector3(course.x, 0, course.z)
    if (sent) still.set(sent, undefined)
    for (const [place, side] of still) this.scene(place, side)
    const hips = this.scene(pivot.set(0, 0, value.z)).clone()
    this.heading += turn
    this.faces += round - turn
    this.origin.copy(hips).sub(pivot.set(0, 0, value.z).applyAxisAngle(UP, this.heading))
    if (shift) this.origin.add(shift)
    for (const [place, side] of still) this.local(place, side)
    for (const side of SIDES) this.foot[side].toes -= turn
    if (!sent || course.z === undefined) return
    // (a footfall the steps are to come out at, and one a jump takes off from, are at the place he was sent to)
    ;[course.x, course.z] = [sent.x, sent.z]
    if (plant) plant.at = sent.z
    if (spring?.from !== undefined) spring.from = sent.z
  }

  /**
   * The world has put the hips at a place on the ground: the way he is going goes with them, and what speed he had
   * against being put there is gone; led a way, he goes as fast as he is led. His feet stay where they stand, for him
   * to step after the hips, if that is no further than he steps: further, he is there as he was, feet and all.
   */
  shift(place: { x: number; z: number }) {
    const at = this.scene(pivot.copy(this.value))
    const by = new Vector3(place.x - at.x, 0, place.z - at.z)
    const [{ course }, whole] = [this, by.length() > KEEPS.near * this.size.leg]
    // (at rest where he was to be, he is at rest where he is put)
    const rest = this.halted && course.z !== undefined ? [course.x, course.z] : undefined
    this.reframe(0, 0, by, whole ? ({ put }) => [put] : stands)
    if (rest && course.z !== undefined) [course.x, course.z] = rest
    const pushed = by.applyAxisAngle(UP, -this.heading).normalize()
    this.velocity.addScaledVector(pushed, Math.max(0, -pushed.dot(this.velocity)))
    // (led a way, he goes as fast as he is led along the way he is going: the world has him going so, and his strides
    // are to keep up with it, backwards while what he is led is behind him)
    if (this.led && course.heading !== undefined)
      this.velocity.z = Math.abs(course.speed) * Math.cos(course.heading - this.heading)
  }

  /**
   * The ground under him is so high in the scene: a foot on it goes with it, and the hips and a foot in the air stay
   * where they are. Ground that drops away from under his feet leaves him in the air, to come down onto it.
   */
  floor(y: number) {
    const by = y - this.origin.y
    if (by === 0) return
    this.origin.y = y
    this.value.y -= by
    const drops = by < -THERE * this.size.leg && !this.aloft
    for (const side of SIDES) {
      const foot = this.foot[side]
      if (foot.down && !drops) continue
      foot.at.y -= by
      foot.down = false
    }
    if (!drops) return
    this.falls = true
    this.spring = undefined
  }

  /**
   * the hips are knocked going so along the ground in the scene (m/s), no faster than a step catches: at his ease, carried
   * further than a step is worth, he is to rest there and steps after them; else he sways back over his feet
   */
  knock(by: Vector3) {
    const { velocity, course } = this
    const { leg } = this.size
    const knocked = by.clone().applyAxisAngle(UP, -this.heading).setY(0)
    const speed = Math.min(knocked.length(), Math.sqrt(KEEPS.near * leg * PUSH.along))
    knocked.setLength(speed)
    const carries = (speed * speed) / PUSH.along
    if (this.idle === 0 || carries < TOGETHER * leg || course.z === undefined) {
      velocity.add(knocked)
      return
    }
    this.reframe(Math.atan2(knocked.x, knocked.z), 0)
    velocity.z = speed
    ;[course.x, course.z, course.speed] = [0, this.value.z + carries, speed]
  }

  /** the same going told the other way round, backwards along a way that runs the other way: it stays within a quarter turn of the way he faces */
  private reverse() {
    this.reframe(Math.sign(this.faces) * Math.PI, 0, undefined, ({ at, step, put }) => [at, put, step?.from, step?.to])
    for (const told of [this.value, this.velocity, this.acceleration]) told.x *= -1
    for (const told of [this.velocity, this.acceleration]) told.z *= -1
    this.course.speed *= -1
    this.wanted *= -1
  }

  /**
   * how fast he goes at the most facing so far off the way he goes (m/s): as he is asked, facing it, and off it as he
   * walks; as his feet close up, square to it, and as he backs, facing away; between, by how much of his going is along
   * the way he faces
   */
  private fastest(faces: number) {
    const along = Math.cos(faces) * this.way
    if (along > Math.cos(SPIN.there)) return Infinity
    return ((along > 0 ? WALK.most : KEEPS.back) * along ** 2 + SIDLE.most * (1 - along ** 2)) * this.size.pace
  }

  /**
   * The way he is going turns toward where he is to go, and he with it: or he turns to face as a story has him, and
   * goes backwards or sideways along it rather than turn from that, as he does to a place close by. Only a foot on the
   * ground turns him. Standing, the way he is going is free: he turns where he stands, his feet stepping round, until
   * he faces near enough to set off. Going, he comes round no faster than the ground pushes him round, no further in a
   * stride than his legs take, and over a foot on the ground no further than keeps it clear of his other leg; and he
   * goes no faster than has him round by the time he is there, nor than he goes facing as he does.
   */
  protected steer(dt: number, down: boolean) {
    const { course, value, velocity } = this
    const { leg, hip, beat, pace } = this.size
    ;[this.curves, this.spins, this.rounds, this.aims] = [0, 0, Infinity, 0]
    // (a jump goes the way he is going)
    if (this.jumps) return
    const going = Math.abs(velocity.z)
    const still = going < STILL * pace
    // standing, he turns to face where he looks once his head does not turn that far round, unless he is to face a way
    const { look } = this
    const away = look && this.face === undefined && still ? Math.abs(wrap(look.yaw - this.facing)) : 0
    if (this.toward !== undefined || away > LEADS.head) this.toward = away < SPIN.there ? undefined : look?.yaw
    const face = this.face ?? this.toward
    const far = course.z === undefined ? TURNS.bend * leg : Math.hypot(course.x, course.z - value.z)
    // to a place close by he keeps facing as he does, and wherever he goes at a walk, as a story has him face
    const held = far <= KEEPS.near * leg || (face !== undefined && Math.abs(course.speed) <= WALK.most * pace)
    // (and led free, the way he goes, the way he is led, comes round no further than a quarter turn: further he is
    // carried on backwards along it, and turns round to it)
    const behind = !held && course.heading !== undefined && Math.cos(course.heading - this.heading) < 0
    if ((held && Math.cos(this.faces) < -SPIN.there) || behind) this.reverse()
    const stated = held && face !== undefined ? wrap(face - this.heading) : undefined
    // how far round from the way he is going where he is to go lies: nowhere, once he is there
    const placed = course.z === undefined ? undefined : far > THERE * leg && Math.atan2(course.x, course.z - value.z)
    const led = course.heading === undefined ? undefined : wrap(course.heading - this.heading)
    const bears = placed === undefined ? led : placed === false ? undefined : placed
    // he backs to what is behind the way he keeps facing; and standing with nowhere to go, the way he is going is the way he faces
    const backs = held && bears !== undefined && Math.cos(bears) < 0
    const turn =
      bears === undefined ? (still && placed === false ? this.faces : 0) : backs ? wrap(bears + Math.PI) : bears
    // going another way than he is to face, his pelvis turns toward the way he goes: all the way, facing up to an eighth of a turn off it, and less again up to a quarter, and coming to a place, on the last stride. His trunk makes up for it
    const across = Math.abs((stated ?? 0) - turn)
    const most =
      bears === undefined ? 0 : Math.min(1, far / (KEEPS.near * leg)) * Math.min(across, Math.PI / 2 - across)
    this.yields = Math.sign((stated ?? 0) - turn) * Math.max(0, most)
    const faced = !held ? undefined : stated === undefined ? this.faces : stated - this.yields
    // standing, the way he is going turns at once: going, as the ground pushes him round and, he turning with it, his strides take him
    const spin = SPIN.rate / beat
    const twist = held ? Infinity : (2 * TURNS.twist * going) / stride(this.size, going / pace)
    const moving = going > 0 ? Math.min(PUSH.along / going, twist) : 0
    const rate = still ? Infinity : moving
    let turned = down ? clamp(turn, -rate * dt, rate * dt) : 0
    // he turns with the way he goes, and round to it if he faces off it: or to face as he is to, the last of it ever slower
    const carried = faced === undefined && !still ? turned : 0
    const off = (faced ?? turned) - this.faces - carried
    const eased = Math.sign(off) * Math.min(Math.abs(off), Math.min(spin, (2 * Math.abs(off)) / (SETTLE * beat)) * dt)
    // (facing further off the way he goes than he sets off, to face it, he steps round however his feet stand, and
    // comes round in the air too)
    const steps = still || (!held && Math.abs(this.faces) > TURNS.twist)
    let round = down || steps ? carried + eased : 0
    // (no further from the way he goes than he can face at his speed: he slows for it first)
    const [now, then] = [this.fastest(this.faces), this.fastest(this.faces - turned + round)]
    if (held && then < Math.min(going - PUSH.along * dt, now)) round = 0
    for (const side of steps ? [] : SIDES) {
      const { at, down } = this.foot[side]
      const [aside, on] = [at.x - value.x - SIGN[side] * hip, at.z - value.z]
      const fore = aside * Math.sin(this.faces) + on * Math.cos(this.faces)
      const out = hip + SIGN[side] * (aside * Math.cos(this.faces) - on * Math.sin(this.faces))
      if (!down || SIGN[side] * fore * round <= 0) continue
      const most = Math.max(0, out - TURNS.clear * hip) / Math.max(Math.abs(fore), EXACT)
      const cut = Math.max(0, Math.abs(round) - most)
      if (faced === undefined && turned * round > 0) turned -= Math.sign(turned) * Math.min(Math.abs(turned), cut)
      round = clamp(round, -most, most)
    }
    if (turned !== 0 || round !== 0) this.reframe(turned, round)
    ;[this.curves, this.spins] = [turned / dt, round / dt]
    this.aims = (stated ?? faced ?? turn) - turned - this.faces
    if (course.z === undefined ? bears !== undefined : this.veers)
      course.speed = (backs ? -1 : 1) * Math.abs(course.speed)
    // he goes no faster than has him round by the time he is there, his turning as often held up as not: nor than he goes facing as he does, nor at all until he faces near enough the way he is to go
    this.rounds = bears === undefined || turn === 0 ? Infinity : (far * rate) / (held ? 1 : 2) / Math.abs(turn)
    if (held) this.rounds = Math.min(this.rounds, this.fastest(this.faces))
    else if (Math.abs(this.faces) > TURNS.twist) this.rounds = 0
  }
}
