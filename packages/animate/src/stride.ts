import { Gait } from '@drawcall/gait'
import { ANKLE, type Bones, clamp, GRAVITY, HEEL, type Joints, type Limb, RANGE, raised, REST, type Side, SIDES, SIGN, SOLE, type Story, UP, waits, wrap, type Xyz } from '@drawcall/limbs'
import { Quaternion, Vector3 } from 'three'

/** how fast a heel comes down again, and comes up (rad a beat), and how finely it is brought up (rad) */
const ROLL = { down: 1.8, up: 9, step: 0.01, exact: 1e-4 }
/** how many times a beat a foot in the air comes round to how it hangs, and an ankle eases to where it is to be from where it was as its foot came down or left */
const DROOP = 9
/** how far off the ground a foot in the air keeps its toe and heel (in legs) */
const TOE = 0.02
const EASE = 6
/**
 * how much of the way the hips are pushed the trunk leans, and of the way a leg in the air is swung out it leans
 * against it; how far it leans forward for the hips riding back behind the ankles (by the angle whose sine is so many
 * times as far, in legs); how far it leans into the way he goes for every pace (rad); how much of his weight pushes up
 * at the least; how much of the way the pelvis lists it tilts back over the foot he stands on; how far ahead it leans
 * as the plan has the hips (in beats)
 */
const LEAN = { pushed: 0.6, swung: 0.25, back: 2.2, going: 0.059, light: 0.25, listed: 0.5, ahead: 0.4 }
/** how much of the way the trunk leans, turns and tilts the head turns back, to stay level and look ahead */
const LEVEL = new Vector3(-0.6, -1, -1)
/** how far ahead of the pelvis the trunk turns at the most to face as he is to, and the head (rad) */
const LEADS = { trunk: 0.8, head: 1.2 }
/** how an arm swings against the legs (of how far the thighs are apart, at rest, more for every pace, at the most); how far the elbow folds for every pace squared, at the most, and less for every rad it swings back; how far forward an arm is thrown for a push as hard as his weight (rad) */
const ARMS = { least: 0.5, faster: 0.44, most: 1.5, folds: 1.3, folded: 1.5, opens: 0.3, thrown: 1.2 }
/** how hard the arms take the legs to push him up (times his weight), and how fast the hips rise with them as far up as that throws them (in paces) */
const LIFT = { least: -1, most: 1.2 }
const FLUNG = 0.68
/** how near the way he is to face counts as facing it (rad), and how near as high as sent the hips count as there (in legs) */
const FACED = 0.02
const HIGH = 0.034

type Clock = { readonly time: number }
/** a place on the ground, or told as a number, so far along z on x = 0; a run to one and a walk */
export type Ground = number | { x: number; z: number }
export const flat = (to: Ground) => (typeof to === 'number' ? { x: 0, z: to } : to)
export type Run = { speed: number; at: Ground; plant?: Side; push?: number; arrive?: number }
export type Walk = { speed?: number; plant?: Side }
/** what his hands ask of the hips and the trunk at a moment: how far lower, bent, turned and ahead */
export type Posture = Record<'low' | 'bend' | 'turn' | 'shift', (time: number) => number>
/** a foot as the rest of the body has it: whether a story has it, where its ankle is, where the ground holds it, and to give it back */
export type Foothold = { readonly held: boolean; readonly value: Vector3; anchor?: Vector3; free(): void }
/** a place and the moment he is to be there; a footfall to come */
export type Mark = { at: Vector3; time: number }
export type Footfall = Mark & { side: Side; put: boolean; swings: boolean }
/** where the hips and the feet will be, as the plan has them, for whoever looks */
export type Foreseen = { hips: Mark[]; to?: Vector3; footfalls: Footfall[]; top?: { asked?: Vector3; comes?: Mark }; facing: number; face: number; heading: number; led?: Vector3 }
/** the hips and the feet as the rest of the body asks about them: where he will be and face, whether a foot can be spared, and a foot the story has or puts down */
export type Carrier = {
  readonly now: number
  hips(seconds: number, value: Vector3, velocity: Vector3): Vector3
  facing(seconds: number): number
  spare(side: Side, seconds: number, until: number): boolean
  stale(from?: number): void
  take(side: Side, span: { from: number; until: number } | undefined): void
  readonly ground: number
  put(side: Side, place?: Vector3, seconds?: number): Vector3 | undefined
  foot(side: Side): { readonly put?: Vector3; readonly down: boolean; readonly at: Vector3 }
  readonly landing: boolean
}
const yawOf = (turn: Quaternion) => {
  const way = new Vector3(0, 0, 1).applyQuaternion(turn)
  return Math.atan2(way.x, way.z)
}
const yaw = (angle: number) => new Quaternion().setFromAxisAngle(UP, angle)
const at = new Vector3()
const ankle = new Vector3()
const from = new Vector3()

