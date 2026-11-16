import { bends, bent, DOWN, type Limb, RANGE, UP } from '@drawcall/limbs'
import { Euler, Quaternion, Vector3 } from 'three'

/** how far either way from the swing it had an elbow swung into the trunk is looked at to swing out, how far it swings a step at the most (rad); and what moving it costs against a wrist turned past its range */
const SWIVEL = { most: 1.2, fine: 0.1, moved: 0.3 }
const euler = new Euler()
const FULL = 2 * Math.PI
/** how far past where it shuts an elbow still folds, pressed (rad) */
const PAST = 0.07
const turned = new Quaternion()

/** a joint turned as near so as it turns */
const within = (value: Vector3, range: Partial<Record<'x' | 'y' | 'z', readonly number[]>>) => {
  for (const axis of ['x', 'y', 'z'] as const) {
    const [least, most] = range[axis] ?? [-Infinity, Infinity]
    value[axis] = Math.min(most, Math.max(least, value[axis]))
  }
  return value
}

/**
 * a turn of an upper arm read the way that keeps within its range, and nearest how it is turned now: the same way to
 * point reads a full turn apart, and also turned half round about each of its axes
 */
function read(turn: Vector3, was: Vector3) {
  const now = [was.x, was.y, was.z].every(Number.isFinite) ? was : new Vector3()
  const near = (angle: number, to: number) => angle - FULL * Math.round((angle - to) / FULL)
  const ways = [turn.clone(), new Vector3(turn.x + Math.PI, Math.PI - turn.y, turn.z + Math.PI)].map((way) => way.set(near(way.x, now.x), near(way.y, now.y), near(way.z, now.z)))
  const cost = (way: Vector3) => 10 * beyond(way, RANGE.arm) + way.distanceTo(now)
  return cost(ways[0]) <= cost(ways[1]) ? ways[0] : ways[1]
}

/** how far a turn is past a range, summed over its axes (rad) */
const beyond = (value: Vector3, range: Partial<Record<'x' | 'y' | 'z', readonly number[]>>) =>
  (['x', 'y', 'z'] as const).reduce((sum, axis) => {
    const [least, most] = range[axis] ?? [-Infinity, Infinity]
    return sum + Math.max(0, least - value[axis], value[axis] - most)
  }, 0)

/**
 * How an arm turns for its wrist to be at a place and its hand turned so, from its shoulder on a trunk turned so: its
 * elbow swung out or in from the swing it had as little as keeps it clear of the trunk and lets the wrist turn the
 * hand as near so as it turns, so it never jumps between two ways of reaching the same place. Every joint as near as
 * it turns.
 */
