import { Vector3 } from 'three'
import { KEEPS, leant, PUSH, RUN, SETTLE, SIDLE, SLOW, SPEEDS, THERE, TOGETHER, WALK, stride } from './gait'
import { type Footing, Pelvis, socket } from './pelvis'
import { clamp, damped, EXACT, type Side, SIDES, SIGN, UP, wrap } from '@drawcall/limbs'

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
/**
 * led, how long the way he is going takes to come round to the way he is led, and his pelvis to the way he is to face
 * (in his beats); and how far off where it is to face it is that the pelvis no longer turns with the way he goes (rad)
 */
const FOLLOW = { way: 0.12, pelvis: 1.6, near: 0.5 }
/** how far a leg turns in over its foot at the most, and out (rad) */
const TWIST = { in: 0.2, out: 0.6 }
/** how far round from how he faces a foot of a side points at the least and at the most, the leg turned in or out (rad) */
export const twist = (side: Side) => (side === 'left' ? [-TWIST.in, TWIST.out] : [-TWIST.out, TWIST.in])
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
  /** the way a story has him face in the scene, if it does (rad about y, from +z toward +x), and how fast that turns (rad/s) */
  face?: number
  swings = 0
  /** where the world has the hips on the ground at a moment, until they have been carried there */
  world?: { place: Vector3; time: number }
  /** where he looks, if he does, from his shoulders in the scene: about y from +z toward +x, and up (rad) */
  look?: { yaw: number; pitch: number }
  /** standing, the way he turns to face where he looks, when that is further round than his head turns, until he faces it (rad about y) */
  toward?: number

  /** which way he faces in the scene (rad about y, from +z toward +x) */
  get facing() {
    return this.heading + this.faces
  }

  /** how far the whole of him leans into the turn the way he goes makes, to the left of the way he faces (rad): over feet put out of it, as far as they are */
  get banks() {
    // (led, as the way he is led turns: not as the way he goes catches up with one that jumped round)
    const curves = this.course.turns ?? this.curves
    return this.falls ? 0 : Math.atan(leant(this.velocity.z, curves)) * Math.cos(this.faces)
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
    this.faces = wrap(this.faces + round - turn)
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
   * The world has the hips at a place on the ground at a moment: as they go on from here they are carried there by
   * then, their share of the way in each step, his feet standing where they are for him to step after them. Standing
   * between feet the story has put down he keeps to them, as near the place as they let him, and only his going moves
   * them. Further off where his going takes him by then than he steps, he is there at once, feet and all.
   */
  at(place: Vector3, time: number) {
    this.world = { place, time }
    const off = this.off(place, time - this.time)
    if (off.length() > KEEPS.near * this.size.leg) this.carry(off, () => [])
  }

  /** a step of time from now: the hips are carried their share of the way to where the world has them, by the time it does */
  protected carried(dt: number) {
    const { world } = this
    if (!world) return
    const left = world.time - this.time
    if (!this.placed) this.carry(this.off(world.place, left).multiplyScalar(left > dt ? dt / left : 1))
    if (left <= dt) this.world = undefined
  }

  /**
   * how far a place is from where his going takes him `left` from now: where he stands, between feet the story has put
   * down, or where the hips stand, which ride back as he stands low
   */
  private off(place: Vector3, left: number) {
    const { value, velocity } = this
    const stood = this.placed ? this.between() : new Vector3(0, 0, value.z + this.back)
    const by = this.scene(stood.setY(0).add(skew.set(0, 0, velocity.z * Math.max(0, left))))
    return by.set(place.x - by.x, 0, place.z - by.z)
  }

  /** he is carried along the ground with the way he is going: what `stays` stands where it is, and where he is to rest and where his feet were put go with him */
  private carry(by: Vector3, stays = ({ at, step }: Footing) => [at, step?.points === undefined ? undefined : step.from]) {
    const { course } = this
    const rest = course.z !== undefined && (this.led || this.halted) ? [course.x, course.z] : undefined
    this.reframe(0, 0, by, stays)
    if (rest && course.z !== undefined) [course.x, course.z] = rest
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
   * further than a step is worth, he is to rest there and steps after them; else he sways back over his feet. Led,
   * where he is is the world's to say: he sways, and is carried off only as he is led
   */
  knock(by: Vector3) {
    const { velocity, course } = this
    const { leg } = this.size
    const knocked = by.clone().applyAxisAngle(UP, -this.heading).setY(0)
    const speed = Math.min(knocked.length(), Math.sqrt(KEEPS.near * leg * PUSH.along))
    knocked.setLength(speed)
    const carries = (speed * speed) / PUSH.along
    if (this.led || this.idle === 0 || carries < TOGETHER * leg || course.z === undefined) {
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

  /** how far off the way he goes he faces at the most going forward so fast (rad): the turn of `fastest` */
  private widest(going: number) {
    const fast = going / this.size.pace
    if (fast >= WALK.most) return SPIN.there
    return Math.acos(Math.sqrt(clamp((fast - SIDLE.most) / (WALK.most - SIDLE.most), 0, 1)))
  }

  /**
   * Led, the way he goes is the world's: the way he is going comes round to it within a frame or so, and he goes along
   * it as fast as he is led, backwards along it while he faces more than a quarter turn from it. He faces as a game
   * has him, at a walk, or the way he goes, standing as he faced or toward where he looks: his trunk and head at once,
   * his pelvis coming round after them like a thing with weight, never gated by his feet, which step after it.
   */
  protected follow(dt: number) {
    const { course, velocity } = this
    const { beat, pace } = this.size
    const { look } = this
    const going = course.heading === undefined ? 0 : Math.abs(course.speed)
    const still = going < SLOW * pace
    const away = look && this.face === undefined && still ? Math.abs(wrap(look.yaw - this.facing)) : 0
    if (this.toward !== undefined || away > LEADS.head) this.toward = away < SPIN.there ? undefined : look?.yaw
    const fast = going > WALK.most * pace
    const asked = fast ? undefined : this.face
    const faces = asked !== undefined
    const want = asked ?? course.heading ?? this.toward ?? this.face ?? this.facing
    // the way he is going, along which he goes forwards or backwards as he faces
    let turned = 0
    if (course.heading !== undefined) {
      // (the way he is led goes on turning as it turns, and he on speeding up as he does, until he is led anew)
      course.heading = wrap(course.heading + course.turns * dt)
      course.speed = clamp(course.speed + course.faster * dt, 0, RUN.most * pace)
      course.faster *= Math.exp(-dt / (SPEEDS * beat))
      const backs = Math.cos(wrap(want - course.heading)) < -SPIN.there && !fast
      if (backs !== this.way < 0 && Math.abs(velocity.z) > 0) this.reverse()
      // (as far ahead of it as it turns in the time he takes to come round, so as not to lag it as it turns)
      const heading = course.heading + course.turns * FOLLOW.way * beat + (backs ? Math.PI : 0)
      turned = wrap(heading - this.heading) * Math.min(1, dt / (FOLLOW.way * beat))
      velocity.z = (backs ? -1 : 1) * going
    } else {
      // (standing, the way he is going is the way he faces)
      turned = wrap(want - this.heading) * Math.min(1, dt / (FOLLOW.way * beat))
      velocity.z = 0
    }
    this.curves += (turned / dt - this.curves) * Math.min(1, dt / (FOLLOW.way * beat))
    // (no further from the way he goes than he can face at his speed)
    const widest = this.widest(going)
    const toward = clamp(wrap(want - this.heading - turned), -widest, widest)
    const off = wrap(toward + this.heading + turned - this.facing)
    const pull = (2 * Math.PI) / (FOLLOW.pelvis * beat)
    // (as fast round as the way he is to face turns, or going round a curve the way he goes, and coming up to it besides)
    const along = (faces ? this.swings : this.curves) * Math.max(0, 1 - Math.abs(off) / FOLLOW.near)
    this.spins = along + damped(this.spins - along, off, pull, dt)
    // (no further round from a foot on the ground than a hip turns over it: his feet step round for him to come on)
    let round = this.spins * dt
    for (const side of SIDES) {
      const { down, toes } = this.foot[side]
      if (!down) continue
      // (how far the foot points from how he faces, as it may: or no further off than it is already)
      const [least, most] = twist(side)
      const now = wrap(this.heading + toes - this.facing)
      const points = now - round
      round -= clamp(points, Math.min(least, now), Math.max(most, now)) - points
    }
    if (round !== this.spins * dt) this.spins = round / dt
    this.reframe(turned, round, undefined, ({ at, put, step }) => [at, put, step?.from, step?.to])
    ;[this.rounds, this.yields] = [Infinity, 0]
    this.aims = wrap(want - this.facing)
  }

  /**
   * His legs and pelvis belong to the way he goes, his trunk and head to the way he faces. The way he is going turns
   * toward where he is to go, or led, is the world's at once; he faces as a story or a game has him, at a walk, or else
   * the way he goes. His trunk turns to face so as far as it twists on the pelvis, and the pelvis comes after it as
   * his feet step: all the way, facing up to an eighth of a turn off the way he goes, less again up to a quarter, and
   * further off it he sidesteps, and behind it backs. Only a foot on the ground turns him, and over a foot on the
   * ground no further than keeps it clear of his other leg. Standing, the way he is going is free: he turns where he
   * stands, his feet stepping round. Going his own way, he comes round no faster than the ground pushes him round, no
   * further in a stride than his legs take, and goes no faster than has him round by the time he is there, nor than
   * he goes facing as he does.
   */
  protected steer(dt: number, down: boolean) {
    const { course, value, velocity } = this
    const { leg, hip, beat, pace } = this.size
    ;[this.curves, this.spins, this.rounds, this.aims] = [0, 0, Infinity, 0]
    // (a jump goes the way he is going: on the way to where he takes off he still turns to it)
    if (this.aloft || this.drops) return
    const going = Math.abs(velocity.z)
    const still = going < SLOW * pace
    // standing, he turns to face where he looks once his head does not turn that far round, unless he is to face a way
    const { look } = this
    const away = look && this.face === undefined && still ? Math.abs(wrap(look.yaw - this.facing)) : 0
    if (this.toward !== undefined || away > LEADS.head) this.toward = away < SPIN.there ? undefined : look?.yaw
    const face = this.face ?? this.toward
    const far = course.z === undefined ? TURNS.bend * leg : Math.hypot(course.x, course.z - value.z)
    // to a place close by he keeps facing as he does, and wherever he goes at a walk, as a story has him face
    const held = far <= KEEPS.near * leg || (face !== undefined && Math.abs(course.speed) <= WALK.most * pace)
    // (the way he goes is not his to turn from where he is to go when he keeps facing as he does, nor led: he goes
    // along it backwards, told as a way that runs the other way, while his pelvis is turned more than a quarter from it)
    const kept = held
    if ((kept ? Math.cos(this.faces) : this.way) < -SPIN.there) this.reverse()
    // how far round from the way he is going where he is to go lies: nowhere, once he is there
    // (hips that ride back as he stands low are there as far behind it)
    const there = THERE * leg + this.back
    const placed = course.z === undefined ? undefined : far > there && Math.atan2(course.x, course.z - value.z)
    const led = course.heading === undefined ? undefined : wrap(course.heading - this.heading)
    const bears = placed === undefined ? led : placed === false ? undefined : placed
    // and standing with nowhere to go, the way he is going is the way he faces
    const backs = kept && bears !== undefined && Math.cos(bears) < 0
    const turn =
      bears === undefined ? (still && placed === false ? this.faces : 0) : backs ? wrap(bears + Math.PI) : bears
    // standing, the way he is going turns at once, and led, it is the way the world has him going: else, as the ground
    // pushes him round and, he turning with it, his strides take him
    const spin = SPIN.rate / beat
    const twist = held ? Infinity : (2 * TURNS.twist * going) / stride(this.size, going / pace)
    const rate = still ? Infinity : going > 0 ? Math.min(PUSH.along / going, twist) : 0
    let turned = led !== undefined ? turn : down ? clamp(turn, -rate * dt, rate * dt) : 0
    // the way he is to face: as he is to, or keeps facing, or where he goes
    const faced = !held ? turn : face === undefined ? this.faces : wrap(face - this.heading)
    // (his pelvis gives to the way he goes as he is to face another way, coming to a place on the last stride: his
    // trunk makes up for it)
    const across = wrap(faced - turn)
    const gives = held && face !== undefined && bears !== undefined
    const most = Math.min(1, far / (KEEPS.near * leg)) * Math.min(Math.abs(across), Math.PI / 2 - Math.abs(across))
    this.yields = gives ? Math.sign(across) * Math.max(0, most) : 0
    // his pelvis comes round to where it is to face, the way he goes or as he is to face less what it gives to that: as
    // fast as the way he goes turns, even in the air, and on a foot faster again, the last of it ever slower
    const off = (held ? faced - this.yields : turned) - this.faces
    const eased = down || still ? Math.min(spin, (2 * Math.abs(off)) / (SETTLE * beat)) * dt : 0
    let round = Math.sign(off) * Math.min(Math.abs(off), (still ? 0 : Math.abs(turned)) + eased)
    // (no further from the way he goes than he can face at his speed: he slows for it first)
    const [now, then] = [this.fastest(this.faces - turned), this.fastest(this.faces - turned + round)]
    if (held && then < Math.min(going - PUSH.along * dt, now)) round = 0
    for (const side of still ? [] : SIDES) {
      const { at, down } = this.foot[side]
      const [aside, on] = [at.x - value.x - SIGN[side] * hip, at.z - value.z]
      const fore = aside * Math.sin(this.faces) + on * Math.cos(this.faces)
      const out = hip + SIGN[side] * (aside * Math.cos(this.faces) - on * Math.sin(this.faces))
      if (!down || SIGN[side] * fore * round <= 0) continue
      const most = Math.max(0, out - TURNS.clear * hip) / Math.max(Math.abs(fore), EXACT)
      const cut = Math.max(0, Math.abs(round) - most)
      if (!held && led === undefined && turned * round > 0)
        turned -= Math.sign(turned) * Math.min(Math.abs(turned), cut)
      round = clamp(round, -most, most)
    }
    // (led faster than he goes facing so far off the way he goes, he faces nearer it, over a foot on the ground or not)
    const widest = this.widest(going)
    if (led !== undefined && this.way > 0)
      round = clamp(this.faces - turned + round, -widest, widest) - this.faces + turned
    // (led, it is the world that turns the way he goes: a foot in the air goes on where it was going in the scene)
    const stays = led === undefined ? stands : ({ at, put, step }: Footing) => [at, put, step?.from, step?.to]
    if (turned !== 0 || round !== 0) this.reframe(turned, round, undefined, stays)
    ;[this.curves, this.spins] = [turned / dt, round / dt]
    this.aims = faced - turned - this.faces
    if (course.z === undefined ? bears !== undefined : this.veers)
      course.speed = (backs ? -1 : 1) * Math.abs(course.speed)
    // he goes no faster than has him round by the time he is there, his turning as often held up as not: nor than he goes facing as he does, nor at all until he faces near enough the way he is to go
    this.rounds = bears === undefined || turn === 0 ? Infinity : (far * rate) / (held ? 1 : 2) / Math.abs(turn)
    if (held) this.rounds = Math.min(this.rounds, this.fastest(this.faces))
    else if (!kept && Math.abs(this.faces) > TURNS.twist) this.rounds = 0
  }
}
