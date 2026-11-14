import { Body, type Side, type Story } from '@drawcall/animate'
import { type Grip, grip, Hand } from '@drawcall/hand'
import { Euler, Group, Mesh, MeshStandardMaterial, Object3D, Quaternion, SphereGeometry, Vector3 } from 'three'
import { grenade, reload, press, type Panel } from './actions'
import { ARM, fore, HOLD, magazine, pistol, RIFLE, rifle } from './rifle'

/** what the player asks of him in a frame: `move` is across (to his right) and along the way he aims, `yaw` and `pitch` the aim (rad: about y from +z toward +x, and up) */
export type Input = {
  move: { x: number; z: number }
  yaw: number
  pitch: number
  sprint?: boolean
  crouch?: boolean
  sights?: boolean
  fire?: boolean
}

/** how fast he walks, crouched, and sprints (m/s) */
const SPEED = { walk: 1.4, crouch: 0.9, sprint: 4.5 }
/** how far off the way he faces the rifle and the trunk turn at the most (rad) */
const TWIST = 0.9
/** how many times a second the rifle comes round to where he aims, like a weight on a spring: as fast as arms swing it */
const SWING = 2.5
/** how far the trunk is turned from the rifle, the left shoulder ahead (rad) */
const BLADE = 0.3
/** how many shots a second, how fast a kick comes on, as the hands on the rifle go with it, and how fast it is over (1/s) */
const SHOTS = 7
const KICK = 30
const SETTLE = 14
/** how high he jumps, and how low his hips are crouched, standing and going (of how high he stands) */
const JUMP = 0.3
const LOW = { still: 0.62, going: 0.76 }
/** how far under his hips his ankles are tucked at the top of a jump: the first of these his legs can make in the time (of his leg) */
const TUCK = [0.62, 0.74, 0.86]
/** a breath (s) and how far the chest turns with it (rad); a shift of his weight (s) and how far the trunk leans with it (rad) */
const BREATH = { every: 3.6, chest: 0.025 }
const SHIFT = { every: 9, lean: 0.03 }
/** how far a magazine comes out of its well, and how long it takes to come out or go in (m, s) */
const PULLED = 0.1
const SLIDE = 0.3
/** how big the grenade is: its radius (m) */
const GRENADE = 0.035

/** a way the rifle is carried: where its butt is from the right shoulder, x to his left, y up, z ahead as he aims (m, for the arm the rifle is drawn for), how it is turned from the aim (rad): to his left, up, and rolled, and how much of the aim it and the trunk follow */
type Carry = { butt: Vector3; yaw: number; pitch: number; roll: number; aimed: number }
export const CARRY = {
  ready: { butt: new Vector3(0.02, -0.06, 0.03), yaw: 0, pitch: 0, roll: 0, aimed: 1 },
  sights: { butt: new Vector3(0.07, 0.0, 0.06), yaw: 0, pitch: 0, roll: 0, aimed: 1 },
  sprint: { butt: new Vector3(-0.04, -0.26, 0.16), yaw: 0.15, pitch: -0.3, roll: 0, aimed: 0 },
  reload: { butt: new Vector3(0.0, -0.1, 0.08), yaw: 0.25, pitch: 0.25, roll: 0, aimed: 1 },
  low: { butt: new Vector3(-0.05, -0.2, 0.12), yaw: 0.3, pitch: -0.8, roll: 0, aimed: 0 },
  sling: { butt: new Vector3(0.1, -0.12, 0.16), yaw: 1.35, pitch: -0.9, roll: 0, aimed: 0 },
} satisfies Record<string, Carry>
export type Mode = keyof typeof CARRY

const UP = new Vector3(0, 1, 0)
const wrap = (angle: number) => angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI))
const clamp = (value: number, least: number, most: number) => Math.min(most, Math.max(least, value))
const about = (yaw: number) => new Quaternion().setFromAxisAngle(UP, yaw)

