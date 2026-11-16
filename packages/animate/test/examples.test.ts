import { buildWorld } from '@drawcall/physics-rapier'
import { grip, Hand } from '@drawcall/hand'
import { Mesh, type Object3D, Scene, SphereGeometry, Vector3 } from 'three'
import { expect, test } from 'vitest'
import { bowl, carry, SIDE } from '../../../examples/bowling/bowl'
import * as lane from '../../../examples/bowling/lane'
import * as court from '../../../examples/basketball/court'
import { RADIUS } from '../../../examples/basketball/ball'
import { SEAT, jumpShot } from '../../../examples/basketball/shot'
import { bagAt, swing } from '../../../examples/boxing/bag'
import { combination } from '../../../examples/boxing/combination'
import { panelAt } from '../../../examples/button/panel'
import { press } from '../../../examples/button/press'
import { inHand } from '../../../examples/character'
import { GRIP as FOIL, foil } from '../../../examples/fencing/foil'
import { guard, lunge } from '../../../examples/fencing/lunge'
import { FOIL as POINT, fence, targetAt } from '../../../examples/fencing/target'
import * as pitch from '../../../examples/football/pitch'
import { shot } from '../../../examples/football/shot'
import { race } from '../../../examples/hurdles/race'
import { track } from '../../../examples/hurdles/track'
import * as field from '../../../examples/javelin/field'
import { javelinThrow } from '../../../examples/javelin/throw'
import { patrol } from '../../../examples/patrol/walk'
import { person } from '../../../examples/person'
import { Soldier as Rifleman } from '../../../examples/rifleman/soldier'
import * as shelf from '../../../examples/shelf/box'
import { shelve } from '../../../examples/shelf/shelve'
import { level } from '../../../examples/shooter/level'
import { Soldier as Shooter } from '../../../examples/shooter/soldier'
import * as tennis from '../../../examples/tennis/ball'
import { stroke } from '../../../examples/tennis/stroke'
import { FOREHAND, racket } from '../../../examples/tennis/racket'
import * as vb from '../../../examples/volleyball/ball'
import { spike } from '../../../examples/volleyball/spike'
import { Body } from '../src'
import { SIDES } from '@drawcall/gait'
import { tick } from '../src/rig/size'

/** each example as its page plays it: the body with its story begun, and what the world does after every update */
const EXAMPLES: Record<string, (rig: Object3D) => { body: Body; world?: (dt: number) => void }> = {
  football(rig) {
    const [body, ball] = [new Body(rig), pitch.ballAt(5.2)]
    body.play(shot(body, ball))
    return { body, world: (dt) => pitch.fly(ball, dt) }
  },
  javelin(rig) {
    const shaft = field.shaft()
    new Scene().add(rig, shaft)
    const hand = new Hand(rig, 'right')
    const body = new Body(rig)
    const held = inHand(body, hand, grip(hand, shaft, field.GRIP))
    body.play(javelinThrow(body, held, 5.5, new Vector3(0, 0, 10), () => {}))
    return { body }
  },
  bowling(rig) {
    const ball = lane.sphere()
    new Scene().add(rig, ball)
    const hands = { left: new Hand(rig, 'left'), right: new Hand(rig, 'right') }
    const body = new Body(rig)
    const held = inHand(body, hands.right, grip(hands.right, ball, lane.GRIP))
    let bowled = lane.ball()
    body.play(
      (function* () {
        yield* carry(body, held, grip(hands.left, ball, SIDE.left))
        yield* bowl(body, held, (velocity) => (bowled = { position: ball.getWorldPosition(new Vector3()), velocity }))
      })(),
    )
    return { body, world: (dt) => bowled.velocity && lane.roll(bowled, dt) }
  },
  basketball(rig) {
    const ball = new Mesh(new SphereGeometry(RADIUS))
    new Scene().add(rig, ball)
    const hand = new Hand(rig, 'right')
    const seat = grip(hand, ball, SEAT)
    const body = new Body(rig)
    const held = inHand(body, hand, seat)
    let thrown = court.ball()
    body.play(jumpShot(body, held, (velocity) => (thrown = { position: ball.getWorldPosition(new Vector3()), velocity })))
    return { body, world: (dt) => thrown.velocity && court.fly(thrown, dt) }
  },
  volleyball(rig) {
    const [body, ball] = [new Body(rig), vb.ball()]
    body.play(spike(body, ball))
    return { body, world: (dt) => vb.fly(ball, dt) }
  },
  shelf(rig) {
    const box = shelf.boxAt(2)
    new Scene().add(rig, box.mesh)
    const hands = { left: new Hand(rig, 'left'), right: new Hand(rig, 'right') }
    const body = new Body(rig)
    body.play(shelve(body, box, hands))
    return { body, world: (dt) => shelf.fall(box, dt) }
  },
  boxing(rig) {
    const [body, bag] = [new Body(rig), bagAt(1.2)]
    body.play(combination(body, bag))
    return { body, world: (dt) => swing(bag, dt) }
  },
  fencing(rig) {
    const sword = foil()
    new Scene().add(rig, sword)
    const hand = new Hand(rig, 'right')
    const body = new Body(rig)
    const held = inHand(body, hand, grip(hand, sword, FOIL))
    const target = targetAt(2.3)
    body.play(
      (function* () {
        yield* guard(body, held)
        yield* lunge(body, held, target)
        yield* body.stand()
      })(),
    )
    return {
      body,
      world() {
        sword.updateWorldMatrix(true, false)
        fence(target, sword.localToWorld(new Vector3(0, 0, POINT)))
      },
    }
  },
  tennis(rig) {
    const bat = racket()
    new Scene().add(rig, bat)
    const hand = new Hand(rig, 'right')
    const body = new Body(rig)
    const held = inHand(body, hand, grip(hand, bat, FOREHAND))
    const ball = tennis.ballAt()
    tennis.feed(ball)
    const { seconds, at } = tennis.top(ball)
    body.play(
      (function* () {
        yield* stroke(body, held, 'forehand', body.time + seconds, at, new Vector3(0, 0, 1))
        tennis.strike(ball, bat, body)
        yield* body.stand()
      })(),
    )
    return { body, world: (dt) => tennis.fly(ball, dt) }
  },
  hurdles(rig) {
    const body = new Body(rig)
    body.play(race(body, track()))
    return { body }
  },
  patrol(rig) {
    const body = new Body(rig)
    body.play(patrol(body))
    return { body }
  },
  button(rig) {
    const body = new Body(rig)
    body.play(press(body, panelAt(1.6)))
    return { body }
  },
}

