import { Body, type Story } from '@drawcall/animate'
import { grip, Hand } from '@drawcall/hand'
import { Figure } from '@drawcall/pose'
import { Matrix4, BoxGeometry, BufferGeometry, Group, Line, LineBasicMaterial, Mesh, MeshStandardMaterial, type Object3D, Quaternion, SphereGeometry, Vector3 } from 'three'
import { inHand } from '../character'
import { Ball } from '../basketball/ball'
import { type Flight, arc, ball as flight, fly } from '../basketball/court'
import { SEAT, jumpShot } from '../basketball/shot'
import { type Ball as Kicked, ballAt, fly as roll, meeting, strike } from '../football/pitch'
import { shot as kickToday } from '../football/shot'
import { BOX, PALM, SHELF, boxAt, clear, fall, shelved } from '../shelf/box'
import { shelve } from '../shelf/shelve'

/** a scene played by today's `Body` or by the plan core's `Figure`: what it shows, and a step of it */
export type Played = { scene: Object3D; update(delta: number): void; focus(): number; say(): string; told?(): ReturnType<Figure['intent']> }
/** the rig a scene is played on, and whether by the plan core */
let mannequin: () => Object3D
let next = true
const UP = (52 * Math.PI) / 180
const yaw = (angle: number) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle)

/** a line drawn after a point as it moves, for the path of a hand to be seen */
function trail(scene: Object3D, color = 0xffff00) {
  const points: Vector3[] = []
  const line = new Line(new BufferGeometry(), new LineBasicMaterial({ color }))
  scene.add(line)
  return (at: Vector3) => {
    points.push(at.clone())
    line.geometry.dispose()
    line.geometry = new BufferGeometry().setFromPoints(points)
  }
}

/** (a) the jump shot: the ball in the right hand, the left beside it, released at the top toward the hoop */
function shot(): Played {
  const man = mannequin()
  const scene = new Group().add(man)
  const ball = new Ball(scene)
  scene.add(ball.mesh)
  scene.updateMatrixWorld(true)
  const seat = grip(new Hand(man, 'right'), ball.mesh, SEAT)
  let flying: Flight = flight()
  const path = trail(scene)
  if (!next) {
    const body = new Body(man)
    body.play(jumpShot(body, inHand(body, new Hand(man, 'right'), seat, { turning: false }), (v) => (flying = { position: ball.place, velocity: v })))
    return {
      scene,
      update(delta) {
        body.update(delta)
        fly(flying, delta)
        if (flying.velocity) ball.mesh.position.copy(flying.position)
        path(man.getObjectByName('rightHand')!.getWorldPosition(new Vector3()))
      },
      focus: () => body.hips.value.z,
      say: () => (body.playing ? 'today: playing' : 'today: over'),
    }
  }
  const fig = new Figure(man)
  ;(globalThis as any).fig = fig
  const told = () => fig.intent()
  const { arm, trunk, shoulder, leg, stand } = fig.size
  const thing = fig.bind(ball.mesh)
  fig.hold('right', ball.mesh, seat)
  fig.play(
    (function* (): Story {
      // carried before his chest, the left hand coming to its side and bound to it there
      const hips = fig.gait.hips
      // (the right hand under it, palm up and fingers ahead: told of the hand, the ball goes with it)
      const palmUp = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3(0, 1, 0), new Vector3(0, 0, -1), new Vector3(-1, 0, 0)))
      yield* fig.met(thing, fig.hand.right.by({ at: 0.6, on: hips, place: { x: -shoulder + 0.1 * arm, y: trunk - 0.3 * arm, z: 0.55 * arm }, turn: palmUp }))
      const guide = { at: 1.0, on: hips, place: { x: -shoulder + 0.12 * arm + 0.2, y: trunk - 0.12 * arm, z: 0.6 * arm }, turn: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI) }
      yield* fig.met(fig.hand.left, fig.hand.left.by(guide))
      fig.attach('left', ball.mesh)
      // he jumps; at the top the ball is where it leaves, moving as it is to fly, and let go: hands and ball go their ways
      const top = new Vector3(0, stand + 0.4 * leg, 0.15)
      const highest = fig.gait.jump(top)
      const release = top.clone().add({ x: -shoulder, y: trunk + 0.9 * arm, z: 0.3 * arm })
      yield* fig.met(thing, thing.by({ at: highest, place: release, velocity: arc(release, UP) }))
      const velocity = fig.letGo(ball.mesh)
      flying = { position: ball.place, velocity }
    })(),
  )
  return {
    scene,
    update(delta) {
      fig.update(delta)
      fly(flying, delta)
      if (flying.velocity) ball.mesh.position.copy(flying.position)
      path(fig.hand.right.value)
    },
    focus: () => fig.gait.hips.value.z,
    told,
    say: () => `next: ${fig.playing ? 'playing' : 'over'}  ${thing.outside ? 'ball flying' : 'ball held'}`,
  }
}

