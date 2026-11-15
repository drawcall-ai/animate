import { Vector3 } from 'three'
import type { Mark } from '@drawcall/animate'

/** how long a miss is shown once it is made (s) */
const SHOWN = 1.5
/** how far apart in time two plans for the same place are the same plan, re-aimed (s) */
const SAME = 0.15
/** how often what the hips were foreseen to do is looked at anew (s) */
const AGAIN = 0.5

/** how far an end came from where it was meant to be at its moment: from there to where it was, until when it shows */
export type Miss = { name: string; meant: Vector3; was: Vector3; until: number }
/** a plan as it was first seen: its moment, and the way it was to go */
type First = { time: number; path: Mark[] }

/** where a way of marks has its place at a moment, if the moment is on it */
export function along(path: readonly Mark[], time: number) {
  const next = path.findIndex((mark) => mark.time >= time)
  if (next <= 0) return next === 0 && path[0].time === time ? path[0].at.clone() : undefined
  const [from, to] = [path[next - 1], path[next]]
  return from.at.clone().lerp(to.at, (time - from.time) / (to.time - from.time))
}

/**
 * What the view remembers of a body, to set what it means against what came of it: per end, the plan as first seen,
 * the next moment it was to be somewhere, and the misses at the moments that have come.
 */
export class Memory {
  private readonly first = new Map<string, First>()
  private readonly next = new Map<string, Mark>()
  private hips?: { time: number; path: Mark[] }
  misses: Miss[] = []

  /** the way a plan due at a moment was first seen to go, which is kept for as long as it is due then: and where that has the end now */
  planned(name: string, time: number, path: Mark[], now: number) {
    const kept = this.first.get(name)
    const same = kept && Math.abs(kept.time - time) < SAME
    if (!same && path.length) this.first.set(name, { time, path: path.map(({ at, time }) => ({ at: at.clone(), time })) })
    if (!same && !path.length) this.first.delete(name)
    const first = this.first.get(name)
    return first && along(first.path, now)
  }

  /**
   * the next moment an end is to be somewhere, as first seen: once that moment has come, where the end `is` then is
   * set against it, and kept as a miss for a while
   */
  due(name: string, now: number, is: Vector3, next?: Mark) {
    const kept = this.next.get(name)
    if (kept && kept.time <= now) {
      this.misses.push({ name, meant: kept.at.clone(), was: is.clone(), until: now + SHOWN })
      this.next.delete(name)
    }
    const known = this.next.get(name)
    if (next && next.time > now && !(known && Math.abs(known.time - next.time) < SAME)) this.next.set(name, { at: next.at.clone(), time: next.time })
    this.misses = this.misses.filter(({ until }) => until > now)
  }

  /** where the hips were foreseen to be now, as foreseen half a second or less ago */
  foreseen(path: Mark[], now: number) {
    if (!this.hips || now - this.hips.time >= AGAIN || now < this.hips.time)
      this.hips = { time: now, path: path.map(({ at, time }) => ({ at: at.clone(), time })) }
    return along(this.hips.path, now)
  }
}