/**
 * Where the ankle of a foot on the ground is: where it stands, or up and on from there, the heel up as far as the leg
 * needs to reach it from its hip, and as far as keeps the shin from leaning further over the foot than an ankle bends
 * and the thigh from going further back than a hip lets it: within `least` and `most`. Tells how far up the heel is.
 */
function stood(size: Bones['size'], leg: Limb, anchor: Vector3, hip: Vector3, least: number, most: number, to: Vector3) {
  const short = () => hip.distanceTo(to) > leg.length
  const fits = (angle: number) => {
    const { y, z } = raised(size, Math.max(0, angle))
    to.set(anchor.x, anchor.y + y, anchor.z + z)
    if (short()) return false
    const { first, fold } = leg.reach(from.copy(to).sub(hip))
    return first.x <= RANGE.thigh.x[1] && first.x + fold - angle <= RANGE.ankle.x[1]
  }
  let angle = least
  while (angle < HEEL && !fits(angle) && (anchor.z < hip.z || short())) angle += ROLL.step
  for (let step = ROLL.step / 2; angle > least && step > ROLL.exact; step /= 2) if (fits(angle - step)) angle -= step
  const heel = Math.min(most, angle)
  fits(heel)
  return heel
}

/**
 * The hips and the feet as the frame gait has them, and the body posed over them: the layer the body steps in the
 * place of the old locomotion, with its words. The legs reach their feet from hips the pelvis turns and lists, a heel
 * coming up as the leg needs and rolling down again; the trunk leans as the planned hips push it and into a turn, and
 * turns with the arms, which swing against the legs and are thrown with a push; the head stays level, or looks.
 */
export class Stride {
  readonly hips = { value: new Vector3(), velocity: new Vector3() }
  readonly posture: Posture = { low: () => 0, bend: () => 0, turn: () => 0, shift: () => 0 }
  readonly gait: Gait
  readonly carrier: Carrier
  readonly going
  private looked?: Vector3
  private readonly heel = { left: 0, right: 0 }
  private readonly pitch = { left: 0, right: 0 }
  private readonly toes = { left: 0, right: 0 }
  private readonly down = { left: true, right: true }
  private readonly ankle = { left: new Vector3(), right: new Vector3() }
  private readonly eased = { left: new Vector3(), right: new Vector3() }
  /** where the story puts each foot to stand, and from when until when it has one */
  private readonly puts: Partial<Record<Side, Vector3>> = {}
  private readonly taken: Partial<Record<Side, { from: number; until: number }>> = {}
  private lift = 0
  /** for how long no foot of his own has been on the ground (s) */
  private unheld = 0
  /** the way he turns to face where he looks, until he faces it (rad about y) */
  private toward?: number
  /** how he was led since the last update */
  private led?: { x: number; z: number }
  /** where the world has him by the end of the next update */
  private placed?: { x: number; z: number }

  constructor(
    private readonly clock: Clock,
    private readonly bones: Bones,
    private readonly joints: Joints,
  ) {
    const gait = (this.gait = new Gait(bones.size))
    this.hips.value.copy(gait.hips.value)
    this.carrier = this.carried()
    this.going = this.words()
  }

  get facing() {
    return yawOf(this.gait.hips.turn)
  }

  get ground() {
    return this.gait.lead.place.y
  }

  get falls() {
    return this.gait.jumps && SIDES.every((side) => this.gait.feet[side].value.y > this.ground + this.bones.size.ankle + TOE * this.bones.size.leg)
  }

