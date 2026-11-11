import { Actor, LEG, type Story, arriving } from 'animate-2d'
import { type Field, hold, javelin } from './field'
import { sling } from './sling'

/** a thrower as a run-up delivers him: 5.5 m/s, leaning back, the throwing arm long behind, the other ahead */
export const thrower = () =>
  new Actor<Field>({
    figure: arriving(0, { speed: 5.5, lean: -8, arms: [[184, 184], [12, 18]] }),
    world: { javelin: javelin(), released: null },
  })

export function* javelinThrow(thrower: Actor<Field>): Story {
  hold(thrower, 30)

  // load: the hips drive on ahead and the upper body goes back, like a bow being drawn
  thrower.hurry(1.2)
  thrower.trunk({ lean: -34 }, { seconds: 0.1 })

  // delivery stride: the front foot comes down far ahead of the rear one and stops him
  const rear = thrower.figure.legs[0].foot
  yield* thrower.step('left', { at: rear.p.x + 1.35 * LEG, lands: 'braced' })

  // throw: hips, shoulder, elbow in order, as hard as it takes for the javelin to leave at 28 m/s, 34° up
  const release = (field: Field) => (field.released ? Math.hypot(field.released.velocity.x, field.released.velocity.y) : null)
  yield* thrower.drive(sling(['hips', 'shoulder', 'elbow'], { angle: 34 }), { measure: release, target: 28, powers: [0.5, 14] })

  yield* thrower.settle()
}