/** something thrown or dropped: it flies and falls until it lies on the ground */
type Loose = { drawn: Object3D; velocity: Vector3 }

/** A soldier: a body led by the player, a rifle in both hands. What he does besides is a story of `actions`. */
export class Soldier {
  readonly body: Body
  /** all that is drawn of him and what he carries */
  readonly shown = new Group()
  readonly rifle = rifle()
  readonly magazine = magazine()
  readonly spent = magazine()
  readonly grenade = new Mesh(new SphereGeometry(GRENADE), new MeshStandardMaterial({ color: 0x405030 }))
  /** where the magazine sits in the rifle, which slides it out and in */
  readonly well = new Object3D()
  /** the hands, as they were read from the rig at rest, and how each takes hold of what it holds */
  readonly hands: Record<Side, Hand>
  readonly held: Record<'grip' | 'trigger' | 'fore' | 'magazine' | 'grenade', Grip>
  /** how large the rifle and the places it is carried at are drawn for him: his arm against the arm they are drawn for */
  readonly scale: number
  /** what the body could not do, as it said so */
  readonly errors: string[] = []
  /** how an action has the rifle carried, and what it is: one at a time */
  mode?: Mode
  doing?: string
  /** whether he stays where he is for what he is doing */
  rooted = false
  /** whether the magazine is in the rifle */
  loaded = true
  shots = 0
  /** the aim as last asked */
  aimed = { yaw: 0, pitch: 0 }
  private readonly carry: Carry = { ...CARRY.ready, butt: CARRY.ready.butt.clone() }
  private readonly loose: Loose[] = []
  /** how far the rifle is kicked, how far the shots are kicking it, and how long until the next shot (s) */
  private kick = 0
  private shot = 0
  private cool = 0
  /** how far a hit has knocked the trunk, forward and to his left, and how fast it is going (rad, rad/s) */
  private readonly knock = { x: 0, z: 0, vx: 0, vz: 0 }
  /** how far the rifle is turned from the way he faces and up, and how fast each turns (rad, rad/s) */
  private readonly swung = { off: 0, pitch: 0, offs: 0, pitches: 0 }
  private readonly chest: Object3D
  private readonly chestRest: number
  /** how low his hips are held, of how high he stands, and the trigger finger as it was last shaped */
  private low = 1
  private trigger = false
  /** whether the left hand is off the rifle: at the start, until the trunk has turned to bring it in reach, and in a
   * sprint; and whether the trunk is turned as the rifle is carried */
  private freed = true
  private turned = false
  /** how far the magazine was out, how far it is to be, and since when */
  private slid = { from: 0, to: 0, since: 0 }

  /** `rig` is his rigged body, and `clear` tells where the world lets the middle of his hips be, that would be at a place */
  constructor(
    readonly rig: Object3D,
    private readonly clear = (place: { x: number; z: number }) => place,
  ) {
    // (the hands are read while the rig is at rest, before the body poses it)
    const hands = (this.hands = { right: new Hand(rig, 'right'), left: new Hand(rig, 'left') })
    this.body = new Body(rig)
    this.scale = this.body.size.arm / ARM
    this.rifle.scale.setScalar(this.scale)
    this.well.position.copy(RIFLE.well)
    this.well.add(this.magazine)
    this.rifle.add(this.well)
    const part = (name: string) => {
      const found = this.rifle.getObjectByName(name)
      if (!found) throw new Error(`the rifle has no ${name}`)
      return found
    }
    const { held, trigger } = pistol(hands.right, this.rifle)
    this.held = {
      grip: held,
      trigger,
      fore: fore(hands.left, part('fore')),
      magazine: grip(hands.left, this.magazine, HOLD.magazine),
      grenade: grip(hands.right, this.grenade, { at: new Vector3(0, -GRENADE, 0), from: new Vector3(0, -1, 0) }),
    }
    this.shown.add(rig, this.rifle, this.spent, this.grenade)
    this.spent.visible = this.grenade.visible = false
    this.chest = this.bone('chest')
    this.chestRest = this.chest.rotation.x
    this.aim(0, { move: { x: 0, z: 0 }, yaw: 0, pitch: 0 }, false)
    this.hold('right')
  }

