// The court and the ball, simulated by @drawcall/physics (Rapier backend): a floor, a net and a ball. Nothing here
// steers the ball; a racket only ever sets its velocity at contact.

import { BoxCollider, RigidBody, SphereCollider } from "@drawcall/physics"
import { buildWorld } from "@drawcall/physics-rapier"
import { Group, Vector3 } from "three"

export const GRAVITY = 9.81
export const BALL = 0.033 // radius (m)
export const BOUNCE = 0.75 // how much of its vertical speed the ball keeps in a bounce
export const NET = 0.95 // height of the net (m)
export const LENGTH = 11.89 // net to baseline (m)
export const WIDTH = 4.115 // centre line to singles side line (m)

export interface BallState {
  position: Vector3
  velocity: Vector3
}

export async function createCourt() {
  const scene = new Group()
  const slick = { restitution: BOUNCE, staticFriction: 0, dynamicFriction: 0 } // no friction: a bounce only reverses the vertical speed
  const floor = new RigidBody({ bodyType: "static", colliders: false, material: slick })
  floor.add(new BoxCollider({ size: [60, 1, 60] }).translateY(-0.5))
  const net = new RigidBody({ bodyType: "static", colliders: false, material: { restitution: 0.1, staticFriction: 0.5, dynamicFriction: 0.5 } })
  net.add(new BoxCollider({ size: [2 * WIDTH + 2, NET, 0.04] }).translateY(NET / 2))
  const ball = new RigidBody({ mass: 0.057, colliders: false, canSleep: false, material: slick })
  ball.add(new SphereCollider({ radius: BALL }))
  ball.position.set(0, 1, -5)
  scene.add(floor, net, ball)
  const world = await buildWorld({ scene, gravity: [0, -GRAVITY, 0], fixedDelta: 1 / 240 })
  return { scene, ball, world }
}

/**
 * Where the ball will be: its flight from a state, `time` seconds on, bouncing off the floor as the physics does
 * (gravity, and each bounce keeps BOUNCE of the vertical speed). Also when and where it bounces on the way.
 */
export function predict(from: BallState, time: number): BallState & { bounces: { time: number; position: Vector3 }[] } {
  const p = from.position.clone(),
    v = from.velocity.clone(),
    bounces: { time: number; position: Vector3 }[] = []
  let left = time,
    passed = 0
  for (let k = 0; k < 6; k++) {
    // time until the ball's underside reaches the floor: BALL = p.y + v.y t - g t^2 / 2
    const h = Math.max(0, p.y - BALL),
      fall = (v.y + Math.sqrt(v.y * v.y + 2 * GRAVITY * h)) / GRAVITY
    const step = Math.min(left, fall)
    p.set(p.x + v.x * step, p.y + v.y * step - 0.5 * GRAVITY * step * step, p.z + v.z * step)
    v.y -= GRAVITY * step
    left -= step
    passed += step
    if (left <= 1e-9) break
    bounces.push({ time: passed, position: p.clone() })
    v.y = -BOUNCE * v.y
    if (v.y < 0.3) {
      v.y = 0
      p.y = BALL
      p.addScaledVector(new Vector3(v.x, 0, v.z), left)
      break
    } // it rolls
  }
  return { position: p, velocity: v, bounces }
}

/** The velocity that sends the ball from `from` to land at `to`, flat but clearing the net with room to spare. */
export function launch(from: Vector3, to: Vector3, speed = 13): Vector3 {
  const flat = Math.hypot(to.x - from.x, to.z - from.z)
  for (let time = flat / speed; ; time += 0.05) {
    const v = to.clone().sub(from).divideScalar(time)
    v.y += 0.5 * GRAVITY * time
    const cross = -from.z / v.z,
      height = from.y + v.y * cross - 0.5 * GRAVITY * cross * cross // when and how high it crosses the net
    if (cross < 0 || cross > time || height > NET + 0.35) return v
  }
}
