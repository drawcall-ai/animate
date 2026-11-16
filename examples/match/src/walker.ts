// A small locomotion planner, plain code. It owns the pelvis and the feet: the pelvis moves towards where it is
// asked to be, and the feet step to stay under it, one in the air at a time. A foot in the air is committed: its
// landing does not change. Others ask it for things explicitly: go there, turn so, plant this foot there by then.
// Everything is in the player's own frame (the net ahead at +z).

import { type Body, type Goal, ease, hard, soft, Target } from "@drawcall/ik"
import { type Object3D, Quaternion, Vector3 } from "three"

const Y = new Vector3(0, 1, 0)
const SPEED = 3.2 // m/s forwards and back, as fast as feet that never both leave the ground can carry the pelvis
const SIDE = 1.6 // m/s sideways: he faces the net and side-steps, and the feet must not cross
const ACCELERATION = 8 // m/s^2
const STEP = 0.16 // s a foot is in the air: quick short steps
const LEAD = 0.7 // of the stance that follows a landing, how much the pelvis still has ahead of it: the hip bends forward much further than back
const HEIGHT = 0.9 // m, the pelvis of a player on his toes with bent knees
type Side = "L" | "R"
interface Foot {
  S: Side
  sole: Object3D
  target: Target
  flat: Target
  at: Vector3
  yaw: number
  swing?: { from: Vector3; to: Vector3; yawFrom: number; yawTo: number; start: number; end: number; asked: boolean }
}

export function createWalker(body: Body, frame: Object3D) {
  const here = (o: Object3D) => frame.worldToLocal(body.positionOf(o))
  const pelvis = new Target()
  frame.add(pelvis)
  const feet: Foot[] = (["L", "R"] as const).map((S) => {
    const sole = body.get("sole" + S),
      target = new Target(),
      flat = new Target()
    frame.add(target, flat)
    return { S, sole, target, flat, at: here(sole).setY(0), yaw: 0 }
  })
  const ground = here(feet[0].sole).y
  const position = here(body.root).setY(0),
    velocity = new Vector3()
  const asked = new Map<Side, { position: Vector3; yaw: number; time: number }>()
  let last: Side = "R"

  return {
    /** Where the pelvis is over the ground, and how fast it moves. */
    position,
    velocity,
    feet,
    /** Ask for a foot to be planted at a place, turned so, by a time. It is done by that foot's next step in time, or dropped when the time has passed. */
    plant(S: Side, at: Vector3, yaw: number, time: number) {
      asked.set(S, { position: at.clone().setY(0), yaw, time })
    },
    /** Whether a foot stands where it was asked to (within 5 cm), or nothing was asked of it. */
    planted: (S: Side) => {
      const a = asked.get(S),
        f = feet.find((x) => x.S === S)!
      return !a || (!f.swing && f.at.distanceTo(a.position) < 0.05)
    },
    /** One frame: move the pelvis towards `goal` and turn it to `yaw`, step the feet, and return this frame's goals. */
    step(t: number, dt: number, goal: Vector3, yaw: number): Goal[] {
      const want = goal.clone().setY(0).sub(position).multiplyScalar(5)
      want.multiplyScalar(Math.min(1, SIDE / Math.abs(want.x || 1), SPEED / Math.abs(want.z || 1)))
      const heading = want.clone() // the velocity he is getting up to: the feet step for it at once
      velocity.add(want.sub(velocity).clampLength(0, ACCELERATION * dt))
      position.addScaledVector(velocity, dt)
      for (const [S, a] of asked) if (a.time < t - 0.3) asked.delete(S) // too late to matter

      for (const f of feet)
        if (f.swing && t >= f.swing.end) {
          // landed
          f.at.copy(f.swing.to)
          f.yaw = f.swing.yawTo
          if (f.swing.asked) asked.delete(f.S)
          f.swing = undefined
        }
      if (!feet.some((f) => f.swing)) {
        // both down: does one need to step?
        // Where the pelvis will be and how it will move when a step taken now lands; the foot belongs under it half-way through the stance that follows.
        const then = velocity.clone().add(
          heading
            .clone()
            .sub(velocity)
            .clampLength(0, ACCELERATION * STEP),
        )
        const under = position.clone().addScaledVector(velocity.clone().add(then), STEP / 2)
        const ideal = (f: Foot) =>
          under
            .clone()
            .addScaledVector(then, LEAD * STEP)
            .add(new Vector3((f.S === "L" ? 1 : -1) * Math.max(0.11, 0.06 + 0.5 * STEP * Math.abs(then.x)), 0, 0)) // side-stepping, the stance widens
        // a foot asked for is planted when its time has come, if the pelvis will be there to stand on it
        const due = (f: Foot) => {
          const a = asked.get(f.S)
          return a && a.time - t <= STEP + dt && f.at.distanceTo(a.position) > 0.03 && a.position.distanceTo(under) < 0.5 ? a : undefined
        }
        const off = (f: Foot) => f.at.distanceTo(ideal(f))
        const next = feet.find(due) ?? [...feet].sort((a, b) => off(b) - off(a) + (a.S === last ? 0.05 : -0.05))[0]
        const a = due(next)
        if (a || off(next) > 0.1) {
          next.swing = {
            from: next.at.clone(),
            to: a ? a.position : ideal(next),
            yawFrom: next.yaw,
            yawTo: a ? a.yaw : 0,
            start: t,
            end: a ? Math.max(t + 0.1, a.time) : t + STEP,
            asked: !!a,
          }
          last = next.S
        }
      }
      for (const f of feet) {
        const s = f.swing,
          x = s ? Math.min(1, (t - s.start) / (s.end - s.start)) : 0,
          e = ease(x)
        const at = s
          ? s.from
              .clone()
              .lerp(s.to, e)
              .setY(0.06 * Math.sin(Math.PI * x))
          : f.at.clone()
        f.target.set({ position: at.add(new Vector3(0, ground, 0)) })
        f.flat.set({ quaternion: new Quaternion().setFromAxisAngle(Y, s ? s.yawFrom + (s.yawTo - s.yawFrom) * e : f.yaw) })
      }
      const between = (feet[0].yaw + feet[1].yaw) / 2 // the pelvis turns no further from the feet than the hips allow
      pelvis.set({
        position: new Vector3(position.x, HEIGHT - 0.08 * Math.min(1, velocity.length() / SPEED), position.z),
        quaternion: new Quaternion().setFromAxisAngle(Y, Math.min(between + 0.35, Math.max(between - 0.35, yaw))),
      })
      // The feet are where the ground is: hard. The pelvis is a strong wish: if the legs cannot reach, it gives.
      // A foot lies flat and turned as asked if the ankle allows; a trailing foot comes up on its toes instead.
      return [...feet.map((f) => hard(f.sole, f.target)), soft(body.get("pelvis"), pelvis, 50), ...feet.map((f) => soft(f.sole, f.flat, 2))]
    },
  }
}