  /** a hand takes its grip on the rifle, and keeps it wherever the rifle goes */
  hold(side: Side) {
    const held = side === 'left' ? this.held.fore : this.trigger ? this.held.trigger : this.held.grip
    this.body.hand[side].to(held, { on: held.target })
    this.body.hand[side].shape(held.pose)
    if (side === 'left') this.freed = false
  }

  /** the magazine is to slide out of its well, or back in */
  slide(out: boolean) {
    this.slid = { from: this.slid.to, to: out ? 1 : 0, since: this.body.time }
    return this.body.until(this.body.time + SLIDE)
  }

  /** the magazine in the hand is pushed home: it sits in its well */
  seat() {
    this.well.add(this.magazine)
    this.magazine.position.set(0, 0, 0)
    this.magazine.quaternion.identity()
    this.magazine.scale.setScalar(1)
    this.magazine.visible = this.loaded = true
  }

  private bone(name: string) {
    const found = this.rig.getObjectByName(name)
    if (!found) throw new Error(`the rig has no ${name}`)
    return found
  }
  at(bone: string) {
    return this.bone(bone).getWorldPosition(new Vector3())
  }

  note(error: unknown) {
    const said = error instanceof Error ? error.message : String(error)
    if (this.errors[this.errors.length - 1] !== said) this.errors.push(said)
    if (this.errors.length > 200) this.errors.shift()
  }

  /** plays an action, if he is doing none: when it is over, or the body could not do it, both hands take the rifle again */
  private act(name: string, story: Story) {
    if (this.doing) return false
    const self = this
    this.doing = name
    this.body.play(
      (function* () {
        try {
          yield* story
        } finally {
          self.doing = self.mode = undefined
          self.rooted = false
          if (!self.loaded) self.seat()
          self.slid = { from: 0, to: 0, since: self.body.time }
          if (self.grenade.parent !== self.shown) self.drop(self.grenade, new Vector3())
          for (const side of ['right', 'left'] as const) {
            try {
              self.hold(side)
            } catch (error) {
              self.note(error)
            }
          }
        }
      })(),
    )
    return true
  }
  reload() {
    return this.act('reload', reload(this))
  }
  throw() {
    return this.act('grenade', grenade(this))
  }
  press(panel: Panel) {
    return this.act('press', press(this, panel))
  }

  /** jumps, on the way he is going: by the top of it his legs are tucked, as far as they can be by then, and his again to land on */
  jump() {
    const { body } = this
    if (this.doing || this.airborne) return false
    const { value, velocity } = body.hips
    try {
      body.play(
        body.jump({ x: value.x + velocity.x * 0.4, y: body.size.stand * (1 + JUMP), z: value.z + velocity.z * 0.4 }),
      )
    } catch (error) {
      this.note(error)
      return false
    }
    this.airborne = true
    const top = body.highest()
    const feet = [body.foot.left, body.foot.right]
    for (const tuck of TUCK) {
      try {
        for (const foot of feet) foot.by(top, { x: 0, y: -tuck * body.size.leg, z: 0.12 * body.size.leg }, { on: body })
        break
      } catch {
        for (const foot of feet) foot.free()
      }
    }
    return true
  }
  private airborne = false

  /** a blow that goes a way along the ground knocks his trunk that way, and he takes a step after it */
  hit(way: { x: number; z: number }) {
    const turned = new Vector3(way.x, 0, way.z).normalize().applyQuaternion(about(-this.facing))
    this.knock.vx += 5 * turned.z
    this.knock.vz += 5 * turned.x
    const { x, z } = this.body.hips.value
    this.body.hips.at({ x: x + 0.1 * way.x, z: z + 0.1 * way.z })
  }

