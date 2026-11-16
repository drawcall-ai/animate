import { Body, type Side, type Story, type Thing, type Xyz } from '@drawcall/animate'
import { type Grip, grip, Hand, point, type Statement } from '@drawcall/hand'
import { BoxGeometry, Euler, Group, Mesh, MeshStandardMaterial, Object3D, SphereGeometry, Vector3 } from 'three'
import { inHand, lying } from '../character'
import { pocket } from '../shooter/rifle'

/** what leads him: how far he is asked to go forward and to his left, how he turns his aim (left positive), how far up he aims (rad), and what he is asked to do */
export type Input = {
  forward: number
  left: number
  turn: number
  pitch: number
  sprint: boolean
  reload: boolean
  grenade: boolean
}

/** how fast he goes (m/s), and how fast he turns his aim (rad/s) */
const SPEED = { forward: 1.4, side: 1.2, back: 0.9, sprint: 4.5 }
const TURN = 1.4
/** how far off a place is that he looks at to aim a way (m) */
const FAR = 1000

/** the rifle as boxes, its butt at the origin, the muzzle along +z, up +y and his left +x: how wide, high and long each is, and where its middle is (m) */
const PARTS = [
  { size: [0.05, 0.1, 0.22], at: [0, -0.01, 0.11] },
  { size: [0.055, 0.1, 0.18], at: [0, 0, 0.31] },
  { size: [0.05, 0.05, 0.18], at: [0, -0.01, 0.49] },
  { size: [0.02, 0.02, 0.2], at: [0, 0.005, 0.68] },
  { size: [0.015, 0.03, 0.05], at: [0, 0.065, 0.3] },
  { size: [0.03, 0.09, 0.04], at: [0, -0.09, 0.25] },
  { size: [0.008, 0.025, 0.008], at: [0, -0.0625, 0.29] },
] as const
/**
 * the grip under the handguard, which the left hand holds: upright, as a hand round the handguard itself has its
 * fingers across the rifle, and a forearm reaching forward along it cannot bend the wrist that far
 */
const GUARD = { size: [0.03, 0.08, 0.03], at: [0, -0.075, 0.43] } as const
/** the magazine: how wide, high and long it is, and where its middle is in the rifle */
const MAG = { size: [0.03, 0.14, 0.06], in: [0, -0.12, 0.35] } as const
const BALL = 0.035

/**
 * how the hands take hold: the right round the pistol grip from behind, its palm on the back, the index lying along
 * the frame; the left round the grip under the handguard, from his side; the left on the magazine's side; the right
 * round the grenade
 */
const GRIP: Record<'grip' | 'fore' | 'mag' | 'ball', Statement> = {
  grip: {
    at: new Vector3(0, -0.09, 0.23),
    from: new Vector3(-1, 0, -0.5).normalize(),
    using: ['palm', 'thumb', 'middle', 'ring', 'little'],
    start: point,
  },
  fore: { at: new Vector3(GUARD.size[0] / 2, 0, 0), from: new Vector3(1, 0, 0) },
  mag: { at: new Vector3(MAG.size[0] / 2, 0, 0), from: new Vector3(1, 0, 0) },
  ball: { at: new Vector3(0, -BALL, 0), from: new Vector3(0, -1, 0) },
}
/** how far the magazine comes out of its well, and how long it takes to come out or go in (s) */
const PULLED = new Vector3(0, -0.1, 0)
const SLIDE = 0.3
/** places counted from the shoulder of the hand that goes there, as he faces: a pouch on his chest, the grenade on his belt, where it is let go */
const BODY = { pouch: [-0.12, -0.3, 0.28], belt: [0.02, -0.5, 0.2], release: [-0.02, 0.32, 0.2] } as const
const THROW = { speed: 6.5, lift: 0.5, wind: 0.9 }

/**
 * how the rifle is carried, its butt in the pocket of a shoulder: how far its muzzle is down from where he aims (rad),
 * and which shoulder
 */
const CARRY = { shoulder: { down: 0, side: 'right' }, low: { down: 0.5, side: 'right' }, hung: { down: 0.6, side: 'left' } } as const
type Carry = keyof typeof CARRY
const GRAVITY = 9.81

