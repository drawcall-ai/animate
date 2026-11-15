import { Quaternion, Vector3 } from 'three'
import { cubic, type State } from './curve'
import type { Limb } from './limb'
import type { Plan } from './planner'
import type { Aimed } from './reach'
import { moves } from './track'

/** a place at a moment on his clock, in the frame of the body */
export type Mark = { at: Vector3; time: number }
/**
 * a place an end is sent to, as planned: where it is to be and when, moving how fast, when it sets off, whether it was
 * there once its moment came, and if the plan comes short of what was asked, how: out of `reach` (by so far, m), not
 * turned as asked, or too weak to get there in time
 */
export type Sent = Mark & {
  velocity: Vector3
  leaves: number
  there?: boolean
  short?: { by: 'reach' | 'turn' | 'strength'; far?: number }
}
/**
 * What an end means to do, for whoever looks: the places it is sent to, the one it is on its way to first, and the way
 * its joints are driven there, as marks of what it is sent `with` (a fingertip or what sits in the hand, turning with
 * the hand; or the wrist or ankle) on the way to the first, the body going as foreseen; and how far what it is sent
 * with is from the wrist now
 */
export type Aim = { sent: Sent[]; path: Mark[]; tip: Vector3 }

/** how many marks a way is told by */
const MARKS = 24
const SHORT = ['reach', 'turn', 'strength'] as const

/** what an end has that tells its aim: see `aim` */
export type Aiming = {
  now: number
  sent: readonly Plan[]
  going?: Plan
  limb: Limb
  where(plan: Plan, seconds: number): Vector3
  solve(plan: Plan, seconds: number): Aimed
  drawn(aimed: Aimed, swing: number): Record<'first' | 'second', State & { swing: number }> & { wrist?: State & { swing: number } }
  root(seconds: number, at: Vector3, turned: Quaternion): Vector3
  sits(plan: Plan, seconds: number, first: Vector3, fold: number, wrist: Vector3): Vector3
  tip: Vector3
}

export function aim({ now, sent, going, limb, where, solve, drawn, root, sits, tip }: Aiming): Aim {
  const told = sent.map(
    (plan): Sent => ({
      at: where(plan, Math.max(0, plan.when - now)).clone(),
      time: plan.when,
      velocity: moves(plan) ? plan.velocity.clone() : new Vector3(),
      leaves: plan.leaves,
      there: plan.there,
      short: plan.near && { by: SHORT[plan.near.rank], far: plan.near.rank === 0 ? plan.near.by : undefined },
    }),
  )
  if (!going || going.when <= now) return { sent: told, path: [], tip }
  // the way it is driven: drawn back first for a swing, then swinging in, each joint from how it is now
  const seconds = going.when - now
  const aimed = solve(going, seconds)
  const back = drawn(aimed, going.swing)
  const turned = new Quaternion()
  const [value, velocity, start] = [new Vector3(), new Vector3(), new Vector3()]
  const at = (joint: 'first' | 'second' | 'wrist', t: number) => {
    const [from, to, drawing] = [limb[joint], aimed[joint], back[joint]]
    if (!from || !to || !drawing) return new Vector3()
    const lead = seconds - drawing.swing
    if (lead > 0 && t < lead) return cubic(t / lead, lead, from, drawing, value, velocity).clone()
    const swing = Math.min(drawing.swing, seconds)
    return cubic(swing > 0 ? (t - Math.max(lead, 0)) / swing : 1, swing, lead > 0 ? drawing : from, to, value, velocity).clone()
  }
  const path: Mark[] = []
  for (let k = 0; k <= MARKS; k++) {
    const t = (seconds * k) / MARKS
    const [first, fold, wrist] = [at('first', t), at('second', t).x, at('wrist', t)]
    const place = limb.at(first, fold)
    root(t, start, turned)
    path.push({ at: place.applyQuaternion(turned).add(start).add(sits(going, t, first, fold, wrist)), time: now + t })
  }
  return { sent: told, path, tip }
}
