import { Body, type Side, type Story, type Xyz } from '@drawcall/animate'
import { flat, type Grip, grip, Hand, point, type Statement } from '@drawcall/hand'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Object3D, SphereGeometry, Vector3 } from 'three'
import { hang } from '../carry'

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

/** how the rifle is carried on his chest: where its butt is from the chest bone (m, as he faces) and how far its muzzle is down (rad); and how long it takes from one way to another (s) */
const CARRY = {
  shoulder: { butt: [-0.17, 0.12, 0.08], down: 0 },
  low: { butt: [-0.05, 0.1, 0.05], down: 0.5 },
  hung: { butt: [-0.06, 0.2, 0.2], down: 0.9 },
}
const SHIFT = 0.4
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

/** A soldier led by the keyboard, who carries a rifle on his chest with both hands, pointing where he aims. */
export class Soldier {
  readonly body: Body
  readonly object = new Group()
  readonly rifle = new Group()
  /** where he aims (rad, counted from +z toward his left), and how far up */
  aim = 0
  pitch = 0
  /** where the magazine sits in the rifle, which slides it out and in, and the magazine */
  readonly well = new Object3D()
  readonly guard = box(GUARD.size, GUARD.at)
  mag = box(MAG.size, [0, 0, 0])
  ball = new Mesh(new SphereGeometry(BALL), metal)
  /** the hands, as they were read from the rig at rest, and how each takes hold of what it holds */
  private readonly hands: Record<Side, Hand>
  private readonly held: Record<keyof typeof GRIP, Grip>
  readonly errors: string[] = []
  private readonly loose: Loose[] = []
  private readonly was = { reload: false, grenade: false }
  private busy = false
  /** how the rifle was carried, how it is to be, and since when */
  private carry = { from: 'shoulder' as Carry, to: 'shoulder' as Carry, since: 0 }
  /** how far the magazine was out, how far it is to be, and since when */
  private slid = { from: 0, to: 0, since: 0 }

  constructor(man: Object3D) {
    this.well.position.fromArray(MAG.in)
    this.well.add(this.mag)
    this.rifle.add(...PARTS.map(({ size, at }) => box(size, at)), this.guard, this.well)
    const chest = man.getObjectByName('chest')
    if (!chest) throw new Error('the rig has no chest')
    chest.add(this.rifle)
    this.object.add(man)
    const hands = (this.hands = { right: new Hand(man, 'right'), left: new Hand(man, 'left') })
    this.held = {
      grip: grip(hands.right, this.rifle, GRIP.grip),
      fore: grip(hands.left, this.guard, GRIP.fore),
      mag: grip(hands.left, this.mag, GRIP.mag),
      ball: grip(hands.right, this.ball, GRIP.ball),
    }
    this.body = new Body(man)
    this.pose()
    this.onRifle('right', this.held.grip)
    this.onRifle('left', this.held.fore)
  }

  /** a hand takes hold of the rifle, as it is held there */
  private onRifle(side: Side, held: Grip) {
    this.body.hand[side].shape(held.pose)
    return this.body.hand[side].to(held, { on: held.target })
  }

  /** the magazine is to slide out of its well, or back in */
  private slide(out: boolean) {
    this.slid = { from: this.slid.to, to: out ? 1 : 0, since: this.body.time }
    return this.body.until(this.body.time + SLIDE)
  }

  private carried(to: Carry) {
    this.carry = { from: this.carry.to, to, since: this.body.time }
  }

  /** the rifle is carried on his chest as it is to be, pointing as high as he aims */
  private pose() {
    const { from, to, since } = this.carry
    const share = ease(Math.min(1, (this.body.time - since) / SHIFT))
    const [a, b] = [CARRY[from], CARRY[to]]
    this.rifle.position.fromArray(a.butt).lerp(new Vector3().fromArray(b.butt), share)
    this.rifle.rotation.set(a.down + (b.down - a.down) * share - this.pitch, 0, 0)
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
    const carry = this.busy ? this.carry.to : sprint ? 'low' : 'shoulder'
    if (carry !== this.carry.to) this.carried(carry)
    if (input.reload && !this.was.reload && !this.busy) this.begin(this.reload())
    if (input.grenade && !this.was.grenade && !this.busy) this.begin(this.grenade())
    this.was.reload = input.reload
    this.was.grenade = input.grenade
    try {
      body.update(delta)
    } catch (error) {
      this.errors.push(`${body.time.toFixed(2)} ${(error as Error).message}`)
    }
    this.pose()
    this.fall(delta)
  }

  private begin(story: Story) {
    this.busy = true
    const soldier = this
    this.body.play(
      (function* () {
        yield* story
        soldier.busy = false
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
    const { body, held } = this
    const { left } = body.hand
    // the left hand takes the magazine and pulls it out, lets it fall, and fetches a fresh one from his chest
    this.carried('shoulder')
    left.shape(flat)
    yield* left.to(held.mag, { on: this.well })
    yield* left.shape(held.mag.pose)
    yield* this.slide(true)
    left.free()
    this.drop(this.mag, left.velocity)
    yield* left.to(place(BODY.pouch), { on: body })
    this.mag = box(MAG.size, [0, 0, 0])
    hang(this.hands.left, this.mag, held.mag)
    // pushes it in, and goes back to the handguard
    yield* left.to(held.mag, { on: this.well })
    this.well.attach(this.mag)
    yield* this.slide(false)
    yield* left.shape(flat)
    yield* this.onRifle('left', held.fore)
  }

  private *grenade(): Story {
    const { body, held, ball } = this
    const { right } = body.hand
    // the rifle hangs from the left hand, the right takes the grenade from his belt and throws it overarm the way he aims
    this.carried('hung')
    right.shape(flat)
    yield* right.to(place(BODY.belt), { on: body })
    hang(this.hands.right, ball, held.ball)
    yield* right.shape(held.ball.pose)
    const way = new Vector3(Math.sin(this.aim), 0, Math.cos(this.aim))
    const velocity = way.multiplyScalar(THROW.speed * Math.cos(THROW.lift)).setY(THROW.speed * Math.sin(THROW.lift))
    yield* right.by(body.time + THROW.wind, place(BODY.release), { on: body, velocity })
    this.drop(ball, right.velocity)
    yield* right.shape(flat)
    // and takes the rifle again once it is back up where his hand can hold it
    this.carried('shoulder')
    yield* body.until(body.time + SHIFT)
    yield* this.onRifle('right', held.grip)
  }
}
