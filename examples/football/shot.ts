import type { RigidBody } from '@dimforge/rapier3d-compat'
import { action, parallel, timePassed } from '@pmndrs/timeline'
import { type Humanoid, muscles, pose, run, solve, step } from 'animate-2d'
import { Euler } from 'three'
import { launch } from './pitch'

/** a part swung in the plane the humanoid faces: limbs go back and the toes down with a positive angle, the trunk leans forward (rad) */
const swing = (angle: number) => new Euler(angle, 0, 0)

/** A run-up and a shot with the right foot, struck as hard as it takes for the ball to leave at `speed` (m/s). */
export function* shot(human: Humanoid, ball: RigidBody, speed: number) {
  const { pelvis, chest, leftUpperArm, rightUpperArm } = human.parts
  const at = ball.translation().z

  // the run-up, until the left foot leaves the ground for the stride that takes it to the ball
  const lastStride = () => pelvis.body.translation().z > at - 1.75 && (human.gait.left.swing?.s ?? 1) < 0.1
  yield* action({ update: run(human, 3), until: lastStride })

  // plant: the standing foot comes down beside the ball, its knee giving, while the kicking leg trails behind;
  // the trunk goes back and the arms wide against the leg
  const gather = [
    run(human, 3),
    pose(chest, swing(-0.22), muscles.tone),
    pose(leftUpperArm, swing(-0.9), muscles.loose),
    pose(rightUpperArm, swing(0.9), muscles.loose),
  ]
  if (!(yield* parallel('race', step(human, 'left', { at: at - 0.28, bend: 0.15 }), action({ update: gather })))) return undefined

  const kick = solve(human, (trial, power) => whip(trial, power), {
    measure: (trial) => launch(trial.world.getRigidBody(ball.handle)),
    target: speed,
    within: 0.5,
    powers: [0.1, 1],
  })
  if (!kick.ok) return kick
  yield* whip(human, kick.power)

  // the leg comes down and the legs catch him: over when he stands
  yield* action({ until: (_state, _clock, time) => time > 3 || (time > 0.3 && Math.abs(human.velocity.z) < 0.1) })
  return kick
}

/**
 * The hip pulls the thigh through with `power` of its strength while the shin trails by its own weight; once the
 * thigh is under the hips the knee snaps the shin straight. Past the ball the same muscles catch the leg.
 */
function* whip(human: Humanoid, power: number) {
  const { chest, rightThigh, rightShin, rightFoot, leftUpperArm, rightUpperArm } = human.parts
  const hard = { frequency: 10, damping: 0.4, strength: power }
  const through = [
    // he goes on over the standing foot at the speed he has
    run(human, human.parts.pelvis.body.linvel().z),
    pose(rightThigh, swing(-0.9), hard),
    pose(rightFoot, swing(0.3), { frequency: 12, damping: 1, strength: 1 }),
    pose(chest, swing(0.05), muscles.tone),
    pose(leftUpperArm, swing(-0.9), muscles.loose),
    pose(rightUpperArm, swing(0.9), muscles.loose),
  ]
  yield* action({ update: [...through, pose(rightShin, swing(1.7))], until: (_state, _clock, time) => rightThigh.bend().x < 0.17 || time > 0.5 })
  yield* action({ update: [...through, pose(rightShin, swing(0), hard)], until: timePassed(0.3, 'seconds') })
}
