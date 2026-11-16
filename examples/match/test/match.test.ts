// Headless: two players rally for a minute of simulated time. `pnpm test` prints the numbers.
import { afterAll, expect, test } from "vitest"
import { type Contact, createMatch } from "../src/match"
import { rig } from "../src/rig"

const env = (globalThis as { process?: { env: Record<string, string> } }).process?.env ?? {}
const DT = 1 / 60,
  SECONDS = Number(env.SECONDS ?? 60),
  SEED = Number(env.SEED ?? 7)
const report: string[] = []
const say = (s: string) => report.push(s)
afterAll(() => console.log("\n" + report.join("\n") + "\n"))

// Once as bare skeletons of the procedural humanoid, once as the rigged characters: the same planners, other proportions.
test.each(["procedural humanoid", "rigged character (@drawcall/rig)"])(
  "two players rally for 60 s: %s",
  async (who) => {
    const rigged = who.startsWith("rigged") ? (await Promise.all([rig(), rig()])).map((r) => r.object) : []
    const match = await createMatch(SEED, rigged)
    const contacts: Contact[] = [],
      ends = new Map<string, number>()
    const names = match.players[0].names
    const missed = names.map(() => ({ sum: 0, max: 0, n: 0, unreachable: 0 }))
    const perPlayer = [0, 1].map(() => ({ ms: 0, msMax: 0, dq: 0, jumps: 0, dragged: 0, iterations: 0, unconverged: 0, frames: 0 }))
    const previous = match.players.map((p) => p.body.q.slice())
    for (let k = 0; k < SECONDS / DT; k++) {
      const frame = match.step(DT)
      if (frame.contact) contacts.push(frame.contact)
      if (frame.ended) ends.set(frame.ended, (ends.get(frame.ended) ?? 0) + 1)
      frame.results.forEach((r, i) => {
        const s = perPlayer[i],
          q = match.players[i].body.q
        s.ms += frame.solveMs[i]
        s.msMax = Math.max(s.msMax, frame.solveMs[i])
        s.iterations += r.iterations
        s.frames++
        if (!r.converged) s.unconverged++
        const change = k > 0 ? Math.max(...q.map((v, j) => (j > 2 ? Math.abs(v - previous[i][j]) : 0))) : 0 // joints, not the base's travel
        s.dq = Math.max(s.dq, change)
        if (change > 0.5) s.jumps++
        if (r.goals[names.indexOf("pelvis (soft)")].missedBy > 0.25) s.dragged++
        previous[i] = q.slice()
        r.goals.forEach((g, j) => {
          const m = missed[j]
          m.sum += g.missedBy
          m.max = Math.max(m.max, g.missedBy)
          m.n++
          if (!g.reachable) m.unreachable++
        })
      })
    }
    const hits = contacts.filter((c) => c.hit),
      misses = contacts.filter((c) => !c.hit)
    const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
    say(`${who}: ${SECONDS} s simulated at 60 fps, ball on @drawcall/physics (Rapier), seed ${SEED}`)
    say(
      `  rallies: ${match.rallies.length} ended, lengths (hits) ${match.rallies.join(" ")}; mean ${mean(match.rallies).toFixed(1)}, longest ${Math.max(0, ...match.rallies)}; still in play at the end: ${match.hits} hits`,
    )
    say(`  contacts attempted: ${contacts.length}; hit ${hits.length}, missed ${misses.length}`)
    say(
      `  sweet spot to ball at contact (hits): mean ${(1000 * mean(hits.map((c) => c.distance))).toFixed(1)} mm, worst ${(1000 * Math.max(0, ...hits.map((c) => c.distance))).toFixed(1)} mm`,
    )
    say(
      `  misses by cause: ${["unreachable", "late", "mistimed"].map((w) => `${w} ${misses.filter((c) => c.why === w).length}`).join(", ")}${misses.length ? `; missed by ${misses.map((c) => (100 * c.distance).toFixed(0) + " cm").join(", ")}` : ""}`,
    )
    say(`  rallies ended by: ${[...ends].map(([why, n]) => `${why} x${n}`).join("; ") || "none ended"}`)
    say(`  per goal, missed by (mean / max over all frames and both players; hard goals should be 0):`)
    names.forEach((name, j) =>
      say(
        `    ${name.padEnd(20)} ${missed[j].sum / missed[j].n < 1e-6 ? (missed[j].sum / missed[j].n).toExponential(1) : (missed[j].sum / missed[j].n).toFixed(4)} / ${missed[j].max.toFixed(4)}${name.includes("soft") ? "" : `   not met in ${((100 * missed[j].unreachable) / missed[j].n).toFixed(1)}% of frames`}`,
      ),
    )
    perPlayer.forEach((s, i) =>
      say(
        `  player ${"AB"[i]}: solve ${(s.ms / s.frames).toFixed(2)} ms/frame (max ${s.msMax.toFixed(1)}), ${(s.iterations / s.frames).toFixed(1)} iterations/frame, unconverged ${s.unconverged} of ${s.frames}, max frame-to-frame joint change ${s.dq.toFixed(2)} rad (above 0.5 rad in ${s.jumps} frames), pelvis more than 0.25 off its plan in ${s.dragged} frames`,
      ),
    )
    expect(Math.max(match.hits, ...match.rallies)).toBeGreaterThan(3)
    expect(hits.length).toBeGreaterThan(5)
  },
  300000,
)
