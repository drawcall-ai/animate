import { type Matrix4, Vector3 } from "three"
import { all, angles, check, type HandPart, FINGERS, fist, lerp, limits, fromAngles, type HandPose, relaxed, type Segment } from "./hand"
import { apart, type Contact, SPLAYED, type Touch, type Touching, UP } from "./touch"

/** the mean of some points */
export const mean = (points: Vector3[]) => points.reduce((sum, p) => sum.addScaledVector(p, 1 / points.length), new Vector3())
/** where a finger's last bone presses: its pad, two thirds of the way to the tip */
export const pad = ({ a, b }: Segment) => a.clone().lerp(b, 2 / 3)

/** what of the hand takes part: the fingers, the thumb, the palm, and whether it is a pinch, thumb and fingers
 * without the palm */
export const taking = (using: readonly HandPart[]) => {
  const fingers = FINGERS.filter((f) => f !== "thumb" && using.includes(f))
  const [thumb, palm] = [using.includes("thumb"), using.includes("palm")]
  return { fingers, thumb, palm, pinch: !palm && thumb && fingers.length > 0 }
}

/** the fingers on an object, in the world: their pose, and where each part meets the object and what it ends against */
export type Fitted = { pose: HandPose; contacts: Record<HandPart, Contact> }

/** The fingers fitted to the object from where the hand is: `place` is the hand bone in the world, and nothing here
 * moves it. Closing is enclosing. The fingers taking part close one by one from straight, each kept from those before,
 * till each bone meets something; a finger alone, given a `point` (world), reaches for it instead. What is left out
 * keeps its pose in `held` where the object and those fingers allow, else moves the least that clears. The thumb,
 * taking part, closes last: with the palm from standing out of it, lowered toward its side as far as the object is in
 * the way, folding till each bone meets something; with fingers but no palm its tip presses the object against their
 * pads, from across it. Nothing closes through the object: a finger the object is in the way of gets out of its way,
 * and one no pose brings out, as when the wrist puts its knuckle in the object, is held where it is in it the least.
 * The contacts are in the world */
export function fit(touch: Touch, place: Matrix4, using: readonly HandPart[], held: HandPose, point?: Vector3): Fitted {
  const { shape, skin, fine } = touch
  const { fingers, thumb, palm, pinch } = taking(using)
  /** the bones of a pose, but for the palm and those `but` names */
  const rods = (pose: HandPose, but = (_: HandPart) => false) => shape.segments(pose, place).filter((g) => g.part !== "palm" && !but(g.part))
  const pose: HandPose = { ...held }
  for (const [k, f] of fingers.entries()) {
    const others = rods(pose, (part) => !fingers.slice(0, k).some((g) => g === part))
    // without the palm the fingers lie side by side, spread as when relaxed
    const spread = palm ? 0 : relaxed[f].spread
    const alone = point && !palm && !thumb
    pose[f] = fromAngles(alone ? touch.reach(f, place, pose, point, others) : touch.wrap(f, place, pose, spread, others))
  }
  const holding = rods(pose, (part) => !fingers.some((g) => g === part))
  for (const f of FINGERS.filter((f) => !using.includes(f))) pose[f] = fromAngles(touch.free(f, place, pose, holding))
  const thumbs = limits("thumb")
  const others = rods(pose, (part) => part === "thumb")
  if (pinch) {
    // each pad's contact taken through the object to its other side: there the thumb's tip presses
    const pads = fingers.map((f) => touch.contact(pose, place, f, pad(rods(pose).filter((g) => g.part === f)[2])))
    const out = mean(pads.map((c) => c.normal.clone().negate())).normalize()
    const across = (c: Touching) => {
      const through = skin.cast(c.at.clone().addScaledVector(out, fine), out)
      return c.at.clone().addScaledVector(out, Number.isFinite(through) ? through + fine : 0)
    }
    pose.thumb = fromAngles(touch.press("thumb", place, pose, mean(pads.map(across)), out, others, angles(fist.thumb)))
  } else if (thumb) {
    const open = lerp(UP, SPLAYED, touch.clear("thumb", place, pose, UP, SPLAYED, []).share)
    const shut = [...angles(fist.thumb).slice(0, 2), thumbs[2][1], thumbs[3][1]]
    pose.thumb = fromAngles(touch.close("thumb", place, pose, open, shut, others))
  }
  check(pose)

  /** what a part ends against: the object, where its skin is within the give of it; else another finger it is
   * pressed on (for the thumb, the fingers it rests on); else its joints' limits, a finger closed as far as it folds;
   * else nothing */
  const stoppedBy = (part: HandPart, { gap }: Touching): Contact["stoppedBy"] => {
    if (gap <= fine) return "object"
    if (part === "palm") return "nothing"
    const others = rods(pose, (o) => o === part || (part !== "thumb" && o === "thumb"))
    if (rods(pose).some((g) => g.part === part && apart(g, touch.beside(g, others)) <= fine)) return "finger"
    const shut = part === "thumb" ? [] : fist[part].bend
    return shut.length && pose[part].bend.every((v, i) => v >= shut[i]) ? "limit" : "nothing"
  }
  // a finger's side along a flat thing touches all along it: where it squeezes is across from the thumb
  const near = pinch ? touch.contact(pose, place, "thumb").at : undefined
  const contacts = all((part) => {
    const contact = touch.contact(pose, place, part, near)
    return { ...contact, stoppedBy: stoppedBy(part, contact) }
  })
  return { pose, contacts }
}