  /** where a foot of his own stands on the ground, while it does */
  stands(side: Side) {
    const { gait } = this
    const foot = gait.feet[side]
    return gait.steps[side] || foot.outside || foot.frames.length || gait.jumps ? undefined : foot.value.clone()
  }

  /** a step of time: a foot the story has is where it has it, and the gait steps on, writing its frames anew */
  step(dt: number, feet: Record<Side, Foothold>, looked?: Vector3) {
    const { gait } = this
    this.looked = looked
    const now = this.clock.time + dt
    for (const side of SIDES) gait.hold(side, feet[side].held ? feet[side].value : undefined)
    // (left with no foot of his own on the ground for longer than he can be in the air, he comes down on both: the story has them no longer)
    const standing = SIDES.some((side) => !feet[side].held && !gait.steps[side]) || gait.jumps
    this.unheld = standing ? 0 : this.unheld + dt
    if (this.unheld > this.bones.size.beat) for (const side of SIDES) if (feet[side].held) feet[side].free()
    gait.advance(now)
    gait.hips.advance(now)
    // (a foot the story has is watched: how fast it moves is how it moved)
    for (const side of SIDES) gait.feet[side].advance(now)
    for (const side of SIDES) if (!feet[side].held) feet[side].anchor = this.stands(side)
  }

  /** the legs of the feet of his own reach them from where the hips are, and the hips are told */
  pose(dt: number, feet: Record<Side, Foothold>) {
    const { gait, joints, bones } = this
    const { size } = bones
    // (the hips as planned, let down and shifted ahead for what the hands ask)
    const now = gait.time
    this.hips.value.copy(gait.hips.value).add({ x: Math.sin(this.facing) * this.posture.shift(now), y: -this.posture.low(now), z: Math.cos(this.facing) * this.posture.shift(now) })
    this.hips.velocity.copy(gait.hips.velocity)
    for (const side of SIDES) {
      const foot = gait.feet[side]
      const toes = (this.toes[side] = yawOf(foot.turn))
      if (feet[side].held) continue
      const hip = this.hip(side, new Vector3()).applyAxisAngle(UP, -toes)
      const leg = joints.legs[side]
      const down = !gait.steps[side] && !foot.frames.length
      const [roll, rise] = [(ROLL.down * dt) / size.beat, (ROLL.up * dt) / size.beat]
      if (!down) this.heel[side] = this.pitch[side]
      const was = this.heel[side]
      const anchor = at.copy(foot.value).applyAxisAngle(UP, -toes)
      if (down) this.heel[side] = stood(size, leg, anchor, hip, was - clamp(was, -roll, roll), Math.min(HEEL, was + rise), ankle)
      else ankle.copy(anchor)
      // (coming down, or leaving the ground heel up, it goes on from where its ankle was, and eases to where it is to be)
      if (down !== this.down[side]) this.eased[side].copy(this.ankle[side]).applyAxisAngle(UP, -toes).sub(ankle)
      this.down[side] = down
      ankle.add(this.eased[side].multiplyScalar(Math.exp((-EASE * dt) / size.beat)))
      this.ankle[side].copy(ankle).applyAxisAngle(UP, toes)
      const { first, fold } = leg.reach(from.copy(ankle).sub(hip))
      leg.first.follow(first, dt)
      leg.second.follow(from.set(fold, 0, 0), dt)
    }
  }

  /** where a hip is, the pelvis turned and listing as it is */
  private hip(side: Side, to: Vector3) {
    const { turn, list } = this.gait.pelvis
    to.set(Math.cos(turn) * Math.cos(list), Math.sin(list), -Math.sin(turn) * Math.cos(list)).multiplyScalar(SIGN[side] * this.bones.size.hip)
    return to.applyAxisAngle(UP, this.facing).add(this.hips.value)
  }

