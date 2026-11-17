// A soldier walking with a rifle: his planner runs a locomotion planner for his steps and the rifle carry. Each hand takes
// hold of the rifle once, in the grip found for it, and keeps that grip: the rifle hangs from the right hand and the
// left closes the loop, so hands and rifle are one rigid piece and the hands are never targeted. The locomotion
// planner has the legs, pelvis and trunk and faces him toward the aim; the arms are the rifle's, so it swings neither.
// ONE hard goal owns the rifle's pose, on the end of its stock:
//  - lowered: it matches the low-ready mark on the pelvis: both are on the body, so it is exact;
//  - aiming: it matches a world point at his right shoulder over where he walks, the barrel on the line to the aim
//    target. It is placed from the path, not from the pelvis, so the rifle glides while the body bobs under it.
// In between, it turns about the stock's end a share of the way from the one to the other.

import { SOLDIER } from "@drawcall/example-stage/bearing"
import { createRifle, gripRifle, LOW_READY, lowReady } from "@drawcall/example-stage/rifle"
import { type Goal, type Grip, hard, Humanoid, LocomotionPlanner, mix, type Pose, posture, type Side, Target } from "@drawcall/animate"
import { type Group, MathUtils, Matrix4, type Object3D, Quaternion, Vector3 } from "three"

const Y = new Vector3(0, 1, 0)
const SPEED = 0.7 // m/s
const SHOULDER = 0.5 // m his shoulders are over his pelvis

// The arms that go with aiming, made by solving them for the rifle there with the trunk held upright and the elbows
// drawn out from the body, the right one most.
const AIM: Pose = {
  shoulderL: [-0.3, 0.15],
  upperArmL: [-1.83, -0.25, 0.79],
  forearmL: [0, 0.9],
  handL: [0.34, -0.21],
  shoulderR: [-0.22, -0.27],
  upperArmR: [-0.56, -0.12, 0.49],
  forearmR: [-2.06, -0.59],
  handR: [0.43, -0.72],
}

/** The turn that points the muzzle (-Z) along `along`, the rifle upright. */
const pointing = (along: Vector3) => new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(), along, Y))

/** How he walks at time t, in the world: up the path for 8 s, snaking either side of +z, then back down it facing the
 * same way, again and again, starting and stopping smoothly. */
const walking = (t: number) => {
  const pace = Math.max(-1, Math.min(1, 2 * Math.sin((Math.PI * t) / 8))),
    heading = 0.6 * Math.sin((Math.PI * t) / 2)
  return new Vector3(Math.sin(heading), 0, Math.cos(heading)).multiplyScalar(SPEED * pace)
}

/** The soldier's body and rifle, and his planner. */
export interface SoldierPlanner {
  body: Humanoid
  rifle: Group
  grips: { right: Grip; left: Grip; pistol: Grip }
  /** where each hand bone is on the rifle */
  seats: Record<Side, Object3D>
  locomotion: LocomotionPlanner
  /** This frame's goals, `dt` after the last. */
  update: (dt: number) => Goal[]
}

/** The soldier, `rigged` (the rigged soldier, his fingers at rest), and his planner. `aim(t)` is where to aim at time t;
 * `aiming(t)` in [0, 1] says how far the rifle is up (0 lowered, 1 aimed). */
export function createSoldierPlanner(rigged: Object3D, aim: (t: number) => Vector3, aiming: (t: number) => number = () => 1): SoldierPlanner {
  const body = new Humanoid({ rig: rigged, girth: SOLDIER.girth }),
    { rifle, butt } = createRifle(),
    { grips, seats } = gripRifle(body.hands, rifle)
  for (const side of ["right", "left"] as const) body.hold(side, rifle, grips[side]) // the right hand carries the rifle, the left closes the loop
  const locomotion = new LocomotionPlanner(body, SOLDIER.gait)
  const lowered = lowReady(body),
    target = new Target()
  const standing = body.positionOf(body.get("pelvis")).y - body.positionOf(body.get("soleR")).y
  const position = new Vector3() // where he is over the ground: the locomotion planner follows it
  let t = 0
  const update = (dt: number): Goal[] => {
    t += dt
    const velocity = walking(t)
    position.addScaledVector(velocity, dt)
    const to = aim(t).sub(position)
    const goals = locomotion.update(dt, { position, velocity, facing: Math.atan2(to.x, to.z), taken: ["armL", "armR"] })
    const u = MathUtils.smoothstep(aiming(t), 0, 1)
    if (u > 0) {
      const shoulder = position
        .clone()
        .add(new Vector3(0, standing + SHOULDER, 0))
        .add(new Vector3(-to.z, 0, to.x).setLength(0.15))
      const down = { position: body.positionOf(lowered).addScaledVector(body.velocityOf(lowered), dt), quaternion: body.quaternionOf(lowered) }
      target.set({ position: down.position.lerp(shoulder, u), quaternion: down.quaternion.slerp(pointing(aim(t).sub(shoulder)), u) })
    }
    return [...goals, hard(butt, u > 0 ? target : lowered), posture(body, mix(LOW_READY, AIM, u))]
  }
  return { body, rifle, grips, seats, locomotion, update }
}
