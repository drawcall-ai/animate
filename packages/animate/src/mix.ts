import { FINGERS, HandPose, mix as mixHand } from "@drawcall/hand"
import { mix as mixBody, type Pose } from "@drawcall/ik"

const isHandPose = (pose: Pose | HandPose): pose is HandPose => FINGERS.every((finger) => finger in pose && !Array.isArray(pose[finger]))

/** A pose a share `u` of the way from `a` to `b`: two body poses (bones only one of them lists are kept as listed), or two hand poses, finger by finger and joint by joint. Throws for one of each. */
export function mix(a: Pose, b: Pose, u: number): Pose
export function mix(a: HandPose, b: HandPose, u: number): HandPose
export function mix(a: Pose | HandPose, b: Pose | HandPose, u: number): Pose | HandPose {
  if (isHandPose(a) && isHandPose(b)) return mixHand(a, b, u)
  if (!isHandPose(a) && !isHandPose(b)) return mixBody(a, b, u)
  throw new Error("mix takes two body poses or two hand poses, not one of each")
}