  /** how far a foot is bent toe down against its shin (rad): on the ground flat or on its ball, in the air square to its shin, no further than the ground lets it */
  tread(side: Side, foot: Foothold, dt: number) {
    const { size } = this.bones
    const { first: thigh, second: shin } = this.joints.legs[side]
    const own = !foot.held && !this.gait.steps[side] && !this.gait.feet[side].frames.length
    const hangs = this.pitch[side] + (thigh.value.x + shin.value.x - this.pitch[side]) * Math.min(1, (DROOP * dt) / size.beat)
    // (in the air its toe and heel keep a little off the ground)
    const high = Math.max(0, foot.value.y - this.ground - size.ankle - (own ? 0 : TOE * size.leg))
    const tipped = (sole: number) => {
      const up = (high + size.ankle) / Math.hypot(sole, size.ankle)
      return up < 1 ? Math.asin(up) - Math.atan2(size.ankle, sole) : Infinity
    }
    this.pitch[side] = own ? this.heel[side] : clamp(hangs, -tipped(SOLE.behind * size.leg), tipped(SOLE.ball * size.leg))
    const [least, most] = RANGE.ankle.x
    return clamp(this.pitch[side] - thigh.value.x - shin.value.x, -most, -least)
  }

  /** the hips as the bones are turned from them */
  posed() {
    const { gait } = this
    const { pelvis, hips } = gait
    return {
      value: this.hips.value,
      velocity: this.hips.velocity,
      turn: pelvis.turn,
      turning: pelvis.turning,
      list: pelvis.list,
      listing: pelvis.listing,
      facing: this.facing,
      spins: hips.spin.y,
      lifted: pelvis.breathes(this.bones.size.trunk),
      toes: this.toes,
    }
  }

  /** the free parts come round to what the hips and the legs have them do, and to what his hands ask */
  react(dt: number) {
    const { joints, gait, bones } = this
    const { size } = bones
    const { trunk, head } = joints
    const { hips, going, pelvis } = gait
    const facing = this.facing
    const now = gait.time
    // (the trunk leans as the plan has the hips pushed a little ahead, by the time it has come round)
    const [p0, v0, v1] = [new Vector3(), new Vector3(), new Vector3()]
    const [ahead, h] = [LEAN.ahead * size.beat, 0.066 * size.beat]
    hips.state(now + ahead, p0, v0)
    hips.state(now + ahead + h, p0, v1)
    const pushed = v1.sub(v0).divideScalar(h)
    const way = new Vector3(Math.sin(facing), 0, Math.cos(facing))
    const up = Math.max(GRAVITY * LEAN.light, GRAVITY + pushed.y)
    const speed = hips.velocity.dot(way)
    const flying = SIDES.every((side) => gait.steps[side] || gait.feet[side].frames.length)
    const out = SIDES.reduce((sum, side) => sum + (gait.steps[side] && !flying ? Math.atan2(gait.feet[side].value.clone().sub(hips.value).dot(way), hips.value.y - gait.feet[side].value.y) : 0), 0)
    const lean = (by: number) => Math.atan2(flying ? 0 : (hips.value.y / up) * by, hips.value.y)
    // (into a turn: the whole of him as far as his feet are put out of it, and the trunk further as the ground pushes him round)
    const off = Math.cos(going.facing - going.heading)
    const banks = Math.atan(clamp((going.speed * going.curves) / GRAVITY, -0.5, 0.5)) * off
    const round = LEAN.pushed * Math.atan2(going.speed * going.curves, GRAVITY) * off
    // (low, the hips ride behind the ankles: a shin leans over its foot only as far as an ankle bends)
    const knee = hips.value.y - this.ground - size.ankle - size.shin * Math.cos(ANKLE)
    const behind = Math.max(0, Math.sqrt(Math.max(0, size.thigh ** 2 - knee * knee)) - size.shin * Math.sin(ANKLE))
    const over = Math.asin(Math.min(1, (LEAN.back * behind) / size.leg))
    const upright = clamp(LEAN.pushed * lean(pushed.dot(way)) + over + (LEAN.going * speed) / size.pace - LEAN.swung * out, ...RANGE.trunk.x)
    // (bent for a hand at least as far as that needs, however else he would lean)
    const bend = this.posture.bend(now)
    const along = bend > 0 ? Math.max(upright, bend) : Math.min(upright, bend || upright)
    const tilt = LEAN.listed * (pelvis.list + banks) + round
    const fast = Math.abs(speed) / size.pace
    const { left, right } = joints.legs
    const swung = ((right.first.value.x - left.first.value.x) / 2) * Math.min(ARMS.most, ARMS.least + ARMS.faster * fast)
    const free = SIDES.filter((side) => joints.arms[side].first.reacts).length / SIDES.length
    // (looking somewhere, the trunk turns there as far as it leads the pelvis, the head the rest)
    const looks = this.looked && this.sight(this.looked)
    // (standing, he turns to face where he looks once his head does not turn that far round, unless he is to face a way)
    if (looks && gait.lead.velocity.length() < 0.1 * size.pace && !gait.course && (this.toward !== undefined || Math.abs(wrap(looks.yaw - facing)) > LEADS.head)) {
      const there = Math.abs(wrap(looks.yaw - facing)) < FACED
      this.toward = there ? undefined : looks.yaw
      gait.face(there ? undefined : { x: Math.sin(looks.yaw), z: Math.cos(looks.yaw) })
    }
    const toward = looks ? clamp(looks.yaw - facing, -LEADS.trunk, LEADS.trunk) : clamp(going.aims, -LEADS.trunk, LEADS.trunk)
    const want = new Vector3(along + (looks ? -0.5 * looks.pitch : 0), pelvis.turn + free * (size.shoulder / size.arm) * swung + toward + this.posture.turn(now), -tilt)
    trunk.react(want, dt)
    want.copy(trunk.value).multiply(LEVEL)
    if (looks) want.x = -looks.pitch - trunk.value.x
    const lead = looks ? looks.yaw - facing : going.aims
    head.react(want.setY(want.y + clamp(lead, -LEADS.head, LEADS.head)), dt)
    const folded = Math.min(ARMS.folded, ARMS.folds * fast * fast)
    // the arms are thrown the way the legs push the hips: forward and up as he pushes off, up while he rises through the air, back as he drops and falls
    const lift = flying ? hips.velocity.y / (FLUNG * size.pace) : pushed.y / GRAVITY
    this.lift += (clamp(lift, LIFT.least, LIFT.most) - this.lift) * (1 - Math.exp(-2 * Math.PI * joints.arms.left.first.rate * dt))
    const thrown = -ARMS.thrown * this.lift
    for (const side of SIDES) {
      const { first: arm, second: forearm, hand } = joints.arms[side]
      const [forth, rear] = RANGE.arm.x
      arm.react(want.set(clamp(Math.max(-Math.PI / 2, SIGN[side] * swung + thrown) - trunk.value.x, forth, rear), 0, 0), dt)
      const closes = Math.min(folded * (1 - ARMS.opens * arm.value.x), Math.PI + 2 * (arm.value.x + trunk.value.x))
      forearm.react(want.set(-Math.max(0, closes), 0, 0), dt)
      if (arm.reacts) joints.arms[side].off(arm.value, forearm.value.x)
      hand.wrist.react(REST, dt)
      hand.fingers?.react(dt)
    }
  }

