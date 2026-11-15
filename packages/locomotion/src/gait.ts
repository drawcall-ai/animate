import { ANKLE, clamp, GRAVITY, HEEL, raised, type Size } from '@drawcall/limbs'

/** how hard a leg on the ground pushes the hips: along it, over half his weight, and up, twice it (m/s²) */
export const PUSH = { along: 6, up: 20 }
/** how fast he walks, and at the most (in his paces), and how hard that pushes the hips (m/s²) */
export const WALK = { speed: 0.476, most: 0.851, push: 2 }
/** a run: how fast he sprints (in his paces), and how hard a foot on the ground pushes the hips unless it is said (m/s²) */
export const RUN = { most: 3.4, push: 5 }
/** how high a foot is lifted in a step, and how much higher for every pace he goes (in lengths of his leg): the heel kicks up behind him, as far as a knee folds */
export const CLEAR = { least: 0.045, faster: 0.134 }
/** how long his being led faster or slower goes on as it is, as it dies away (in his beats) */
export const SPEEDS = 0.75
/** how fast the hips go at the most while he counts as standing (in his paces) */
export const SLOW = 0.1
/** how slow the hips are when they are at rest (in his paces), and how near where they were to come to rest (in lengths of his leg) */
export const STILL = 0.017
export const THERE = 0.0114
/** how fast the hips go at the most while he shifts his weight over his feet, standing on both (in his paces) */
export const SHIFTS = 0.17
/** how fast he lets himself down, and the hips ride back behind his feet (in his paces) */
export const SINK = 0.34
/** how long the hips take over the last of their way to rest (in his beats) */
export const SETTLE = 0.835
/** the least between two footfalls, which is as long as he is in the air between strides at a run (in his beats) */
export const CADENCE = 0.668
/** how far apart along z feet are at the most that stand side by side (in lengths of his leg): a step no longer than that is not worth making */
export const TOGETHER = 0.114
/** how near as high as they were sent the hips count as there (in lengths of his leg) */
export const HIGH = 0.034
/** how far along z the hips are sent at the most without that being a walk (in lengths of his leg) */
export const SPOT = 0.057
/**
 * a place he steps to as he faces, backing or sidestepping rather than turn to it: no further off than a stride (in
 * lengths of his leg); and how fast he backs at the most (in his paces)
 */
export const KEEPS = { near: 0.85, back: 0.5 }

/** how low the hips go while he walks along, in shares of how high they stand */
export const CROUCH = 0.737
/** how much lower than they stand the hips are, going at a walk, as a foot comes down: for its leg to reach ahead of them (in lengths of his leg) */
export const RIDE = 0.057
/** how low the hips go in a stride, for a hand or a foot to reach (m): a lunge, the thigh in front level and the knee behind still off the ground */
export const lunge = ({ ankle, shin }: Size) => ankle + shin
/** how low the hips go, in shares of how high they stand: and so how low (m), and how far they come down at the most for a hand or a foot to reach (m) */
const LOW = 0.316
export const lowest = ({ stand }: Size) => LOW * stand
export const squat = ({ stand }: Size) => (1 - LOW) * stand

/**
 * how far a step carries him standing, how much further for every pace he goes, and how much of that the first step
 * out of a stand carries him; and how far he flies between the strides of a run for every pace (in lengths of his leg)
 */
export const STRIDE = { least: 0.568, faster: 0.567, first: 0.5, flown: 0.434 }
/** how long his stride is at a walk, going so many of his paces (m) */
export const stride = ({ leg }: Size, fast: number) => (STRIDE.least + STRIDE.faster * fast) * leg
/**
 * sidestepping, the foot whose hip is ahead steps out so far, and so much further for every pace he goes (in lengths
 * of his leg), and the other up to it, at up to so many of his paces: as fast as his feet step
 */
export const SIDLE = { step: 0.4, faster: 0.6, most: 0.5 }
/** how far he steps out sidestepping, going so many of his paces (in lengths of his leg) */
export const sidle = (fast: number) => SIDLE.step + SIDLE.faster * fast

/** how far ahead of an ankle the hips ride at the most when they are this high: behind it, low, a shin leaning over its foot only as far as an ankle bends (m) */
export function overhang({ ankle, shin, thigh }: Size, hips: number) {
  const knee = hips - ankle - shin * Math.cos(ANKLE)
  return shin * Math.sin(ANKLE) - Math.sqrt(Math.max(0, thigh ** 2 - knee * knee))
}
/** how far behind his ankles the hips belong when they are this high (m) */
export const behind = (size: Size, hips: number) => Math.max(0, -overhang(size, hips))
/** how far on he comes to rest out of the air: where he lands, both feet braking him, going no faster than he walks, and else stepping on, a foot down half the time (m) */
export const lands = ({ pace }: Size, going: number) =>
  (going * Math.abs(going)) / ((Math.abs(going) > WALK.speed * pace ? 1 : 2) * PUSH.along)

/** how far he runs rather than walks, going so fast (m/s): from 0 to 1, about the fastest he walks */
export const runs = ({ pace }: Size, speed: number) => {
  const share = (Math.abs(speed) / (WALK.most * pace) - 0.85) / 0.3
  const eased = Math.min(1, Math.max(0, share))
  return eased * eased * (3 - 2 * eased)
}
/** led, how low the hips ride walking and running, and how far they rise and fall in a stride (in lengths of his leg): highest over a foot walking, lowest running */
const RIDES = { walk: RIDE, run: 0.09 }
const BOB = { walk: 0.018, run: -0.035 }
/** how much lower than they stand the hips ride, going so fast (m) */
export const dip = (size: Size, speed: number) => {
  const [ran, walks] = [runs(size, speed), Math.min(1, Math.abs(speed) / (WALK.speed * size.pace))]
  return (RIDES.walk * walks * (1 - ran) + RIDES.run * ran) * size.leg
}
/** how far the hips rise over a foot at the middle of its time on the ground, or fall, going so fast (m) */
export const bob = (size: Size, speed: number) => {
  const [ran, walks] = [runs(size, speed), Math.min(1, Math.abs(speed) / (WALK.speed * size.pace))]
  return (BOB.walk * walks * (1 - ran) + BOB.run * ran) * size.leg
}
/** how much narrower he runs than he walks, in shares of how far out a hip is */
const NARROW = 0.45
/** how far out from under the middle of the hips a foot stands, going so fast (m) */
export const wide = (size: Size, speed: number) => size.hip * (1 - NARROW * runs(size, speed))
/** how much of as far as a heel comes up it has come up by as its foot leaves the ground */
const TOES = 0.8
/**
 * how far ahead of the hips a straight leg reaches the ground going so fast, from as low as they ride as it comes
 * down, and how far behind, from as high, its foot on its toes as it leaves the ground (m)
 */
export const span = (size: Size, speed: number) => {
  const { stand, ankle, leg } = size
  const [low, high] = [-1, 1].map((by) => stand - dip(size, speed) + by * Math.abs(bob(size, speed)) - ankle)
  const reach = (up: number) => Math.sqrt(Math.max(0, leg ** 2 - up ** 2))
  const heel = raised(size, TOES * HEEL)
  return { ahead: reach(low), behind: reach(high - heel.y) + heel.z }
}
/** how far into a turn he leans at the most, as the tangent of the angle: his feet out from under his hips */
const LEAN = 0.5
/** how far he leans into a turn to his left along the way he goes, going so fast (m/s) round it so fast (rad/s): as the tangent of the angle, his weight over a foot the ground pushes round */
export const leant = (speed: number, curves: number) => clamp((speed * curves) / GRAVITY, -LEAN, LEAN)
