import type { ActionUpdate } from '@pmndrs/timeline'
import { action, timePassed } from '@pmndrs/timeline'
import { type Humanoid, muscles, pose, solve } from 'animate-2d'
import { Euler } from 'three'
import { type Held, flight, heldIn, released } from './field'

/** how far up from level the javelin is to leave (rad) */
const RELEASE = 0.6

/** a limb or the trunk swung in the plane the humanoid faces: limbs go back with a positive angle, the trunk leans forward (rad) */
const swing = (angle: number) => new Euler(angle, 0, 0)

/** A standing throw with the right arm, as hard as it takes for the javelin to leave at `speed` (m/s). */
export function* javelinThrow(human: Humanoid, held: Held, speed: number) {
  const { chest, rightUpperArm, leftUpperArm } = human.parts

  // draw: the throwing arm goes long behind, the trunk back, the other arm ahead
  const draw = [
    pose(rightUpperArm, swing(1.2)),
    pose(chest, swing(-0.35)),
    pose(leftUpperArm, swing(-1.2), muscles.loose),
  ]
  yield* action({ update: draw, until: timePassed(0.8, 'seconds') })

  const thrown = solve(human, (trial, power) => sling(trial, heldIn(trial.world, held), power), {
    measure: (trial) => released(trial.world, held),
    target: speed,
    within: 0.5,
    powers: [0.1, 1],
  })
  if (!thrown.ok) return thrown
  yield* sling(human, held, thrown.power)

  // the arm comes down
  yield* action({ until: timePassed(1.5, 'seconds') })
  return thrown
}

/**
 * The trunk comes forward and the shoulder pulls the arm over the top, both with `power` of their strength; the hand
 * lets go when the javelin flies at the release angle.
 */
function* sling(human: Humanoid, held: Held, power: number) {
  const { chest, rightUpperArm } = human.parts
  const hard = { frequency: 10, damping: 0.4, strength: power }
  const over = [pose(chest, swing(0.4), hard), pose(rightUpperArm, swing(4.2), hard), letGo(human, held)]
  yield* action({ update: over, until: timePassed(0.5, 'seconds') })
}

/** opens the hand once the javelin flies forward and no steeper than the release angle */
function letGo(human: Humanoid, { javelin, grip }: Held): ActionUpdate<unknown> {
  return () => {
    if (!human.world.impulseJoints.contains(grip.handle)) return
    const { angle, forward } = flight(javelin)
    if (forward && angle <= RELEASE) human.world.removeImpulseJoint(grip, true)
  }
}
