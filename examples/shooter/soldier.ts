import { Body, type Side, type Story } from '@drawcall/animate'
import { type Grip, grip, Hand } from '@drawcall/hand'
import { type PhysicsWorld, RigidBody } from '@drawcall/physics'
import { Euler, Group, Mesh, MeshStandardMaterial, Object3D, Quaternion, SphereGeometry, Vector3 } from 'three'
import { grenade, reload, press, type Panel } from './actions'
import { Capsule } from '../capsule'
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

/** how fast he walks, crouched, and sprints, and from how fast he carries the rifle low (m/s) */
const SPEED = { walk: 1.4, crouch: 0.9, sprint: 4.5, low: 2 }
/** how fast he leaves the ground in a jump (m/s) */
const JUMP = 3
/** how fast the world has things fall (m/s²) */
const GRAVITY = 9.81
/**
 * how many shots a second, and how fast a shot kicks his shoulder back, a hit sets his chest going, and it shoves him
 * along the ground (m/s)
 */
const SHOTS = 7
const KICK = 0.6
const HIT = { chest: 2.5, shove: 1.2 }
/**
 * how far to the right of the aim he faces, side-on to the rifle as a rifleman is, his left shoulder ahead: his trunk
 * keeps so, turned to the aim his left hand would not reach the rifle, and his head with it (rad)
 */
const STANCE = 0.5
/** how low his hips are crouched, standing and going (of how high he stands) */
const LOW = { still: 0.62, going: 0.76 }
/** how high and how wide the capsule the world moves him as is (of how high his hips stand) */
const CAPSULE = { high: 1.9, radius: 0.32 }
/** how far a magazine comes out of its well, and how long it takes to come out or go in (m, s) */
const PULLED = 0.1
const SLIDE = 0.3
/** how big a grenade is: its radius (m) */
const GRENADE = 0.035
/** how far off a place is that he looks at to look a way (m) */
const FAR = 1000
/** how many things thrown or dropped lie about at the most */
const LOOSE = 30

/**
 * the ways the rifle is carried, its butt in his right shoulder: how it is turned from the aim, or from the way he
 * faces if it is not `aimed` (rad), to his left and up
 */
const CARRY = {
  ready: { yaw: 0, pitch: 0, aimed: true },
  low: { yaw: 0.7, pitch: -0.5, aimed: false },
  reload: { yaw: 0.45, pitch: 0.3, aimed: true },
  slung: { yaw: 0, pitch: -0.15, aimed: true },
}
export type Mode = keyof typeof CARRY
/** how an aim is turned in the scene */
const turned = (yaw: number, pitch: number) => new Quaternion().setFromEuler(new Euler(-pitch, yaw, 0, 'YXZ'))

/** A soldier: a body led by a capsule the player moves, a rifle in both hands. What he does besides is a story of `actions`. */
export class Soldier {
  readonly body: Body
  readonly capsule: Capsule
  /** all that is drawn of him and what he carries */
  readonly shown = new Group()
  readonly rifle = rifle()
  readonly magazine = magazine()
  spent = magazine()
  grenade = Soldier.grenade()
  /** where the magazine sits in the rifle, which slides it out and in */
  readonly well = new Object3D()
  /** the hands, as they were read from the rig at rest, and how each takes hold of what it holds */
  readonly hands: Record<Side, Hand>
  readonly held: Record<'grip' | 'trigger' | 'fore' | 'magazine' | 'grenade', Grip>
  /** how large the rifle is drawn for him: his arm against the arm it is drawn for */
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
  /** the aim as last asked, and whether down the sights */
  aimed = { yaw: 0, pitch: 0, sights: false }
  private readonly loose: Object3D[] = []
  /** how long until the next shot (s) */
  private cool = 0
  /** how low his hips are held, of how high he stands, and the trigger finger as it was last shaped */
  private low = 1
  private trigger = false
  /** how far the magazine was out, how far it is to be, and since when */
  private slid = { from: 0, to: 0, since: 0 }