export function reachArm(arm: Limb, shoulder: Vector3, trunk: Quaternion, wrist: Vector3, turn: Quaternion, swivel: number, part?: Vector3, held = false) {
  const hand = arm.hand!
  // (sent with a part of the hand, `wrist` is where that part is to be, however the wrist turns the hand: tried until it holds)
  if (part) {
    const tip = wrist.clone()
    let at = part.clone().applyQuaternion(turn).negate().add(tip)
    // (the elbow swung as the first try has it, for the tries to come to one pose)
    const swung = reachArm(arm, shoulder, trunk, at, turn, swivel).swivel
    for (let k = 0, moved = 1; k < 30 && moved > 1e-4; k++) {
      const posed = reachArm(arm, shoulder, trunk, at, turn, swung, undefined, true)
      const forearm = trunk.clone().multiply(turned.setFromEuler(euler.setFromVector3(posed.first))).multiply(new Quaternion().setFromEuler(euler.set(posed.fold, 0, 0)))
      const lies = bent(forearm, posed.wrist, new Quaternion())
      // (halfway each try: a wrist at its stop can have it go to and fro)
      const next = tip.clone().sub(part.clone().applyQuaternion(lies)).lerp(at, k > 4 ? 0.5 : 0)
      moved = next.distanceTo(at)
      at = next
    }
    return reachArm(arm, shoulder, trunk, at, turn, swung, undefined, true)
  }
  const to = wrist.clone().sub(shoulder).applyQuaternion(trunk.clone().invert())
  const palm = hand.palm.clone().applyQuaternion(turn)
  const pointing = DOWN.clone().applyQuaternion(turn)
  const pose = (swinging: number) => {
    // (an elbow swings out or in so far from hanging under the arm at the most)
    const swung = Math.max(-SWIVEL.most, Math.min(SWIVEL.most, swinging))
    const { first, fold } = arm.reach(to, swung)
    const asked = read(first, arm.first.value)
    // (what a joint cannot turn to costs: the hand comes short by it)
    const stopped = beyond(asked, RANGE.arm) + Math.max(0, RANGE.forearm.x[0] - PAST - fold, fold)
    const upper = within(asked, RANGE.arm)
    const elbow = Math.min(0, Math.max(RANGE.forearm.x[0] - PAST, fold))
    const forearm = trunk.clone().multiply(turned.setFromEuler(euler.setFromVector3(upper))).multiply(new Quaternion().setFromEuler(euler.set(elbow, 0, 0)))
    const wrist = bends(forearm, hand.palm, palm, pointing)
    // (a hand that cannot be turned so at all is turned as it hangs)
    const bent = wrist && [wrist.x, wrist.y, wrist.z].every(Number.isFinite) ? wrist : new Vector3()
    const cost = 10 * stopped + beyond(bent, RANGE.wrist) + (arm.inside(upper, elbow) ? 10 : 0) + SWIVEL.moved * Math.abs(swung - swivel)
    return { first: upper, fold: elbow, wrist: within(bent, RANGE.wrist), swivel: swung, cost }
  }
  // (it swings on from the swing it had, a little either way a step; only an arm in the trunk looks further)
  let best = pose(swivel)
  for (const by of held ? [] : [-3, -1, 1, 3].map((k) => k * SWIVEL.fine)) {
    const tried = pose(swivel + by)
    if (tried.cost < best.cost - 1e-6) best = tried
  }
  for (let by = -SWIVEL.most; best.cost >= 10 && by <= SWIVEL.most + 1e-9; by += SWIVEL.fine) {
    const tried = pose(swivel + by)
    if (tried.cost < best.cost - 1e-6) best = tried
  }
  // (and with no swing of the elbow that keeps it out of the trunk, the arm is held off it as little as clears it)
  if (arm.inside(best.first, best.fold)) arm.off(best.first, best.fold)
  return best
}

/** How a leg turns for its ankle to be at a place, from its hip, the leg facing as its foot points (rad about y) */
export function reachLeg(leg: Limb, hip: Vector3, toes: number, ankle: Vector3) {
  const { first, fold } = leg.reach(ankle.clone().sub(hip).applyAxisAngle(UP, -toes))
  return { first: within(first.clone(), RANGE.thigh), fold: Math.min(RANGE.shin.x[1], Math.max(RANGE.shin.x[0], fold)) }
}

/**
 * how far round `axis` behind a place `out` from where a limb starts it can be drawn back, in the frame of the trunk,
 * no joint at its stop (rad): as far as the limb's own solve reaches
 */
export function room(limb: Limb, out: Vector3, axis: Vector3) {
  // (a turn is within its range if any way of reading it is: a full turn apart, or turned half round about each axis)
  const within = (turn: Vector3, range: Partial<Record<'x' | 'y' | 'z', readonly number[]>>) =>
    [turn, new Vector3(turn.x + Math.PI, Math.PI - turn.y, turn.z + Math.PI)].some((way) =>
      [-FULL, 0, FULL].some((x) => [-FULL, 0, FULL].some((z) => beyond(way.clone().add(new Vector3(x, 0, z)), range) < 1e-3)),
    )
  const reaches = (to: Vector3) => (limb.hand ? [-0.6, 0, 0.6].some((swivel) => within(limb.reach(to, swivel).first.clone(), RANGE.arm)) : within(limb.reach(to).first.clone(), RANGE.thigh))
  let back = 0
  while (back < 1.5 * Math.PI && reaches(out.clone().applyAxisAngle(axis, -(back + SWIVEL.fine)))) back += SWIVEL.fine
  return back
}