const metal = new MeshStandardMaterial({ color: 0x33363a })
const box = ([wide, high, long]: readonly number[], at: readonly number[]) => {
  const drawn = new Mesh(new BoxGeometry(wide, high, long), metal)
  drawn.position.set(at[0], at[1], at[2])
  return drawn
}
const place = ([x, y, z]: readonly number[]): Xyz => ({ x, y, z })
const ease = (share: number) => share * share * (3 - 2 * share)

/** something let go, falling */
type Loose = { thing: Object3D; velocity: Vector3; age: number }

/**
 * A soldier led by the keyboard, who carries a rifle in both hands and looks where he aims. The game moves the rifle,
 * its butt in his shoulder's pocket, pointing where he aims, and the hands on it follow it.
 */
export class Soldier {
  readonly body: Body
  readonly object = new Group()
  readonly rifle = new Group()
  /** where he aims (rad, counted from +z toward his left), and how far up, and where he was last told to look */
  aim = 0
  pitch = 0
  private looked?: { aim: number; pitch: number }
  /** where the magazine sits in the rifle, which slides it out and in, and the magazine */
  readonly well = new Object3D()
  readonly guard = box(GUARD.size, GUARD.at)
  mag = box(MAG.size, [0, 0, 0])
  ball = new Mesh(new SphereGeometry(BALL), metal)
  /** the hands, as they were read from the rig at rest, how each takes hold of what it holds, and the rifle as he holds it */
  private readonly hands: Record<Side, Hand>
  private readonly held: Record<keyof typeof GRIP, Grip>
  private readonly gun: Thing
  readonly errors: string[] = []
  private readonly loose: Loose[] = []
  private readonly was = { reload: false, grenade: false }
  private busy = false
  /** how the rifle is carried */
  private carry: Carry = 'shoulder'
  /** how far the magazine was out, how far it is to be, and since when */
  private slid = { from: 0, to: 0, since: 0 }

  constructor(man: Object3D) {
    this.well.position.fromArray(MAG.in)
    this.well.add(this.mag)
    this.rifle.add(...PARTS.map(({ size, at }) => box(size, at)), this.guard, this.well)
    this.object.add(man, this.rifle)
    const hands = (this.hands = { right: new Hand(man, 'right'), left: new Hand(man, 'left') })
    this.held = {
      grip: grip(hands.right, this.rifle, GRIP.grip),
      fore: grip(hands.left, this.guard, GRIP.fore),
      mag: grip(hands.left, this.mag, GRIP.mag),
      ball: grip(hands.right, this.ball, GRIP.ball),
    }
    this.body = new Body(man)
    this.gun = this.body.bind(this.rifle, { outside: true })
    this.pose()
    this.gun.in(this.body.hand.right, this.held.grip)
    this.gun.in(this.body.hand.left, this.held.fore)
  }

  /** both hands go on the rifle by their grips */
  private onRifle() {
    this.gun.on(this.body.hand.right, this.held.grip)
    this.gun.on(this.body.hand.left, this.held.fore)
  }

  /** the magazine is to slide out of its well, or back in */
  private slide(out: boolean) {
    this.slid = { from: this.slid.to, to: out ? 1 : 0, since: this.body.time }
    return this.body.until(this.body.time + SLIDE)
  }

  /** the rifle is in his shoulder's pocket, pointing where he aims as it is carried, and the magazine is as far out as it slides */
  private pose() {
    const { down, side } = CARRY[this.carry]
    const pitch = down - (this.carry === 'shoulder' ? this.pitch : 0)
    this.rifle.quaternion.setFromEuler(new Euler(pitch, this.aim, 0, 'YXZ'))
    this.rifle.position.copy(this.object.worldToLocal(pocket(this.body, side)))
    const { from: was, to: out, since: moved } = this.slid
    const slid = was + (out - was) * ease(Math.min(1, (this.body.time - moved) / SLIDE))
    this.well.position.fromArray(MAG.in).addScaledVector(PULLED, slid)
  }

