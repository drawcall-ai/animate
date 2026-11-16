import type { Frame } from '@drawcall/plan'
import { Quaternion, Vector3 } from 'three'
import { ease, raised, runs, type Side, type Size, UP, wrap } from './measure'
import { clear } from './stride'

/**
 * how high an ankle is lifted in a step, and how much higher for every pace he goes (in legs); and running, how much of
 * its way it comes through at once rather than easing off (the knee driving on), and how much earlier than halfway it
 * is highest (the heel up behind him)
 */
const LIFT = { least: 0.08, faster: 0.17, through: 0.6, early: 0.15 }
/** how far through the rest of a swing its frames are written, closer together as it comes down */
/** how much further from the other a foot swings past it than it comes down (in legs) */
const PASS = 0.04
/** how far up its heel is as a foot leaves the ground, toe last (rad) */
const TOE_OFF = 0.7
const MARKS = [0.35, 0.65, 0.85, 1]

/** a foot's step through the air: where it left the ground and when, where and when it comes down, and which way it pointed and is to point (rad about y) */
export type Step = { side: Side; from: Vector3; leaves: number; to: Vector3; lands: number; pointed: number; toes: number }

/** where a foot is so far through its step, going so fast: along the ground, lifted clear, and round the other leg */
function swung(size: Size, step: Step, share: number, speed: number, partner: Vector3, faced: number, to: Vector3) {
  const { leg, pace } = size
  const ran = runs(size, speed)
  const high = (LIFT.least + (LIFT.faster * Math.abs(speed)) / pace) * leg + Math.abs(step.to.y - step.from.y) / 2
  const forth = LIFT.through * ran
  const top = 0.5 - LIFT.early * ran
  const on = (1 - forth) * ease(share) + forth * (1 - (1 - share) ** 2)
  to.lerpVectors(step.from, step.to, on)
  // (it leaves the ground heel up, the ankle as high as that has it)
  // (and comes down onto the ground softly, not dropped onto it)
  to.y += high * Math.sin(Math.PI * share ** (Math.log(0.5) / Math.log(top))) ** 1.5 + raised(size, TOE_OFF).y * (1 - share) * (share > 0 ? 1 : 0)
  // (and swinging past the other its toe and heel clear the other's)
  clear(size, to, step.side, partner, faced, speed, Math.min(1, 2 * Math.sin(Math.PI * share)), PASS * size.leg)
  return to
}

/**
 * The frames for the rest of a foot's step from `now`: a few marks along its swing, each with the velocity it has
 * there, and the footfall, at rest, pointing as it is to. Written anew every step as the footfall is aimed anew, the
 * foot goes on from the state it is in.
 */
export function swing(size: Size, step: Step, now: number, speed: number, partner: Vector3, faced: number): Frame[] {
  const T = step.lands - step.leaves
  const share = (t: number) => Math.min(1, Math.max(0, (t - step.leaves) / T))
  const frames: Frame[] = []
  const turn = (s: number) => new Quaternion().setFromAxisAngle(UP, step.pointed + wrap(step.toes - step.pointed) * ease(s))
  const h = 0.003 * size.beat
  for (const mark of MARKS) {
    const at = now + (step.lands - now) * mark
    if (mark === 1) {
      frames.push({ at, place: step.to.clone(), turn: turn(1), by: 'gait' })
      break
    }
    const place = swung(size, step, share(at), speed, partner, faced, new Vector3())
    const next = swung(size, step, share(at + h), speed, partner, faced, new Vector3())
    frames.push({ at, place, velocity: next.sub(place).divideScalar(h), turn: turn(share(at)), by: 'gait' })
  }
  return frames
}
