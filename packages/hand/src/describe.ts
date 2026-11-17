import { HAND_PARTS } from "./hand"
import type { Grip } from "./grip"
import { CLOSING } from "./touch"

/** how deep skin may be in an object and still count as only touching it (m): about its give */
const TOUCHING = 0.0015

/** What each part of a grip does, a line each, to print and read: for what takes part, how far it is off the object
 * (or in it, past the skin's give) and what it ends against; round a thing the palm holds, whether each finger on it
 * closes round it or lies straight; and how far a finger taking part alone ends from its point */
export function describeGrip({ contacts, pose, using, missedBy }: Grip) {
  const mm = (m: number) => `${(1000 * m).toFixed(1)} mm`
  const palm = using.includes("palm")
  const lines = HAND_PARTS.map((part) => {
    const { gap, stoppedBy } = contacts[part]
    const name = part.padEnd(7)
    const bent = part === "palm" ? 0 : pose[part].bend.reduce((a, b) => a + b)
    const bend = part === "palm" || part === "thumb" ? "" : ` (bent ${bent.toFixed(1)} rad)`
    if (!using.includes(part)) return `${name}takes no part${gap < -TOUCHING ? `, in it ${mm(-gap)}` : ""}`
    if (stoppedBy !== "object") {
      const stop =
        stoppedBy === "finger" ? (part === "thumb" ? "on the fingers" : "stopped by a finger") : stoppedBy === "limit" ? "stopped by its joints" : "free"
      return `${name}${mm(gap)} off it, ${stop}${bend}`
    }
    const on = gap < -TOUCHING ? `in it ${mm(-gap)}` : "on it"
    if (part === "palm" || part === "thumb" || !palm) return `${name}${on}${bend}`
    return `${name}${on}, ${bent >= CLOSING ? "closed round" : "straight"}${bend}`
  })
  return [...lines, ...(missedBy === undefined ? [] : [`its tip ${mm(missedBy)} from the point`])].join("\n")
}