  /** how a place lies from his shoulders: about y from +z toward +x, and up (rad) */
  private sight(place: Vector3) {
    const { x, y, z } = place.clone().sub(this.hips.value)
    return { yaw: Math.atan2(x, z), pitch: Math.atan2(y - this.bones.size.trunk, Math.hypot(x, z)) }
  }

  /** what the hips and the feet are to do for so many `seconds`, as the plan has them */
  foresee(seconds: number): Foreseen {
    const { gait } = this
    const now = gait.time
    const hips = Array.from({ length: 31 }, (_, k) => {
      const place = new Vector3()
      gait.hips.state(now + (k * seconds) / 30, place, new Vector3())
      return { at: place, time: now + (k * seconds) / 30 }
    })
    const footfalls = SIDES.flatMap((side) => {
      const step = gait.steps[side]
      return step ? [{ at: step.to.clone(), time: step.lands, side, put: false, swings: true }] : []
    })
    const leap = gait.jumping
    const top = leap && { comes: { at: new Vector3(), time: leap.top } }
    if (top) gait.hips.state(top.comes.time, top.comes.at, new Vector3())
    const { going, lead } = gait
    return { hips, footfalls, to: gait.course?.to.clone(), top, facing: going.facing, face: lead.face ?? going.facing, heading: going.heading, led: lead.velocity.clone() }
  }

