// SOLVER: one pose per frame from this frame's goals. No memory of targets, no smoothing, no interpolation: the
// only state is the pose (body.angles), used as the Newton seed.
//
// Method: prioritized whole-body IK as Newton's method on ONE objective,
//     F(q) = HARD * f_hard(q) + f_soft(q),   f = 1/2 sum w |b - a(q)|^2,   HARD = 1e6,
// f_soft also holding each `clear` goal's one-sided penalty,
// iterated to convergence inside the frame, then projected exactly onto the hard goals (two damped Gauss-Newton
// steps on f_hard alone), which removes the O(1/HARD) residual of the weighting. The Hessian is J^T W J plus the
// second-order ("geometric") terms: for soft goals weighted by their residual, for hard goals by the force they
// carry (see hardCurvature). Those terms are what plain damped least squares with null-space projection lacks: an
// unreachable hard goal leaves a residual, and directions that look free to first order (bending a fully stretched
// arm) are in fact stiff. Without them soft goals leak into such directions and the pose chatters.
// Joint limits: an active set (a joint on a limit that the step pushes outward is locked, and released again when
// the model wants it back inside).

import { MathUtils, type Object3D, Quaternion, Vector3 } from "three"
import { type Body } from "./body"
import { type Given, type Goal, hard as hardGoal, Target } from "./goals"
import { cholSolve, cholesky } from "./linalg"

export interface SolveOptions {
  /** Newton iteration cap (default 40). 0 = do not move, only evaluate the goals at the current pose. */
  maxIterations?: number
  /** Converged when no joint moves more than this in an iteration (rad, or m for the root's slides). */
  tolerance?: number
}
export interface GoalResult {
  /** How far the goal is from met: its largest residual (m for position and velocity over the time step, rad for rotation and angles; for a posture its largest joint deviation, which says little). */
  missedBy: number
  /** Whether it is met (missed by no more than a micrometre or microradian). A hard goal that is not was out of reach: the pose is the closest. */
  met: boolean
}
export interface SolveResult {
  iterations: number
  converged: boolean
  /** One per goal, in the order given. */
  goals: GoalResult[]
  /** The most any hard goal given is missed by (m or rad): 0 when all are met exactly, more when one is out of reach. */
  hardMissedBy: number
  /** The most any loop closed by `body.attach` (an object held in two places) is missed by (m or rad). */
  loopsMissedBy: number
  /** Joints sitting on a limit, e.g. 'upperArmR.1'. Many of them usually means the goals ask for something awkward. */
  jointsAtLimit: string[]
}

const HARD = 1e6 // weight of the hard level over the soft level
const REACH = 1e-6 // (m or rad)^2: hard directions the joints move less than this count as unreachable
const MET = 1e-6 // m or rad: a goal missed by no more than this is met
const MAX_STEP = 0.4 // per-iteration clamp on any joint change (rad or m)
const SNAP = 1e-3 // a joint this close to a limit, and pushed beyond it, is put on the limit and locked
const EASE = 0.01 // m: how deep into a `clear` goal's capsule its push takes to grow to full strength (pushed at full strength from the surface, Newton cycles across it)

interface Level {
  G: Float64Array
  S: Float64Array
  g: Float64Array
}
interface Work {
  n: number
  hard: Level
  soft: Level
  J: Float64Array
  H: Float64Array
  A: Float64Array
  g: Float64Array
  dq: Float64Array
}
let work: Work | undefined // scratch memory only; nothing in here survives a solve() semantically

function workspace(n: number): Work {
  if (work?.n === n) return work
  const level = (): Level => ({ G: new Float64Array(n * n), S: new Float64Array(n * n), g: new Float64Array(n) })
  return (work = {
    n,
    hard: level(),
    soft: level(),
    J: new Float64Array(3 * n),
    H: new Float64Array(n * n),
    A: new Float64Array(n * n),
    g: new Float64Array(n),
    dq: new Float64Array(n),
  })
}

/** out = chol(H + shift I), with locked joints replaced by identity rows/columns. */
function factor(H: Float64Array, shift: number, lock: Uint8Array, out: Float64Array, n: number): boolean {
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) out[i * n + j] = lock[i] || lock[j] ? (i === j ? 1 : 0) : H[i * n + j] + (i === j ? shift : 0)
  return cholesky(out, n)
}

