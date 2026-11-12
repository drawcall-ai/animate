import type { Timeline } from '@pmndrs/timeline'
import { type Humanoid, STEP } from './humanoid'

/** `reachable` is the range of outcomes the rehearsals found; `power` gives `outcome`, the nearest to the target */
export type Solution = { ok: boolean; power: number; outcome: number; reachable: [least: number, most: number] }

/** how many steps the first pass divides `powers` into, and how often the second halves its interval */
const SCAN = 8
const REFINE = 8

type Trial = { power: number; outcome: number }

/**
 * Finds the power at which a recipe makes `measure` come out at `target`, by rehearsing it on copies of the humanoid
 * and its world: first across the whole of `powers`, then between the two rehearsals the target lies between.
 * A rehearsal is over when `measure` gives a value or the recipe ends. Only the recipe is rehearsed, not what else
 * the humanoid is playing.
 */
export function solve(
  human: Humanoid,
  recipe: (trial: Humanoid, power: number) => Timeline<Humanoid, unknown>,
  {
    measure,
    target,
    within,
    powers: [least, most],
  }: {
    measure: (trial: Humanoid) => number | undefined
    target: number
    within: number
    powers: [least: number, most: number]
  },
): Solution {
  const rehearse = (power: number): Trial | undefined => {
    const trial = human.rehearsal()
    trial.play(recipe(trial, power))
    while (trial.playing && measure(trial) === undefined) trial.step()
    const outcome = measure(trial)
    trial.world.free()
    return outcome === undefined ? undefined : { power, outcome }
  }
  const scan: Trial[] = []
  for (let k = 0; k <= SCAN; k++) {
    const trial = rehearse(least + ((most - least) * k) / SCAN)
    if (trial) scan.push(trial)
  }
  if (!scan.length) throw new Error('no rehearsal had an outcome to measure')
  const reachable: [number, number] = [Math.min(...scan.map((t) => t.outcome)), Math.max(...scan.map((t) => t.outcome))]
  const nearest = (trials: Trial[]) =>
    trials.reduce((a, b) => (Math.abs(a.outcome - target) <= Math.abs(b.outcome - target) ? a : b))
  const above = scan.findIndex((t, k) => k > 0 && (t.outcome - target) * (scan[k - 1].outcome - target) <= 0)
  if (above < 0) return { ok: false, ...nearest(scan), reachable }
  let [a, b] = [scan[above - 1], scan[above]]
  for (let k = 0; k < REFINE && Math.abs(nearest([a, b]).outcome - target) > within; k++) {
    const middle = rehearse((a.power + b.power) / 2)
    if (!middle) break
    if ((middle.outcome - target) * (a.outcome - target) <= 0) b = middle
    else a = middle
  }
  const best = nearest([a, b])
  return { ok: Math.abs(best.outcome - target) <= within, ...best, reachable }
}
