export type Vec = { x: number; y: number }

export const V = (x = 0, y = 0): Vec => ({ x, y })
export const add = (a: Vec, b: Vec) => V(a.x + b.x, a.y + b.y)
export const sub = (a: Vec, b: Vec) => V(a.x - b.x, a.y - b.y)
export const mul = (a: Vec, k: number) => V(a.x * k, a.y * k)
export const len = (a: Vec) => Math.hypot(a.x, a.y)
/** a vector of a length, pointing at an angle */
export const out = (angle: number, length: number) => V(Math.cos(angle) * length, Math.sin(angle) * length)

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
export const rad = (degrees: number) => (degrees * Math.PI) / 180
export const deg = (radians: number) => (radians * 180) / Math.PI
/** an angle brought into -π…π */
export const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))
/** 0 to 1 with no speed and no push at either end */
export function smooth(x: number) {
  const t = clamp(x, 0, 1)
  return t * t * t * (10 - 15 * t + 6 * t * t)
}
