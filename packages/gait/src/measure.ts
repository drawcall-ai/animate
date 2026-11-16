import { Vector3 } from 'three'

export type Side = 'left' | 'right'
export const SIDES: Side[] = ['left', 'right']
export const SIGN = { left: 1, right: -1 }
export const other = (side: Side): Side => (side === 'left' ? 'right' : 'left')
export const GRAVITY = 9.81
export const UP = new Vector3(0, 1, 0)

/**
 * what the gait's measures are counted in (m): how long a leg is and its parts, how far out a hip is, how high the
 * hips stand and an ankle; a beat, how long a hanging leg takes over a radian of its swing (s), and a pace, how fast it
 * goes its length in that (m/s)
 */
export type Size = Readonly<{ leg: number; thigh: number; shin: number; hip: number; stand: number; ankle: number; beat: number; pace: number }>

export const clamp = (value: number, least: number, most: number) => Math.min(most, Math.max(least, value))
export const wrap = (angle: number) => angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI))
export const ease = (share: number) => share * share * (3 - 2 * share)
/** a velocity a step on, pulled toward where it is `off` from like a weight on a spring that comes round `pull` rad a second, never overshooting */
export const damped = (velocity: number, off: number, pull: number, dt: number) => (velocity + pull * pull * off * dt) / (1 + pull * dt) ** 2
/** the way along the ground facing so (rad about y from +z toward +x), and the way to his left */
export const ahead = (angle: number, to = new Vector3()) => to.set(Math.sin(angle), 0, Math.cos(angle))
export const left = (angle: number, to = new Vector3()) => to.set(Math.cos(angle), 0, -Math.sin(angle))
export const angleOf = (x: number, z: number) => Math.atan2(x, z)

/** how far behind its ankle a foot stands, and how far ahead its ball is (in lengths of his leg); how far a heel comes up (rad) */
export const SOLE = { behind: 0.068, ball: 0.182 }
export const HEEL = 0.9
/** how far up and on the ankle is with the heel up by an angle (m) */
export const raised = ({ ankle, leg }: Size, angle: number) => ({
  y: SOLE.ball * leg * Math.sin(angle) + ankle * (Math.cos(angle) - 1),
  z: SOLE.ball * leg * (1 - Math.cos(angle)) + ankle * Math.sin(angle),
})

/** how fast he walks, and at the most (in paces); how fast he sprints */
export const WALK = { speed: 0.476, most: 0.851 }
export const RUN = 3.4
/** how hard a leg on the ground pushes the hips along (m/s²), and up */
export const PUSH = { along: 6, up: 20 }
/** how slow he counts as standing, and as still (in paces); how near feet side by side are along him (in legs) */
export const SLOW = 0.1
export const STILL = 0.017
export const TOGETHER = 0.114
/** how near the way he is to face counts as facing it (rad) */
export const FACED = 0.02
/** how long the hips take over the last of their way to rest (in beats) */
export const SETTLE = 0.835
/** how low the hips go at the most, in shares of how high they stand: a full squat */
export const LOWEST = 0.316

/** how far he runs rather than walks, going so fast (m/s): from 0 to 1, about the fastest he walks */
export const runs = ({ pace }: Size, speed: number) => {
  const eased = clamp((Math.abs(speed) / (WALK.most * pace) - 0.85) / 0.3, 0, 1)
  return eased * eased * (3 - 2 * eased)
}
/** how low the hips ride walking and running, and how far they rise and fall in a stride (in legs): highest over a foot walking, lowest running */
const RIDES = { walk: 0.057, run: 0.09 }
const BOB = { walk: 0.018, run: -0.035 }
const blend = (size: Size, speed: number, rule: { walk: number; run: number }) => {
  const [ran, walks] = [runs(size, speed), Math.min(1, Math.abs(speed) / (WALK.speed * size.pace))]
  return (rule.walk * walks * (1 - ran) + rule.run * ran) * size.leg
}
/** how much lower than they stand the hips ride, and how far they rise over a foot mid-stance, going so fast (m) */
export const dip = (size: Size, speed: number) => blend(size, speed, RIDES)
export const bob = (size: Size, speed: number) => blend(size, speed, BOB)
/** how far out from under the middle of the hips a foot stands, going so fast: narrower running (m) */
export const wide = (size: Size, speed: number) => size.hip * (1 - 0.45 * runs(size, speed))
/**
 * how far ahead of the hips a straight leg reaches the ground going so fast, from as low as they ride as it comes
 * down, and how far behind, from as high, its heel most of the way up as it leaves (m)
 */
export const span = (size: Size, speed: number) => {
  const { stand, ankle, leg } = size
  const [low, high] = [-1, 1].map((by) => stand - dip(size, speed) + by * Math.abs(bob(size, speed)) - ankle)
  const reach = (up: number) => Math.sqrt(Math.max(0, leg ** 2 - up ** 2))
  const heel = raised(size, 0.8 * HEEL)
  return { ahead: reach(low), behind: reach(high - heel.y) + heel.z }
}
/** how far through its time down a foot is under the hips: it comes down nearer ahead of them than it leaves behind */
export const over = (size: Size, speed: number) => {
  const { ahead, behind } = span(size, speed)
  return ahead / (ahead + behind)
}
/** how far he leans into a turn to his left, going so fast round it so fast (rad/s), as the tangent: at the most a half */
export const leant = (speed: number, curves: number) => clamp((speed * curves) / GRAVITY, -0.5, 0.5)
/** how far a leg turns in over its foot at the most, and out (rad): how far round from his hips a foot of a side may point */
export const twist = (side: Side) => (side === 'left' ? [-0.2, 0.6] : [-0.6, 0.2])