for (const [name, example] of Object.entries(EXAMPLES)) {
  for (const steps of ['frames', 'ticks'] as const) {
    test(`${name}, updated in ${steps}: played to its end, he stands, and nothing he is asked is an error`, () => {
      const { body, world } = example(person())
      const dt = steps === 'frames' ? 1 / 60 : tick(body.size)
      for (let t = 0; t < 30 && body.playing; t += dt) {
        body.update(dt)
        world?.(dt)
      }
      for (let t = 0; t < 1; t += dt) body.update(dt)
      expect(body.playing).toBe(false)
      expect(body.hips.value.y).toBeGreaterThan(0.9 * body.size.stand)
      for (const side of SIDES) expect(body.foot[side].anchor).toBeDefined()
    })
  }
}

/** what a player asks of a soldier at a moment in 20 s: walking, strafing, sprinting and stopping, sweeping his aim, firing or reloading, a grenade, a jump and a blow */
const asked = (t: number) => ({
  ahead: t < 3 ? 1 : t >= 6 && t < 9 ? 1 : 0,
  across: t >= 3 && t < 6 ? (t < 4.5 ? 1 : -1) : 0,
  sprint: t >= 6.5 && t < 9,
  yaw: t >= 10 && t < 13 ? Math.sin(t - 10) : 0,
  pitch: t >= 10 && t < 13 ? 0.4 * Math.sin(2 * (t - 10)) : 0,
  fire: t >= 10.5 && t < 12,
  reload: t >= 13 && t < 13.05,
  grenade: t >= 15.5 && t < 15.55,
  jump: t >= 18 && t < 18.05,
  hit: t >= 19 && t < 19.05,
})

const SOLDIERS = {
  async shooter(dt: number) {
    const [scene, world] = [new Scene(), level()]
    scene.add(world.drawn)
    const physics = await buildWorld({ scene })
    const soldier = new Shooter(person(), physics)
    scene.add(soldier.shown)
    return {
      soldier,
      step(t: number) {
        const { ahead, across, sprint, yaw, pitch, fire, reload, grenade, jump, hit } = asked(t)
        if (reload) soldier.reload()
        if (grenade) soldier.throw()
        if (jump) soldier.jump()
        if (hit) soldier.hit({ x: -Math.sin(yaw), z: -Math.cos(yaw) })
        soldier.update(dt, { move: { x: across, z: ahead }, yaw, pitch, sprint, fire })
        physics.update(dt)
        world.update()
      },
    }
  },
  async rifleman(dt: number) {
    const soldier = new Rifleman(person())
    return {
      soldier,
      step(t: number) {
        const { ahead, across, sprint, yaw, pitch, reload, grenade } = asked(t)
        const turn = Math.max(-1, Math.min(1, (yaw - soldier.aim) / (1.4 * dt)))
        soldier.update(dt, { forward: ahead, left: -across, turn, pitch, sprint, reload, grenade })
      },
    }
  },
}

for (const [name, make] of Object.entries(SOLDIERS)) {
  test(`${name}: played for 20 s, nothing he is asked is an error, and he ends with both hands on the rifle`, async () => {
    const dt = 1 / 60
    const { soldier, step } = await make(dt)
    for (let t = 0; t < 22; t += dt) step(t)
    expect(soldier.errors).toEqual([])
    expect(soldier.body.hand.left.there && soldier.body.hand.right.there).toBe(true)
    // (22 s of a game played a frame at a time takes longer than a test is given)
  }, 20000)
}