  /** the way he faces, about y from +z toward +x (rad) */
  get facing() {
    const { x, z } = this.body.facing
    return Math.atan2(x, z)
  }

  /** lets something go into the world, moving so */
  drop(drawn: Object3D, velocity: Vector3) {
    this.shown.attach(drawn)
    const flying = this.loose.find((thing) => thing.drawn === drawn)
    if (flying) flying.velocity.copy(velocity)
    else this.loose.push({ drawn, velocity: velocity.clone() })
  }

  update(delta: number, input: Input) {
    const { body } = this
    this.aimed = { yaw: input.yaw, pitch: input.pitch }
    const aim = { x: Math.sin(input.yaw), z: Math.cos(input.yaw) }
    // he goes across and along the way he aims, and faces it: sprinting, the way he goes
    const far = this.rooted ? 0 : Math.hypot(input.move.x, input.move.z)
    const sprints = Boolean(input.sprint) && far > 0 && !input.crouch && !this.doing
    const speed = far > 0 ? (sprints ? SPEED.sprint : input.crouch ? SPEED.crouch : SPEED.walk) / far : 0
    const asked = {
      x: (aim.x * input.move.z - aim.z * input.move.x) * speed,
      z: (aim.z * input.move.z + aim.x * input.move.x) * speed,
    }
    // as the world lets him go: from where he is, on to where it lets him be a moment on
    const from = body.hips.value
    const on = this.clear({ x: from.x + asked.x * delta, z: from.z + asked.z * delta })
    const going = delta > 0 ? { x: (on.x - from.x) / delta, z: (on.z - from.z) / delta } : asked
    // crouched, his hips are held low, lower still where he stands
    const low = input.crouch && !this.airborne ? (far > 0 ? LOW.going : LOW.still) : 1
    try {
      if (low !== this.low) body.hips.to({ y: (this.low = low) * body.size.stand })
      body.go(going)
      if (sprints) body.face()
      else body.face(aim)
      // sprinting, the rifle swings in the right hand alone, the left arm free to pump: it takes the rifle once that is
      // up where it reaches and the trunk turned to it, as at the start
      if (sprints && !this.freed) {
        body.hand.left.free()
        this.freed = true
      }
      if (!sprints && this.freed && !this.doing && this.carry.aimed > 0.9 && this.turned) this.hold('left')
    } catch (error) {
      this.note(error)
    }

    if (delta > 0) this.fire(delta, Boolean(input.fire) && !sprints && !this.doing)
    this.aim(delta, input, sprints)
    this.breathe()
    try {
      body.update(delta)
    } catch (error) {
      this.note(error)
    }
    if (this.airborne && !body.playing) this.airborne = false
    // and where the world has stopped him is told to the body
    const stopped = this.clear(body.hips.value)
    if (stopped.x !== body.hips.value.x || stopped.z !== body.hips.value.z) body.hips.at(stopped)
    this.place(delta)
  }

  /** a shot kicks the rifle back and up, and the kick dies away */
  private fire(delta: number, held: boolean) {
    this.cool -= delta
    this.shot *= Math.exp(-SETTLE * delta)
    this.kick += (this.shot - this.kick) * (1 - Math.exp(-KICK * delta))
    if (!held || this.cool > 0 || !this.loaded) return
    this.cool = 1 / SHOTS
    this.shot = 1
    this.shots++
  }