/** (b) the shelf: a box taken off the floor in both hands, carried, and put on a shelf as high as his head, level throughout */
function shelf(): Played {
  const man = mannequin()
  const box = boxAt(0.55)
  box.mesh.material = new MeshStandardMaterial({ color: 0xb08850 })
  const board = new Mesh(new BoxGeometry(SHELF.width, SHELF.thick, SHELF.depth), new MeshStandardMaterial({ color: 0x806040 }))
  board.position.set(0, SHELF.top - SHELF.thick / 2, SHELF.edge + SHELF.depth / 2)
  const scene = new Group().add(man, box.mesh, board)
  scene.updateMatrixWorld(true)
  const hands = { left: new Hand(man, 'left'), right: new Hand(man, 'right') }
  const grips = { left: grip(hands.left, box.mesh, PALM.left), right: grip(hands.right, box.mesh, PALM.right) }
  const tilt = () => (new Vector3(0, 1, 0).applyQuaternion(box.mesh.quaternion).angleTo(new Vector3(0, 1, 0)) * 180) / Math.PI
  let most = 0
  if (!next) {
    const body = new Body(man)
    body.play(shelve(body, box, hands))
    return {
      scene,
      update(delta) {
        body.update(delta)
        fall(box, delta)
        most = Math.max(most, tilt())
      },
      focus: () => body.hips.value.z,
      say: () => `today: box tilt ${tilt().toFixed(0)}° (most ${most.toFixed(0)}°)`,
    }
  }
  const fig = new Figure(man)
  ;(globalThis as any).fig = fig
  const told = () => fig.intent()
  const thing = fig.bind(box.mesh)
  fig.play(
    (function* (): Story {
      const hips = fig.gait.hips
      // both hands onto its sides, he getting down for it by himself
      const left = fig.take('left', box.mesh, grips.left, 1.2)
      yield* fig.take('right', box.mesh, grips.right, 1.2)
      yield* left
      box.held = true
      // up before his chest, level, square to him
      yield* fig.met(thing, thing.by({ at: fig.time + 0.9, on: hips, place: { x: 0, y: 0.2, z: 0.4 }, turn: new Quaternion() }))
      // he walks to the shelf, raising it over the edge as he comes to rest, and sets it down
      const stops = fig.gait.run({ at: { x: -0.1, z: SHELF.edge - 0.35 }, plant: 'left', speed: 1.3 })
      thing.by({ at: stops - 0.8, on: hips, place: { x: 0, y: 0.2, z: 0.4 }, turn: new Quaternion() })
      yield* fig.met(thing, thing.by({ at: stops + 0.3, place: clear(), turn: new Quaternion() }))
      yield* fig.met(thing, thing.by({ at: fig.time + 0.7, place: shelved(), turn: new Quaternion() }))
      fig.letGo(box.mesh)
      box.held = false
      thing.outside = true
      fig.free('left')
      fig.free('right')
      fig.gait.go({ x: 0, z: 0 })
    })(),
  )
  return {
    scene,
    update(delta) {
      fig.update(delta)
      if (!box.held) fall(box, delta)
      most = Math.max(most, tilt())
    },
    focus: () => fig.gait.hips.value.z,
    told,
    say: () => `next: box tilt ${tilt().toFixed(0)}° (most ${most.toFixed(0)}°)`,
  }
}

