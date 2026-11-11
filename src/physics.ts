import { type Vec, V, add, len, mul, sub } from './vec'

export const GRAVITY = 9.81

/** A piece of a body or of the world. Held, it is an anchor: something else decides where it is. */
export type Mass = { p: Vec; v: Vec; f: Vec; kg: number; held: boolean }
export const mass = (x: number, y: number, kg: number): Mass => ({ p: V(x, y), v: V(), f: V(), kg, held: false })

/** keeps two masses a length apart, or with `atMost` no further than it */
export type Rod = { a: Mass; b: Mass; length: number; atMost?: boolean }

export function push(m: Mass, f: Vec) {
  m.f.x += f.x
  m.f.y += f.y
}

/** which way the segment from `a` to `b` points */
export const pointing = (a: Mass, b: Mass) => Math.atan2(b.p.y - a.p.y, b.p.x - a.p.x)

/** how fast the segment from `a` to `b` is turning (rad/s, counter-clockwise) */
export function turning(a: Mass, b: Mass) {
  const r = sub(b.p, a.p)
  const dv = sub(b.v, a.v)
  return (r.x * dv.y - r.y * dv.x) / (r.x * r.x + r.y * r.y || 1e-9)
}

/** turns the segment pivot→tip with a torque (N m, counter-clockwise): equal and opposite forces on its two ends */
export function turn(pivot: Mass, tip: Mass, torque: number) {
  const r = sub(tip.p, pivot.p)
  const d2 = r.x * r.x + r.y * r.y || 1e-9
  const f = V((-r.y * torque) / d2, (r.x * torque) / d2)
  push(tip, f)
  push(pivot, mul(f, -1))
}

/** A torque at `joint` between root→joint and joint→tip: it turns one one way and the other the other, so the whole by nothing. */
export function between(root: Mass, joint: Mass, tip: Mass, torque: number) {
  turn(joint, tip, torque)
  turn(root, joint, -torque)
}

function hold({ a, b, length, atMost }: Rod) {
  const d = sub(b.p, a.p)
  const far = len(d) || 1e-9
  if (atMost && far <= length) return
  const wa = a.held ? 0 : 1 / a.kg
  const wb = b.held ? 0 : 1 / b.kg
  if (wa + wb === 0) return
  const k = (far - length) / far / (wa + wb)
  a.p = add(a.p, mul(d, k * wa))
  b.p = sub(b.p, mul(d, k * wb))
}

/** One step of time: forces change speeds, speeds change places, rods pull the places back, and the speeds are what the places then did. */
export function advance(masses: Mass[], rods: Rod[], dt: number) {
  const before = masses.map((m) => m.p)
  for (const m of masses) {
    if (m.held) {
      m.v = V()
      continue
    }
    m.v = add(m.v, mul(V(m.f.x / m.kg, m.f.y / m.kg - GRAVITY), dt))
    m.p = add(m.p, mul(m.v, dt))
  }
  for (let k = 0; k < 8; k++) for (const rod of rods) hold(rod)
  masses.forEach((m, k) => {
    if (!m.held) m.v = mul(sub(m.p, before[k]), 1 / dt)
    m.f = V()
  })
}

export type Round = { p: Vec; v: Vec; kg: number; radius: number }

/** Two round things meeting: `b` is pushed out of `a`, and the speed they had toward each other is given back, `bounce` of it. True if they met. */
export function meet(a: Round, b: Round, bounce: number) {
  const d = sub(b.p, a.p)
  const far = len(d)
  const reach = a.radius + b.radius
  if (far >= reach || far === 0) return false
  const n = mul(d, 1 / far)
  const closing = (b.v.x - a.v.x) * n.x + (b.v.y - a.v.y) * n.y
  b.p = add(a.p, mul(n, reach))
  if (closing < 0) {
    const j = (-(1 + bounce) * closing) / (1 / a.kg + 1 / b.kg)
    b.v = add(b.v, mul(n, j / b.kg))
    a.v = sub(a.v, mul(n, j / a.kg))
  }
  return true
}