  /** the rifle is carried as he aims, its butt at his right shoulder, and the trunk and the head go with it: the hands are on it */
  private aim(delta: number, input: Input, sprints: boolean) {
    const { body, carry, kick, knock } = this
    const to: Carry = CARRY[this.mode ?? (sprints ? 'sprint' : input.sights ? 'sights' : 'ready')]
    // a carry comes on as fast as the hands holding the rifle can follow it
    const share = delta > 0 ? 1 - Math.exp(-7 * delta) : 1
    carry.butt.lerp(to.butt, share)
    for (const key of ['yaw', 'pitch', 'roll', 'aimed'] as const) carry[key] += (to[key] - carry[key]) * share

    const facing = this.facing
    const { swung } = this
    const pull = 2 * Math.PI * SWING
    const toward = (at: number, rate: number, to: number) =>
      (rate + pull * pull * (to - at) * delta) / (1 + pull * delta) ** 2
    swung.offs = toward(swung.off, swung.offs, clamp(wrap(input.yaw - facing), -TWIST, TWIST) * carry.aimed)
    swung.pitches = toward(swung.pitch, swung.pitches, input.pitch * carry.aimed)
    swung.off += swung.offs * delta
    swung.pitch += swung.pitches * delta
    const { off, pitch } = swung
    // a hit knocks the trunk, which swings back like a weight on a spring
    knock.vx += (-60 * knock.x - 9 * knock.vx) * delta
    knock.vz += (-60 * knock.z - 9 * knock.vz) * delta
    knock.x += knock.vx * delta
    knock.z += knock.vz * delta
    // the trunk turns and leans with the aim, gives to a shot, and shifts his weight; the head looks along the aim, and down to the sights
    const sway = Math.sin((2 * Math.PI * body.time) / SHIFT.every) * SHIFT.lean
    const blade = BLADE * carry.aimed
    const trunk = {
      x: clamp(-0.4 * pitch - 0.04 * kick + knock.x, -0.5, 0.8),
      y: clamp(off - blade - 0.06 * kick, -1.2, 1.2),
      z: clamp(sway + knock.z, -0.4, 0.4),
    }
    const sighted = to === CARRY.sights ? 1 : 0
    this.turned = Math.abs(body.trunk.value.y - trunk.y) < 0.05
    try {
      body.trunk.to(trunk)
      body.head.to({
        x: clamp(-pitch - trunk.x + 0.12 * sighted + 0.5 * knock.x, -0.7, 0.7),
        y: clamp(off - trunk.y - 0.15 * sighted, -1.2, 1.2),
        z: clamp(-0.3 * sighted - sway + 0.5 * knock.z, -0.5, 0.5),
      })
    } catch (error) {
      this.note(error)
    }

    // the rifle: its butt from the right shoulder, turned as it is carried, kicked back along itself and up
    const { rifle } = this
    rifle.quaternion.setFromEuler(
      new Euler(-(pitch + carry.pitch + 0.08 * kick), facing + off + carry.yaw, carry.roll, 'YXZ'),
    )
    rifle.position
      .copy(carry.butt)
      .multiplyScalar(this.scale)
      .applyQuaternion(about(facing + off))
      .add(this.at('rightUpperArm'))
      .add(new Vector3(0, 0, -0.05 * this.scale * kick).applyQuaternion(rifle.quaternion))
    // the trigger finger lies along the frame, and is on the trigger for a shot
    const trigger = Boolean(input.fire) && !sprints && !this.doing
    if (trigger !== this.trigger)
      body.hand.right.shape(((this.trigger = trigger) ? this.held.trigger : this.held.grip).pose)
  }

  /** he breathes: the chest, which the body leaves alone, turns a little with each breath */
  private breathe() {
    this.chest.rotation.x =
      this.chestRest - BREATH.chest * (0.5 + 0.5 * Math.sin((2 * Math.PI * this.body.time) / BREATH.every))
  }

  /** the magazine is as far out of its well as it is sliding, and what is loose flies and falls */
  private place(delta: number) {
    const { from, to, since } = this.slid
    const share = Math.min(1, (this.body.time - since) / SLIDE)
    this.well.position
      .copy(RIFLE.well)
      .setY(RIFLE.well.y - PULLED * (from + (to - from) * share * share * (3 - 2 * share)))
    for (const thing of this.loose) {
      if (thing.drawn.position.y <= 0.03) continue
      thing.velocity.y -= 9.81 * delta
      thing.drawn.position.addScaledVector(thing.velocity, delta)
      if (thing.drawn.position.y <= 0.03) thing.drawn.position.y = 0.03
    }
  }
}