  /** `rig` is his rigged body, standing where the `world` is to move him from */
  constructor(
    readonly rig: Object3D,
    world: PhysicsWorld,
  ) {
    // (the hands are read while the rig is at rest, before the body poses it)
    const hands = (this.hands = { right: new Hand(rig, 'right'), left: new Hand(rig, 'left') })
    const body = (this.body = new Body(rig))
    this.scale = body.size.arm / ARM
    this.capsule = new Capsule(world, new Object3D(), CAPSULE.radius, CAPSULE.high * body.size.stand)

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
    this.shown.add(rig, this.rifle)
    this.rifle.position.copy(body.eye('right'))
    this.carry({ move: { x: 0, z: 0 }, yaw: 0, pitch: 0 }, false)
    this.look(this.aimed)
    this.hold()
  }

  private static grenade() {
    return new Mesh(new SphereGeometry(GRENADE), new MeshStandardMaterial({ color: 0x405030 }))
  }

  /** both hands take their grips on the rifle, which gives way to them, its butt resting in a shoulder */
  hold() {
    this.body.hold(this.rifle, { rests: RIFLE.butt })
    this.body.hand.right.to(this.trigger ? this.held.trigger : this.held.grip)
    this.body.hand.left.to(this.held.fore)
  }

  /** the magazine is to slide out of its well, or back in */
  slide(out: boolean) {
    this.slid = { from: this.slid.to, to: out ? 1 : 0, since: this.body.time }
    return this.body.until(this.body.time + SLIDE)
  }

  /** the magazine in the hand is pushed home: it sits in its well */
  seat() {
    this.body.hold(this.magazine).free()
    this.well.add(this.magazine)
    this.magazine.position.set(0, 0, 0)
    this.magazine.quaternion.identity()
    this.magazine.scale.setScalar(1)
    this.magazine.visible = this.loaded = true
  }

  note(error: unknown) {
    const said = error instanceof Error ? error.message : String(error)
    if (this.errors[this.errors.length - 1] === said) return
    console.warn(said)
    this.errors.push(said)
    if (this.errors.length > 200) this.errors.shift()
  }

  private tried(act: () => void) {
    try {
      act()
    } catch (error) {
      this.note(error)
    }
  }

  /** plays an action, if he is doing none: when it is over, or the body could not do it, both hands are sent to the rifle again */
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
          if (self.grenade.parent) {
            self.body.hold(self.grenade).free()
            self.drop(self.grenade, new Vector3())
          }
          self.hold()
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

  /** he jumps if he stands: the body drops and pushes off, and the capsule leaves the ground as it does */
  jump() {
    const { body, capsule } = this
    if (!capsule.grounded || body.highest() > body.time) return false
    const top = capsule.position.clone().setY(capsule.floor + body.size.stand + JUMP ** 2 / (2 * GRAVITY))
    this.tried(() => body.jump(top))
    return capsule.jump(JUMP, body.highest() - JUMP / GRAVITY - body.time)
  }

  /** a blow to his chest that goes a way along the ground: it sways him, and shoves him for him to step after */
  hit(way: { x: number; z: number }) {
    const along = new Vector3(way.x, 0, way.z).normalize()
    this.body.knock(along.clone().multiplyScalar(HIT.chest))
    this.capsule.velocity.addScaledVector(along, HIT.shove)
  }

  /** lets something go into the world, moving so: a body of its own there, which flies and falls */
  drop(thing: Object3D, velocity: Vector3) {
    const solid = new RigidBody({ mass: 0.4, velocity: { linear: velocity.toArray() } })
    thing.updateWorldMatrix(true, false)
    thing.matrixWorld.decompose(solid.position, solid.quaternion, thing.scale)
    thing.position.set(0, 0, 0)
    thing.quaternion.identity()
    solid.add(thing)
    this.shown.add(solid)
    this.loose.push(solid)
    if (this.loose.length > LOOSE) this.loose.shift()?.removeFromParent()
    if (thing === this.grenade) {
      // (a fresh one, held as the last was)
      this.grenade = Soldier.grenade()
      this.held.grenade = { ...this.held.grenade, target: this.grenade }
    }
    if (thing === this.spent) this.spent = magazine()
  }

