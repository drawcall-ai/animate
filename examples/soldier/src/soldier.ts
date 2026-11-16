// A soldier walking with a rifle. The rifle is gripped by both hands (a closed loop), so hands and rifle are one
// rigid piece and the hands are never targeted. ONE hard goal owns the rifle's pose:
//  - lowered: the rifle matches a marker on the chest (low ready): both points are on the body, so it is exact;
//  - aiming: it matches a world point on the line from beside the planned pelvis path to the aim target.
// In between, the planner places the world point a share of the way from where the chest marker is now to the aim.
// The walk's arm swing is not emitted: the planner knows the arms are busy.

import { createHumanoid, upright } from '@drawcall/humanoid'
import { type Body, type Goal, type Pose, ease, hard, mark, mixPose, Target } from '@drawcall/ik'
import { Group, Matrix4, Quaternion, Vector3 } from 'three'
import { createWalker, makeWalk } from './walk'

const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1)
const turn = (axis: Vector3, angle: number) => new Quaternion().setFromAxisAngle(axis, angle)

// The arm poses that go with the two rifle poses, made by solving each with the body held upright.
const AIM: Pose = {
  shoulderL: [-0.24, -0.15], upperArmL: [-0.94, -0.3, 0.02], forearmL: [-0.67, 0.02], handL: [-0.08, 0.46],
  shoulderR: [-0.3, -0.24], upperArmR: [-0.14, 0.21, 0.38], forearmR: [-1.84, -0.3], handR: [-0.18, 0.35],
}
const LOW: Pose = {
  shoulderL: [0.1, -0.13], upperArmL: [-0.58, -0.16, 0.18], forearmL: [-0.51, 0.16], handL: [-0.02, 0.3],
  shoulderR: [-0.04, -0.15], upperArmR: [0.04, 0.3, 0.58], forearmR: [-1.58, -0.13], handR: [0.05, 0.17],
}

/** The rifle: barrel along +Z, the pistol grip at its origin. `gripR` and `gripL` are where the hands hold it. */
export function createRifle(): Group {
  const rifle = new Group()
  rifle.name = 'rifle'
  rifle.userData.mass = 3.5
  mark(rifle, 'gripR', new Vector3(), turn(Y, 0.5).multiply(turn(X, -0.6))) // the forearm comes in from the outside
  mark(rifle, 'gripL', new Vector3(0, -0.03, 0.26), turn(Z, -0.4)) // on the side of the handguard, palm turned in
  return rifle
}

export interface Soldier { body: Body; rifle: Group; plan: (t: number) => Goal[] }

/** `aim(t)` is where to aim; `aiming(t)` in [0, 1] says how far the rifle is up (0 lowered, 1 aimed). */
export function createSoldier(aim: (t: number) => Vector3, aiming: (t: number) => number = () => 1, walk = makeWalk(t => 0.6 * Math.sin(0.8 * t))): Soldier {
  const body = createHumanoid(), rifle = createRifle(), walker = createWalker(body, walk)
  body.attach(rifle, body.get('palmR'), rifle.getObjectByName('gripR')) // carried by the right hand
  body.attach(rifle, body.get('palmL'), rifle.getObjectByName('gripL')) // the left hand closes the loop
  const lowered = mark(body.get('chest'), 'lowReady', new Vector3(0.06, -0.05, 0.26), turn(Y, 0.3).multiply(turn(X, 0.6)))
  const target = new Target(), stand = upright(body)
  const aimed = (t: number) => {
    const eye = walk.pelvis(t).position.add(new Vector3(0, 0.38, 0)), to = aim(t).sub(eye)
    const start = eye.add(new Vector3(-to.z, 0, to.x).setLength(0.1)) // the rifle sits to the right of the body
    const quaternion = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(aim(t).sub(start), new Vector3(), Y)) // +Z along the aim line
    return { position: start.add(new Vector3(0, 0, 0.28).applyQuaternion(quaternion)), quaternion }
  }
  const plan = (t: number): Goal[] => {
    const u = ease(aiming(t)), up = aimed(t)
    if (u > 0) target.set({ position: body.positionOf(lowered).lerp(up.position, u), quaternion: body.rotationOf(lowered).slerp(up.quaternion, u) })
    return [...walker(t, { ...stand, ...mixPose(LOW, AIM, u) }, false), hard(rifle, u > 0 ? target : lowered)]
  }
  return { body, rifle, plan }
}