  /** he stands at his ease where he is, letting go of all a story had him do with `free` */
  stand(free: () => void): Story<boolean> {
    free()
    for (const part of [this.joints.trunk, this.joints.head]) part.free()
    this.looked = undefined
    this.gait.stand()
    return waits(() => true, () => this.gait.arrived)
  }

  /** what the rest of the body asks of the hips and the feet, as the plan has them */
  private carried(): Carrier {
    const { gait, bones } = this
    const self = this
    const facing = (seconds: number) => yawOf(this.turnAt(seconds))
    return {
      get now() {
        return gait.time
      },
      hips(seconds, value, velocity) {
        gait.hips.state(gait.time + seconds, value, velocity)
        return value
      },
      facing,
      spare: (side, seconds, until) => gait.spares(side, seconds, until),
      stale() {},
      take(side, span) {
        if (span) self.taken[side] = span
        else delete self.taken[side]
      },
      get ground() {
        return gait.lead.place.y
      },
      put(side, place, seconds) {
        gait.put(side, place, seconds)
        if (place) self.puts[side] = place.clone()
        else delete self.puts[side]
        return self.puts[side]
      },
      foot(side) {
        const foot = gait.feet[side]
        return {
          get put() {
            return self.puts[side]
          },
          get down() {
            return !gait.steps[side] && !foot.frames.length
          },
          at: foot.value,
        }
      },
      get landing() {
        return gait.jumps && gait.hips.velocity.y <= 0
      },
    }
  }

  /** how he will be turned so long from now, as the plan has his hips */
  private turnAt(seconds: number) {
    const turn = new Quaternion()
    this.gait.hips.state(this.gait.time + seconds, new Vector3(), new Vector3(), turn)
    return turn
  }

  /** what is said of where he goes, which way he faces and where he looks, as the body's words of the same names */
  private words() {
    const { gait } = this
    const self = this
    const arrived = () => waits(() => true, () => gait.arrived)
    return {
      // (led between updates, he is led from the moment the update is for)
      places(time: number) {
        if (self.led) gait.go(self.led, time)
        if (self.placed) gait.at(self.placed, time)
        self.led = self.placed = undefined
      },
      looks: () => {},
      looking: (_share: number) => self.looked,
      to(target: Xyz | { y: number }, way?: { speed?: number; plant?: Side }): Story<boolean> {
        if ('x' in target) {
          gait.walk(target, way)
          return arrived()
        }
        gait.height = Math.min(self.bones.size.stand, target.y)
        return waits(() => true, () => Math.abs(gait.hips.value.y - gait.height) < HIGH * self.bones.size.leg)
      },
      at(place: { x: number; y?: number; z: number }) {
        if (place.y !== undefined) gait.lead.place.y = place.y
        self.placed = place
      },
      when: (to: Ground) => gait.when(flat(to)),
      highest: () => gait.highest(),
      walk(to: Ground, way: { speed?: number; plant?: Side } = {}) {
        gait.walk(flat(to), way)
        return arrived()
      },
      run(run: { speed: number; at: Ground; plant?: Side; push?: number; arrive?: number }): Story {
        const comes = gait.run({ ...run, at: flat(run.at) })
        return (function* () {
          while (gait.time < comes - 1e-9) yield
        })()
      },
      go(velocity: { x: number; z: number }) {
        self.led = { x: velocity.x, z: velocity.z }
      },
      face(way?: { x: number; z: number }): Story<boolean> {
        gait.face(way)
        const faced = () => way === undefined || Math.abs(wrap(Math.atan2(way.x, way.z) - gait.lead.facing)) < FACED
        return waits(() => true, faced)
      },
      look(place?: Xyz) {
        self.looked = place && new Vector3().copy(place)
      },
      knock(velocity: Xyz, _at?: Xyz) {
        // (carried further than a step catches, he steps after the hips)
        const by = new Vector3(velocity.x, 0, velocity.z)
        gait.hips.velocity.add(by)
        // (carried further than a step is worth, he is to rest there and steps after the hips; else he sways back over his feet)
        const carries = by.lengthSq() / 6
        if (carries > 0.114 * self.bones.size.leg) gait.lead.place.addScaledVector(by, carries / by.length())
      },
      jump(top: Xyz): Story<boolean> {
        gait.jump(top)
        return waits(() => true, () => !gait.jumps)
      },
    }
  }
}