  /** a frame: the capsule goes as the player asks, and he is led as it goes, to where it is by then */
  update(delta: number, input: Input) {
    const { body, capsule } = this
    const aim = { x: Math.sin(input.yaw), z: Math.cos(input.yaw) }
    // he goes across and along the way he aims
    const far = this.rooted ? 0 : Math.hypot(input.move.x, input.move.z)
    // (he sprints only forward)
    const sprints = Boolean(input.sprint) && input.move.z > 0 && !input.crouch && !this.doing
    const speed = far > 0 ? (sprints ? SPEED.sprint : input.crouch ? SPEED.crouch : SPEED.walk) / far : 0
    const [across, along] = [input.move.x * speed, input.move.z * speed]
    capsule.asked.set(aim.x * along - aim.z * across, 0, aim.z * along + aim.x * across)
    capsule.crouch = Boolean(input.crouch)
    capsule.update(delta)
    // crouched, his hips are held low, lower still once he stands
    const { x, z } = capsule.velocity
    const going = far > 0 || Math.hypot(x, z) > 0
    const low = capsule.crouched && capsule.grounded ? (going ? LOW.going : LOW.still) : 1
    const runs = Math.hypot(x, z) > SPEED.low
    // he looks along the aim, his head turned from the way he faces: down the sights over the rear sight
    const sights = Boolean(input.sights) && !this.mode && !runs
    const { yaw, pitch } = input
    if (yaw !== this.aimed.yaw || pitch !== this.aimed.pitch || sights !== this.aimed.sights)
      this.look((this.aimed = { yaw, pitch, sights }))
    this.tried(() => {
      if (low !== this.low) body.hips.to({ y: (this.low = low) * body.size.stand })
      // (off the ground, how fast he goes up or down too)
      body.go({ x, z })
      // (running, he faces the way he goes)
      // (throwing, he squares up to the aim: the arm comes over ahead of him, where he sees it let go)
      const side = this.doing === 'grenade' ? 0 : STANCE
      body.face(runs ? undefined : { x: Math.sin(input.yaw - side), z: Math.cos(input.yaw - side) })
    })
    // (he fires only with both hands on the rifle)
    const holds = body.hand.right.there && body.hand.left.there
    if (delta > 0) this.fire(delta, Boolean(input.fire) && !runs && !this.doing && holds)
    this.carry(input, runs)
    // where the world has him by the end of the frame
    const { position, floor } = capsule
    this.tried(() => body.hips.at({ x: position.x, y: floor, z: position.z }))
    this.tried(() => body.update(delta))
    this.place()
  }

  /** he looks a way: at a place so far off along it that where he is makes no odds */
  private look({ yaw, pitch, sights }: Soldier['aimed']) {
    const way = new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
    const far = way.multiplyScalar(FAR).add(this.body.hips.value)
    this.body.look(far, sights ? { over: RIFLE.sight, on: this.rifle } : {})
  }

  /** a shot kicks his shoulder back along the rifle */
  private fire(delta: number, held: boolean) {
    this.cool -= delta
    if (!held || this.cool > 0 || !this.loaded) return
    this.cool = 1 / SHOTS
    this.shots++
    const back = new Vector3(0, 0, -KICK).applyQuaternion(this.rifle.quaternion)
    this.body.knock(back, this.rifle.getWorldPosition(new Vector3()))
  }

  /**
   * the rifle is to point as an action carries it, or low going faster than a walk, and along the aim else; and the
   * trigger finger lies along the frame, and is on the trigger for a shot
   */
  private carry(input: Input, runs: boolean) {
    const { yaw, pitch, aimed } = CARRY[this.mode ?? (runs ? 'low' : 'ready')]
    const faces = Math.atan2(this.body.facing.x, this.body.facing.z)
    this.rifle.quaternion.copy(turned((aimed ? input.yaw : faces) + yaw, (aimed ? input.pitch : 0) + pitch))
    const trigger = Boolean(input.fire) && !runs && !this.doing
    if (trigger !== this.trigger)
      this.body.hand.right.shape(((this.trigger = trigger) ? this.held.trigger : this.held.grip).pose)
  }

  /** the magazine is as far out of its well as it is sliding */
  private place() {
    const { from, to, since } = this.slid
    const share = Math.min(1, (this.body.time - since) / SLIDE)
    this.well.position
      .copy(RIFLE.well)
      .setY(RIFLE.well.y - PULLED * (from + (to - from) * share * share * (3 - 2 * share)))
  }
}
