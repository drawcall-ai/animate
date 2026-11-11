import { type Actor, GRAVITY, KG, type Vec, V, add, mul, out, rad } from 'animate-2d'

export const JAVELIN = { ahead: 1.05, behind: 1.55, kg: 0.8 }
/** where the throw is measured from, and what the thrower must not cross (m) */
export const FOUL_LINE = 8

/** `speed` is null while it is in the hand */
export type Javelin = { at: Vec; angle: number; speed: Vec | null; stuck: boolean }
/** what the thrower acts on: the javelin, and how it left the hand */
export type Field = { javelin: Javelin; released: { time: number; velocity: Vec } | null }

export const javelin = (): Javelin => ({ at: V(), angle: 0.1, speed: null, stuck: false })
export const end = (j: Javelin, along: number) => add(j.at, out(j.angle, along))

export function fly(j: Javelin, dt: number) {
  if (!j.speed || j.stuck) return
  j.speed.y -= GRAVITY * dt
  j.at = add(j.at, mul(j.speed, dt))
  j.angle = Math.atan2(j.speed.y, j.speed.x)
  if (end(j, JAVELIN.ahead).y <= 0) j.stuck = true
}

/** the right hand takes the javelin: it weighs on the hand and goes where the hand goes, pointing `angle` up, until it is released */
export function hold(thrower: Actor<Field>, angle: number) {
  const hand = thrower.figure.arms[0].hand
  hand.kg = KG.hand + JAVELIN.kg
  thrower.act((dt) => {
    const { javelin, released } = thrower.world
    if (released) return false
    javelin.at = V(hand.p.x, hand.p.y)
    javelin.angle += (rad(angle) - javelin.angle) * Math.min(1, dt * 30)
    return true
  })
}