/** (c) a run-up onto the left foot beside the ball, and the right foot meeting it at 20 m/s */
function kick(): Played {
  const man = mannequin()
  const ball: Kicked = ballAt(5)
  const mesh = new Mesh(new SphereGeometry(0.11, 20, 14), new MeshStandardMaterial({ color: 0xf0f0f0 }))
  const scene = new Group().add(man, mesh)
  const path = trail(scene, 0x40ff40)
  const show = () => mesh.position.copy(ball.position)
  show()
  if (!next) {
    const body = new Body(man)
    body.play(kickToday(body, ball))
    return {
      scene,
      update(delta) {
        body.update(delta)
        roll(ball, delta)
        show()
        path(body.foot.right.value)
      },
      focus: () => body.hips.value.z,
      say: () => `today: ball ${ball.velocity.length().toFixed(1)} m/s`,
    }
  }
  const fig = new Figure(man)
  ;(globalThis as any).fig = fig
  const told = () => fig.intent()
  fig.play(
    (function* (): Story {
      const plants = fig.gait.run({ at: { x: 0.12, z: ball.position.z - 0.35 }, plant: 'left', speed: 3.6, arrive: 2.5 })
      const through = meeting(ball, 20, (8.6 * Math.PI) / 180)
      const foot = fig.gait.feet.right
      yield* fig.met(foot, foot.by({ at: plants + 0.15, place: through.at, velocity: through.velocity, by: 'story' }))
      strike(ball, foot.value, foot.velocity)
      yield* fig.until(fig.time + 0.4)
      fig.gait.go({ x: 0, z: 0 })
    })(),
  )
  return {
    scene,
    update(delta) {
      fig.update(delta)
      roll(ball, delta)
      show()
      path(fig.gait.feet.right.value)
    },
    focus: () => fig.gait.hips.value.z,
    told,
    say: () => `next: ball ${ball.velocity.length().toFixed(1)} m/s`,
  }
}

/** what the player asks at a moment: walk, run, a tight circle, a reversal, a stop (m/s along the ground) */
function input(t: number) {
  if (t < 1.5) return { x: 0, z: 1.5 }
  if (t < 3) return { x: 0, z: 4.5 }
  if (t < 3.5) return { x: 0, z: 1.6 }
  if (t < 7.5) {
    const turned = 1.6 * (t - 3.5)
    return { x: 1.6 * Math.sin(turned), z: 1.6 * Math.cos(turned) }
  }
  if (t < 9) return { x: 0, z: -3.5 }
  return { x: 0, z: 0 }
}

/** (d) led by input that changes every frame */
function led(): Played {
  const man = mannequin()
  const scene = new Group().add(man)
  const path = trail(scene, 0x40c0ff)
  let t = 0
  if (!next) {
    const body = new Body(man)
    const at = new Vector3()
    return {
      scene,
      update(delta) {
        t += delta
        const v = input(t)
        at.add({ x: v.x * delta, y: 0, z: v.z * delta })
        body.go(v)
        body.hips.at({ x: at.x, z: at.z })
        body.update(delta)
        path(body.hips.value.clone().setY(0.02))
      },
      focus: () => body.hips.value.z,
      say: () => `today: led ${t.toFixed(1)} s`,
    }
  }
  const fig = new Figure(man)
  ;(globalThis as any).fig = fig
  const told = () => fig.intent()
  return {
    scene,
    update(delta) {
      t += delta
      fig.gait.go(input(t))
      fig.update(delta)
      path(fig.gait.hips.value.clone().setY(0.02))
    },
    focus: () => fig.gait.hips.value.z,
    told,
    say: () => `next: led ${t.toFixed(1)} s`,
  }
}

/** (e) a throw cancelled halfway: new input sends the hand low to his left side instead, and it goes on smoothly */
function cancel(): Played {
  const man = mannequin()
  const scene = new Group().add(man)
  const path = trail(scene)
  const [throwAt, instead, changes] = [new Vector3(-0.25, 1.9, 0.5), new Vector3(0.3, 1.15, 0.45), 1.0]
  const velocity = new Vector3(0, 3, 9)
  if (!next) {
    const body = new Body(man)
    body.play(
      (function* (): Story {
        void body.hand.right.by(1.2, throwAt, { velocity })
        yield* body.until(changes)
        // (today nothing cancels a send: letting the hand go and sending it anew is the nearest)
        body.hand.right.free()
        yield* body.hand.right.to(instead, { seconds: 0.5 })
      })(),
    )
    return {
      scene,
      update(delta) {
        body.update(delta)
        path(body.hand.right.value)
      },
      focus: () => 0,
      say: () => 'today',
    }
  }
  const fig = new Figure(man)
  ;(globalThis as any).fig = fig
  const told = () => fig.intent()
  const hand = fig.hand.right
  fig.play(
    (function* (): Story {
      hand.by({ at: 1.2, place: throwAt, velocity, by: 'story' })
      yield* fig.until(changes)
      hand.cancel()
      hand.by({ at: changes + 0.5, place: instead, turn: yaw(0), by: 'story' })
    })(),
  )
  return {
    scene,
    update(delta) {
      fig.update(delta)
      path(hand.value)
    },
    focus: () => 0,
    told,
    say: () => 'next',
  }
}

export const scenes = { shot, shelf, kick, led, cancel }
/** plays a scene on a rig, by the plan core or by today's library */
export function play(name: keyof typeof scenes, rig: () => Object3D, byPlan: boolean): Played {
  mannequin = rig
  next = byPlan
  return scenes[name]()
}
