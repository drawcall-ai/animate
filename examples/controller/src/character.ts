// The hard case: a physics capsule moved by player input, and a body that has to look like it is what moves.
// Each frame: the input sets the capsule controller's desired velocity, the physics moves the capsule, the
// locomotion planner is given where the capsule is, how it moves and what the input asks for, and the solver poses
// the body from the planner's goals. The pelvis is a soft goal on the capsule: it follows as closely as the planted
// feet allow.

import { createHumanoid } from "@drawcall/humanoid"
import { type Goal, type Pose, type SolveResult, hard, mark, posture, solve } from "@drawcall/ik"
import { createLocomotion } from "@drawcall/locomotion"
import { BoxCollider, RigidBody } from "@drawcall/physics"
import { buildWorld } from "@drawcall/physics-rapier"
import { Group, Object3D, Quaternion, Vector3 } from "three"
import { CharacterController } from "./controller"

const CLIMB = 0.32 // m: the step the capsule motor of @drawcall/physics gets up without a jump
export const PACE = { walk: 1.4, run: 3.5, sprint: 6 } // m/s
const STEPS = 8,
  RISE = 0.17,
  TREAD = 0.3,
  START = -5, // where the stairs begin, going up along -z
  TOP = START - (STEPS - 1) * TREAD, // where the landing begins; it is 3 m long, and the stairs down mirror the ones up
  MIRROR = 2 * (TOP - 1.5)
/** What stands on the floor, as boxes: a block to jump onto, and stairs up to a landing and down again. */
export const BOXES: { size: [number, number, number]; at: [number, number, number] }[] = [
  { size: [3, 0.4, 3], at: [-8, 0.2, 8] },
  { size: [2, STEPS * RISE, 3], at: [0, (STEPS * RISE) / 2, TOP - 1.5] },
  ...Array.from({ length: STEPS - 1 }, (_, i) => i + 1).flatMap((i) =>
    [START - (i - 0.5) * TREAD, MIRROR - START + (i - 0.5) * TREAD].map(
      (z) => ({ size: [2, i * RISE, TREAD], at: [0, (i * RISE) / 2, z] }) as (typeof BOXES)[number],
    ),
  ),
]
// The capsule does not climb the steps themselves (its motor gains too little on treads as short as its radius): as
// in most games it walks a ramp laid over their edges, which the feet's rays ignore.
const SLOPE = Math.atan(RISE / TREAD),
  LENGTH = Math.hypot(STEPS * TREAD, STEPS * RISE)

export interface Input {
  /** Where to go, in the world, up to length 1. */
  move: Vector3
  pace: keyof typeof PACE
  crouch: boolean
  /** Pressed this frame. */
  jump: boolean
  /** Carry the rifle: both arms are taken from the planner. */
  rifle: boolean
}

const turn = (axis: Vector3, angle: number) => new Quaternion().setFromAxisAngle(axis, angle)
const X = new Vector3(1, 0, 0),
  Y = new Vector3(0, 1, 0),
  Z = new Vector3(0, 0, 1)
// The arms that go with the rifle at the chest (low ready).
const LOW: Pose = {
  shoulderL: [0.1, -0.13],
  upperArmL: [-0.58, -0.16, 0.18],
  forearmL: [-0.51, 0.16],
  handL: [-0.02, 0.3],
  shoulderR: [-0.04, -0.15],
  upperArmR: [0.04, 0.3, 0.58],
  forearmR: [-1.58, -0.13],
  handR: [0.05, 0.17],
}

export async function createCharacter() {
  const scene = new Group()
  const floor = new RigidBody({ bodyType: "static", colliders: false })
  // Off centre: the capsule motor of @drawcall/physics 0.20 does not move along the diagonal of a box's face (it
  // stands still walking exactly along x = z through the box's middle), so that line is put where nobody walks.
  floor.add(new BoxCollider({ size: [400, 1, 400] }).translateY(-0.5).translateX(37).translateZ(11))
  for (const box of BOXES) floor.add(new BoxCollider({ size: box.size }).translateX(box.at[0]).translateY(box.at[1]).translateZ(box.at[2]))
  const ramps = new RigidBody({ bodyType: "static", colliders: false })
  for (const side of [1, -1]) {
    const ramp = new BoxCollider({ size: [2, 0.1, LENGTH] })
    const middle = new Vector3(0, (STEPS * RISE) / 2, START + TREAD - (STEPS * TREAD) / 2).addScaledVector(
      new Vector3(0, Math.cos(SLOPE), Math.sin(SLOPE)),
      -0.05,
    )
    ramp.position.set(0, middle.y, side > 0 ? middle.z : MIRROR - middle.z)
    ramp.rotation.x = side * SLOPE
    ramps.add(ramp)
  }
  const capsule = new Object3D() // its origin is at the capsule's feet
  scene.add(floor, ramps, capsule)
  const world = await buildWorld({ scene, gravity: [0, -9.81, 0], fixedDelta: 1 / 120 })
  const controller = new CharacterController(world, capsule, { radius: 0.3, height: 1.75 })

  const body = createHumanoid()
  const planner = createLocomotion(body, { acceleration: 35, climb: CLIMB })
  scene.add(body.root)

  // The rifle: gripped by both hands (a closed loop) and held to a marker on the chest by one hard goal.
  const rifle = new Group()
  rifle.userData.mass = 3.5
  const gripR = mark(rifle, "gripR", new Vector3(), turn(Y, 0.5).multiply(turn(X, -0.6)))
  const gripL = mark(rifle, "gripL", new Vector3(0, -0.03, 0.26), turn(Z, -0.4))
  const ready = mark(body.get("chest"), "lowReady", new Vector3(0.06, -0.05, 0.26), turn(Y, 0.3).multiply(turn(X, 0.6)))
  let armed = false,
    crouch = 0
  /** The height of what is under a point: a ray cast down from knee height, so each foot finds its own stair. */
  const DOWN = new Vector3(0, -1, 0)
  const ground = (at: Vector3) =>
    world.raycast(new Vector3(at.x, capsule.position.y + 0.5, at.z), DOWN, 1.2, { excludeBodies: [ramps] })?.point.y ?? capsule.position.y

  /** One frame. Returns the goals and what the solver made of them. */
  const frame = (dt: number, input: Input): { goals: Goal[]; result: SolveResult; solveMs: number } => {
    controller.input.direction.copy(input.move)
    controller.input.speed = PACE[input.pace]
    controller.input.crouching = input.crouch
    if (input.jump) planner.jump(() => controller.jump())
    world.update(dt)
    crouch += Math.min(dt / 0.25, Math.max(-dt / 0.25, (controller.crouched ? 1 : 0) - crouch)) // getting down takes a moment

    if (input.rifle !== armed) {
      armed = input.rifle
      if (armed) {
        body.attach(rifle, body.get("palmR"), gripR)
        body.attach(rifle, body.get("palmL"), gripL)
      } else {
        body.detach(rifle)
        rifle.removeFromParent()
      }
    }
    const goals = planner.step(dt, {
      position: capsule.position,
      velocity: controller.velocity,
      desired: controller.desired,
      grounded: controller.grounded,
      crouch,
      ground,
      taken: armed ? ["armL", "armR"] : [],
    })
    if (armed) goals.push(hard(rifle, ready), posture(body, LOW))
    const start = performance.now(),
      result = solve(body, goals, dt)
    return { goals, result, solveMs: performance.now() - start }
  }
  return { scene, capsule, controller, body, planner, rifle, ground, frame }
}
