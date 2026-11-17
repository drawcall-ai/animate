// Headless: two players rally for a minute of simulated time. `pnpm test` prints the numbers.
import { CachedPlayerLoader } from "@drawcall/example-stage/player"
import { describeGrip, type Goal } from "@drawcall/animate"
import { afterAll, expect, test } from "vitest"
import { createMatch, type Hit } from "../src/match"

const env = (globalThis as { process?: { env: Record<string, string> } }).process?.env ?? {}
const DT = 1 / 60,
  SECONDS = Number(env.SECONDS ?? 60),
  SEED = Number(env.SEED ?? 7)
const report: string[] = []
const say = (s: string) => report.push(s)
afterAll(() => console.log("\n" + report.join("\n") + "\n"))
/** A goal as the report names it: the point it moves, or what a posture is. */
const label = (g: Goal) => ("point" in g ? `${g.point.name || "?"}${g.hard ? "" : " (soft)"}` : "posture (soft)")

test("two rigged players rally for 60 s", async () => {
  // one after the other, so that on a cold cache the second reads the weights the first computed
  const a = await new CachedPlayerLoader().loadAsync()
  const b = await new CachedPlayerLoader().loadAsync()
  const match = await createMatch(SEED, [a.object, b.object])
  const { grips } = match.players[0]
  say(`the right hand on the racket\n${describeGrip(grips.right)}`.replace(/\n/g, "\n  "))
  say(`the left hand on the racket, in a backhand\n${describeGrip(grips.left)}`.replace(/\n/g, "\n  "))
  const attempts: Hit[] = [],
    ends = new Map<string, number>()
  const missed = new Map<string, { sum: number; max: number; n: number; unreachable: number }>()
  const perPlayer = [0, 1].map(() => ({ ms: 0, msMax: 0, dq: 0, jumps: 0, dragged: 0, iterations: 0, unconverged: 0, frames: 0 }))
  const previous = match.players.map((p) => p.body.angles.slice())
  for (let k = 0; k < SECONDS / DT; k++) {
    const frame = match.step(DT)
    if (frame.hit) attempts.push(frame.hit)
    if (frame.ended) ends.set(frame.ended, (ends.get(frame.ended) ?? 0) + 1)
    frame.results.forEach((r, i) => {
      const s = perPlayer[i],
        q = match.players[i].body.angles
      s.ms += frame.solveMs[i]
      s.msMax = Math.max(s.msMax, frame.solveMs[i])
      s.iterations += r.iterations
      s.frames++
      if (!r.converged) s.unconverged++
      const change = k > 0 ? Math.max(...q.map((v, j) => (j > 2 ? Math.abs(v - previous[i][j]) : 0))) : 0 // joints, not the base's travel
      s.dq = Math.max(s.dq, change)
      if (change > 0.5) s.jumps++
      previous[i] = q.slice()
      r.goals.forEach((g, j) => {
        const name = label(frame.goals[i][j])
        if (name === "pelvis (soft)" && g.missedBy > 0.25) s.dragged++
        const m = missed.get(name) ?? { sum: 0, max: 0, n: 0, unreachable: 0 }
        missed.set(name, m)
        m.sum += g.missedBy
        m.max = Math.max(m.max, g.missedBy)
        m.n++
        if (!g.met) m.unreachable++
      })
    })
  }
  const hits = attempts.filter((c) => !c.missed),
    misses = attempts.filter((c) => c.missed)
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
  say(`two rigged players: ${SECONDS} s simulated at 60 fps, ball on @drawcall/physics (Rapier), seed ${SEED}`)
  say(
    `  rallies: ${match.rallies.length} ended, lengths (hits) ${match.rallies.join(" ")}; mean ${mean(match.rallies).toFixed(1)}, longest ${Math.max(0, ...match.rallies)}; still in play at the end: ${match.hits} hits`,
  )
  say(`  contacts attempted: ${attempts.length}; hit ${hits.length}, missed ${misses.length}`)
  say(
    `  sweet spot to ball at contact (hits): mean ${(1000 * mean(hits.map((c) => c.distance))).toFixed(1)} mm, worst ${(1000 * Math.max(0, ...hits.map((c) => c.distance))).toFixed(1)} mm`,
  )
  say(
    `  misses by cause: ${["unreachable", "late", "mistimed"].map((w) => `${w} ${misses.filter((c) => c.missed === w).length}`).join(", ")}${misses.length ? `; missed by ${misses.map((c) => (100 * c.distance).toFixed(0) + " cm").join(", ")}` : ""}`,
  )
  say(`  rallies ended by: ${[...ends].map(([why, n]) => `${why} x${n}`).join("; ") || "none ended"}`)
  say(`  per goal, by the point it moves, missed by (mean / max over all frames and both players; hard goals should be 0):`)
  missed.forEach((m, name) =>
    say(
      `    ${name.padEnd(20)} ${m.sum / m.n < 1e-6 ? (m.sum / m.n).toExponential(1) : (m.sum / m.n).toFixed(4)} / ${m.max.toFixed(4)}${name.includes("soft") ? "" : `   not met in ${((100 * m.unreachable) / m.n).toFixed(1)}% of frames`}`,
    ),
  )
  perPlayer.forEach((s, i) =>
    say(
      `  player ${"AB"[i]}: solve ${(s.ms / s.frames).toFixed(2)} ms/frame (max ${s.msMax.toFixed(1)}), ${(s.iterations / s.frames).toFixed(1)} iterations/frame, unconverged ${s.unconverged} of ${s.frames}, max frame-to-frame joint change ${s.dq.toFixed(2)} rad (above 0.5 rad in ${s.jumps} frames), pelvis more than 0.25 off its plan in ${s.dragged} frames`,
    ),
  )
  expect(Math.max(match.hits, ...match.rallies)).toBeGreaterThan(3)
  expect(hits.length).toBeGreaterThan(5)
})