/** Rotation vector (axis * angle, shortest arc) of a unit quaternion. */
function rotationVector(q: Quaternion): Vector3 {
  const sign = q.w < 0 ? -1 : 1,
    s = Math.hypot(q.x, q.y, q.z)
  const k = s < 1e-12 ? 2 * sign : (2 * Math.atan2(s, sign * q.w) * sign) / s
  return new Vector3(q.x * k, q.y * k, q.z * k)
}

const ZERO = new Vector3(),
  ONE = new Vector3(1, 1, 1),
  FRAME: Given = { position: true, quaternion: true }
type Curvature = (r: Vector3, S: Float64Array) => void

/** A point as an error names it: by its name, or for an unnamed one, by what it hangs from and where it is. */
function describe(point: Object3D): string {
  if (point.name) return `'${point.name}'`
  const at = point
    .getWorldPosition(new Vector3())
    .toArray()
    .map((v) => v.toFixed(2))
  const parent = point.parent?.name ? ` on '${point.parent.name}'` : ""
  return `an unnamed ${point.type}${parent} at (${at.join(", ")}) in the world`
}

/**
 * Solves this frame: writes the pose that meets the hard goals exactly (or as closely as reachable) and the soft
 * goals as well as possible. `dt` is the frame's time step: velocities are met, and reported by `body.velocityOf`,
 * as differences against the pose the body had before this call.
 */
