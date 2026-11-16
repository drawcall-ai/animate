import { Vector3 } from 'three'
import type { Mark } from '@drawcall/animate'

/** how often what the hips were foreseen to do is looked at anew (s) */
const AGAIN = 0.5

/** where a way of marks has its place at a moment, if the moment is on it */
export function along(path: readonly Mark[], time: number) {
  const next = path.findIndex((mark) => mark.time >= time)
  if (next <= 0) return next === 0 && path[0].time === time ? path[0].at.clone() : undefined
  const [from, to] = [path[next - 1], path[next]]
  return from.at.clone().lerp(to.at, (time - from.time) / (to.time - from.time))
}

/** What the view remembers of a body: what its hips were foreseen to do, to set against what they did. */
export class Memory {
  private hips?: { time: number; path: Mark[] }

  /** where the hips were foreseen to be now, as foreseen half a second or less ago */
  foreseen(path: Mark[], now: number) {
    if (!this.hips || now - this.hips.time >= AGAIN || now < this.hips.time)
      this.hips = { time: now, path: path.map(({ at, time }) => ({ at: at.clone(), time })) }
    return along(this.hips.path, now)
  }
}