  update(delta: number, input: Input) {
    const { body } = this
    this.aim += input.turn * TURN * delta
    this.pitch = input.pitch
    const way = new Vector3(Math.sin(this.aim), 0, Math.cos(this.aim))
    const side = new Vector3(Math.cos(this.aim), 0, -Math.sin(this.aim))
    const sprint = input.sprint && input.forward > 0 && !this.busy
    const ahead = input.forward * (input.forward > 0 ? SPEED.forward : SPEED.back)
    const go = sprint
      ? way.clone().multiplyScalar(SPEED.sprint)
      : way
          .clone()
          .multiplyScalar(ahead)
          .addScaledVector(side, input.left * SPEED.side)
    body.go({ x: go.x, z: go.z })
    if (sprint) body.face()
    else body.face(way)
    // he looks where he aims, as high as he aims, but where he goes in a sprint
    const looks = sprint ? undefined : { aim: this.aim, pitch: this.pitch }
    if (looks?.aim !== this.looked?.aim || looks?.pitch !== this.looked?.pitch) {
      const aimed = way.clone().multiplyScalar(Math.cos(this.pitch)).setY(Math.sin(this.pitch))
      body.look(looks && aimed.multiplyScalar(FAR).add(body.hips.value))
      this.looked = looks
    }
    if (!this.busy) this.carry = sprint ? 'low' : 'shoulder'
    // (he begins one only with both hands on the rifle)
    const free = !this.busy && this.gun.there
    if (input.reload && !this.was.reload && free) this.begin(this.reload())
    if (input.grenade && !this.was.grenade && free) this.begin(this.grenade())
    this.was.reload = input.reload
    this.was.grenade = input.grenade
    // (where his shoulder was last posed: the hands follow the rifle from there through the update)
    this.pose()
    try {
      body.update(delta)
    } catch (error) {
      this.errors.push(`${body.time.toFixed(2)} ${(error as Error).message}`)
    }
    this.fall(delta)
  }

  private begin(story: Story) {
    this.busy = true
    const soldier = this
    this.body.play(
      (function* () {
        try {
          yield* story
        } finally {
          // (over, or cut short by what the body could not do, the hands are on the rifle again)
          soldier.busy = false
          soldier.onRifle()
        }
      })(),
    )
  }

  /** lets something go from where it is, with the speed it has */
  private drop(thing: Object3D, velocity: Vector3) {
    this.object.attach(thing)
    this.loose.push({ thing, velocity: velocity.clone(), age: 0 })
  }

  private fall(delta: number) {
    for (const one of this.loose) {
      one.age += delta
      one.velocity.y -= GRAVITY * delta
      one.thing.position.addScaledVector(one.velocity, delta)
      if (one.thing.position.y < 0.03) one.velocity.set(0, 0, 0)
      if (one.age > 4) one.thing.removeFromParent()
    }
  }

  private *reload(): Story {
    const { body, held, hands } = this
    const { left } = body.hand
    // the left hand takes the magazine and pulls it out, lets it fall, and fetches a fresh one from his chest
    this.carry = 'shoulder'
    this.gun.off(left)
    yield* left.to(held.mag)
    yield* this.slide(true)
    this.drop(this.mag, left.velocity)
    yield* left.to(place(BODY.pouch), { on: body })
    // (the fresh one is in his hand as it comes out of the pouch)
    this.mag = box(MAG.size, [0, 0, 0])
    this.object.add(this.mag)
    const fresh = grip(hands.left, this.mag, GRIP.mag)
    const mag = inHand(body, hands.left, fresh)
    // pushes it in, upright in the well, and goes back to the handguard
    yield* mag.to({ x: 0, y: 0, z: 0 }, { on: this.well, ...lying(hands.left, fresh) })
    mag.free()
    this.well.attach(this.mag)
    yield* this.slide(false)
  }

  private *grenade(): Story {
    const { body, hands, ball } = this
    const { right } = body.hand
    // the rifle rests in his left shoulder in his left hand, the right takes the grenade from his belt and throws it
    // overarm the way he aims
    this.gun.off(right)
    this.carry = 'hung'
    yield* right.to(place(BODY.belt), { on: body })
    this.object.add(ball)
    const grenade = inHand(body, hands.right, grip(hands.right, ball, GRIP.ball))
    const way = new Vector3(Math.sin(this.aim), 0, Math.cos(this.aim))
    const velocity = way.multiplyScalar(THROW.speed * Math.cos(THROW.lift)).setY(THROW.speed * Math.sin(THROW.lift))
    yield* grenade.by(body.time + THROW.wind, place(BODY.release), { on: body, velocity })
    this.drop(ball, grenade.free())
  }
}