export function solve(body: Body, goals: Goal[], dt = 0, opts: SolveOptions = {}): SolveResult {
  const n = body.angles.length,
    q = body.angles
  const { hard, soft, J, H, A, g, dq } = workspace(n)
  const lock = new Uint8Array(n)
  // Loops are hard goals like any other: the object's seat frame must coincide with the point on the body.
  const tasks = [...body.loops.map((c) => hardGoal(c.seat, c.point)), ...goals]
  const taken = new Set<Object3D>()
  for (const goal of tasks)
    if ("point" in goal && goal.hard) {
      if (taken.has(goal.point)) throw new Error(`two hard goals on the same point, ${describe(goal.point)}, in one solve`)
      taken.add(goal.point)
    }
  if (opts.maxIterations !== 0) {
    body.before = q.slice()
    body.dt = dt
  }
  body.limits()
  body.update()
  const seed = tasks.map((goal) => ("point" in goal ? body.matrixPosition(goal.point) : ZERO)) // where each point was before the solve, for velocities
  // Hard 3-row blocks at the current iterate: Jacobian and error, and a function that adds the Hessian of (r . e) to S.
  let blocks: { J: Float64Array; e: Vector3; curvature: Curvature }[] = []

  /** Jacobian columns (into J) and curvature (into S) of the world position x of a point riding on `object`. */
  const pointTerms = (object: Object3D, x: Vector3, s: number, r: Vector3, S: Float64Array) => {
    const chain = body.chain(object),
      c = new Vector3(),
      d = new Vector3()
    for (let bi = 0; bi < chain.length; bi++) {
      const j = chain[bi]
      if (body.slide[j]) c.copy(body.axis[j])
      else c.subVectors(x, body.origin[j]).cross(body.axis[j]).negate()
      J[j] += s * c.x
      J[n + j] += s * c.y
      J[2 * n + j] += s * c.z
      if (body.slide[j]) continue
      for (let ai = 0; ai <= bi; ai++) {
        // d2x/dqi dqj = a_i x (a_j x (x - o_j)) for i at or above j
        const i = chain[ai]
        if (body.slide[i]) continue
        const v = -s * r.dot(d.crossVectors(body.axis[i], c))
        S[i * n + j] += v
        if (i !== j) S[j * n + i] += v
      }
    }
  }
  /** Position terms of any point: the center of mass is the mass-weighted mean of everything on the body. */
  const placeTerms = (point: Object3D, x: Vector3, s: number, r: Vector3, S: Float64Array) => {
    if (point === body.centerOfMass) for (const [o, mass, at] of body.masses()) pointTerms(o, at, (s * mass) / body.mass, r, S)
    else pointTerms(point, x, s, r, S)
  }
  /** L.G += J^T diag(w) J, L.g += J^T diag(w) e. */
  const accumulate = (L: Level, e: Vector3, w: Vector3) => {
    for (let r = 0; r < 3; r++) {
      const wr = w.getComponent(r),
        er = e.getComponent(r)
      if (!wr) continue
      for (let i = 0; i < n; i++) {
        const wj = wr * J[r * n + i]
        if (!wj) continue
        L.g[i] += wj * er
        for (let k = 0; k < n; k++) L.G[i * n + k] += wj * J[r * n + k]
      }
    }
  }
  /** One 3-row block of a goal: error e, weights w per row, and the terms that fill J (and S for a force r). */
  const block = (L: Level, e: Vector3, w: Vector3, terms: Curvature) => {
    terms(L === hard ? ZERO : e.clone().multiply(w), L.S)
    accumulate(L, e, w)
    if (L === hard) blocks.push({ J: J.map((v, i) => (w.getComponent(Math.floor(i / n)) ? v : 0)), e: e.clone().multiply(w), curvature: terms })
    return Math.hypot(w.x && e.x, w.y && e.y, w.z && e.z)
  }

  /** Evaluate every goal at the current pose: fill both levels, return how far each is from met. */
  const assemble = (): number[] => {
    for (const L of [hard, soft]) {
      L.G.fill(0)
      L.S.fill(0)
      L.g.fill(0)
    }
    blocks = []
    return tasks.map((goal, ti) => {
      let missed = 0
      if ("angles" in goal) {
        // a posture (the floating base has none)
        for (let k = body.chain(body.root).length; k < n; k++) {
          const wk = goal.weight * goal.weights[k],
            d = goal.angles[k] - q[k]
          soft.G[k * n + k] += wk
          soft.g[k] += wk * d
          if (goal.weights[k] === 1) missed = Math.max(missed, Math.abs(d))
        }
        return missed
      }
      if ("radius" in goal) {
        // a `clear` goal: one row, along the way out from the capsule's axis, while the point is inside
        const p = body.matrixPosition(goal.point),
          a = body.matrixPosition(goal.from),
          b = body.matrixPosition(goal.to),
          axis = b.clone().sub(a)
        const t = axis.lengthSq() ? MathUtils.clamp(p.clone().sub(a).dot(axis) / axis.lengthSq(), 0, 1) : 0,
          out = p.clone().sub(a).addScaledVector(axis, -t),
          depth = goal.radius - out.length()
        if (depth <= 0) return 0
        out.normalize() // zero on the axis itself, where no way out is nearer than another: no push
        // A penalty that grows from nothing at the surface (w depth^3 / 6 EASE) into the usual quadratic one, as a row
        // scaled by `slope` with residual `push`, and a Gauss-Newton Hessian: the curvature of the distance to the axis
        // would be negative, and unbounded near the axis.
        const slope = Math.sqrt(Math.min(1, depth / EASE)),
          push = depth < EASE ? (depth * slope) / 2 : depth - EASE / 2
        block(soft, out.clone().multiplyScalar(push), new Vector3().setScalar(goal.weight), (_r, S) => {
          J.fill(0)
          placeTerms(goal.point, p, 1, ZERO, S)
          placeTerms(goal.from, a, t - 1, ZERO, S)
          placeTerms(goal.to, b, -t, ZERO, S)
          for (let k = 0; k < n; k++) {
            const along = slope * (out.x * J[k] + out.y * J[n + k] + out.z * J[2 * n + k]) // sliding along the surface is free
            J[k] = out.x * along
            J[n + k] = out.y * along
            J[2 * n + k] = out.z * along
          }
        })
        return depth
      }
      const { point: a, target: b } = goal,
        L = goal.hard ? hard : soft
      const given: Given = ti < body.loops.length || !(b instanceof Target) ? FRAME : b.given // a seat is a whole frame
      const w = (given.axisWeights ?? ONE).clone().multiplyScalar(goal.hard ? 1 : goal.weight)
      const pa = body.matrixPosition(a),
        pb = body.matrixPosition(b)
      if (given.position)
        missed = Math.max(
          missed,
          block(L, pb.clone().sub(pa), w, (r, S) => {
            J.fill(0)
            placeTerms(a, pa, 1, r, S)
            placeTerms(b, pb, -1, r, S)
          }),
        )
      if (given.velocity && dt) {
        // a(q) = where a was before the solve + velocity * dt
        const e = seed[ti].clone().addScaledVector(given.velocity, dt).sub(pa)
        missed = Math.max(
          missed,
          block(L, e, w, (r, S) => {
            J.fill(0)
            placeTerms(a, pa, 1, r, S)
          }),
        )
      }
      if (given.quaternion) {
        const E = body.matrixQuaternion(b).multiply(body.matrixQuaternion(a).invert()),
          e = rotationVector(E)
        // Jacobian columns, ordered as one serial chain from a up to the joint the two points share and down to b:
        // what is above that joint moves both alike.
        const ca = body.chain(a),
          cb = body.chain(b),
          cols: [number, Vector3][] = []
        let s = 0
        while (s < ca.length && ca[s] === cb[s]) s++
        for (let i = s; i < ca.length; i++) if (!body.slide[ca[i]]) cols.push([ca[i], body.axis[ca[i]].clone().applyQuaternion(E)])
        for (let i = cb.length - 1; i >= s; i--) if (!body.slide[cb[i]]) cols.push([cb[i], body.axis[cb[i]].clone().negate()])
        const ww = new Vector3().setScalar(goal.hard ? 1 : goal.weight)
        missed = Math.max(
          missed,
          block(L, e, ww, (r, S) => {
            const x = new Vector3()
            J.fill(0)
            cols.forEach(([k, c], bi) => {
              J[k] += c.x
              J[n + k] += c.y
              J[2 * n + k] += c.z
              for (let i = 0; i < bi; i++) {
                // second-order term of composing two rotations: 1/2 (c_i x c_k)
                const v = -0.5 * r.dot(x.crossVectors(cols[i][1], c)),
                  ki = cols[i][0]
                S[ki * n + k] += v
                S[k * n + ki] += v
              }
            })
          }),
        )
      }
      return missed
    })
  }

  /**
   * Curvature of the hard goals, sum(r_i * Hessian(e_i)), added to H. r is the force each goal carries at the
   * solution: HARD * (the part of its residual no joint motion can remove) + the force with which the soft goals
   * lean on it (least-squares multipliers of J^T y = -g_soft). Both come from one small solve,
   * r = (J J^T + D)^-1 (HARD D e - J g_soft), D diagonal. Using HARD * e directly (the plain Hessian of F) is only
   * right at the solution and makes Newton erratic on the way there; this is the usual SQP remedy.
   */
  const hardCurvature = () => {
    const m = 3 * blocks.length,
      B = new Float64Array(m * m),
      r = new Float64Array(m)
    for (let a = 0; a < m; a++) {
      const ba = blocks[Math.floor(a / 3)],
        oa = (a % 3) * n
      const d = REACH + ba.e.lengthSq() // a goal with a large error is presumed unreachable until the error shrinks
      r[a] = HARD * d * ba.e.getComponent(a % 3)
      for (let k = 0; k < n; k++) if (!lock[k]) r[a] -= ba.J[oa + k] * soft.g[k]
      for (let b = 0; b <= a; b++) {
        const bb = blocks[Math.floor(b / 3)],
          ob = (b % 3) * n
        let v = a === b ? d : 0
        for (let k = 0; k < n; k++) if (!lock[k]) v += ba.J[oa + k] * bb.J[ob + k]
        B[a * m + b] = v
      }
    }
    cholesky(B, m)
    cholSolve(B, m, r)
    blocks.forEach((b, i) => b.curvature(new Vector3(r[3 * i], r[3 * i + 1], r[3 * i + 2]), H))
  }

  /**
   * One Newton step on F = HARD * f_hard + f_soft, or (project = true) one damped Gauss-Newton step on f_hard
   * alone that keeps the current joint-limit locks, from the pose the body was last updated to. Updates it to the pose
   * it steps to and returns the largest joint change.
   */
  const step = (project: boolean): number => {
    assemble()
    for (let k = 0; k < n; k++) g[k] = project ? hard.g[k] : HARD * hard.g[k] + soft.g[k]
    // Joint limits as an active set kept from step to step: a joint on (or within SNAP of) a limit that the step
    // would push beyond it is locked on the limit; a locked joint is released (once per step) when the model says
    // it wants to move back inside. The step is recomputed on every change.
    const released = new Uint8Array(n)
    for (;;) {
      let scaleH = 0
      for (let i = 0; i < n * n; i++) H[i] = project ? hard.G[i] : HARD * hard.G[i] + soft.G[i] + soft.S[i]
      if (!project) hardCurvature()
      for (let k = 0; k < n; k++) {
        dq[k] = lock[k] ? 0 : g[k]
        scaleH = Math.max(scaleH, Math.abs(H[k * n + k]))
      }
      // Projection: damped by the largest hard residual, so it does nothing when a goal is unreachable.
      let lambda = project ? REACH + blocks.reduce((a, b) => Math.max(a, b.e.lengthSq()), 0) : 0
      while (!factor(H, lambda, lock, A, n)) lambda = Math.max(10 * lambda, 1e-9 * scaleH, 1e-12) // not positive definite: damp (by something even where no goal moves anything)
      cholSolve(A, n, dq)
      if (project) break
      let changed = false,
        worst = 1e-9,
        free = -1
      for (let i = 0; i < n; i++) {
        const room = dq[i] > 0 ? body.max[i] - q[i] : q[i] - body.min[i]
        if (lock[i] || room > SNAP || Math.abs(dq[i]) <= room) continue
        q[i] = dq[i] > 0 ? body.max[i] : body.min[i]
        lock[i] = 1
        changed = true
      }
      if (changed) continue
      for (let i = 0; i < n; i++) {
        if (!lock[i] || released[i]) continue
        let pull = g[i] // the model's descent direction for this joint, given the step of the others
        for (let k = 0; k < n; k++) pull -= H[i * n + k] * dq[k]
        const inward = q[i] >= body.max[i] ? -pull : pull
        if (inward > worst) {
          worst = inward
          free = i
        }
      }
      if (free < 0) break
      lock[free] = 0
      released[free] = 1
    }
    // Scale the step: bounded size, and no joint may cross a limit (the first to arrive lands on it and is handled
    // by the active set from the next step on).
    let k = 1,
      moved = 0
    for (let i = 0; i < n; i++) {
      const d = Math.abs(dq[i]),
        room = dq[i] > 0 ? body.max[i] - q[i] : q[i] - body.min[i]
      if (d > MAX_STEP) k = Math.min(k, MAX_STEP / d)
      if (d > room) k = Math.min(k, room / d)
    }
    for (let i = 0; i < n; i++) {
      const next = Math.min(body.max[i], Math.max(body.min[i], q[i] + k * dq[i]))
      moved = Math.max(moved, Math.abs(next - q[i]))
      q[i] = next
    }
    body.update()
    return moved
  }

  const maxIter = opts.maxIterations ?? 40,
    tol = opts.tolerance ?? 1e-7
  let iterations = 0,
    converged = false
  while (iterations < maxIter && !converged) {
    iterations++
    converged = step(false) < tol
  }
  if (maxIter > 0) for (let i = 0; i < 2; i++) step(true) // exact projection onto the hard goals

  const missed = assemble(),
    loops = body.loops.length
  const jointsAtLimit: string[] = []
  for (let k = 0; k < n; k++) if (body.min[k] < body.max[k] && (q[k] <= body.min[k] || q[k] >= body.max[k])) jointsAtLimit.push(body.angleName(k))
  return {
    iterations,
    converged,
    jointsAtLimit,
    goals: missed.slice(loops).map((missedBy) => ({ missedBy, met: missedBy <= MET })),
    hardMissedBy: Math.max(0, ...goals.map((goal, i) => ("point" in goal && goal.hard ? missed[loops + i] : 0))),
    loopsMissedBy: Math.max(0, ...missed.slice(0, loops)),
  }
}
