// A tennis player: a body, a racket, a locomotion planner and a stroke planner, all plain code. Each frame the
// stroke planner looks at the ball where it really is, predicts it (bounce included), and
//   - picks the contact (a time on the frame grid after the bounce that he can be standing for, and the ball's
//     place then) and the stroke,
//   - asks the locomotion planner to stand for it (go there, plant these feet there by then),
//   - builds the swing from the racket's CURRENT state (position and velocity) so that the sweet spot is at the
//     ball, moving as intended, at the contact time.
// It replans every frame: the time and stroke until the swing starts, the path until its last 0.15 s; after
// that the swing is committed and left alone.
// Everything is in the player's own frame: he stands at negative z, the net is ahead at z = 0.

import { type Body, type Goal, type Pose, bump, createHumanoid, ease, hard, mark, posture, soft, Target, toward } from "@drawcall/ik"
import { Group, Matrix4, Quaternion, Vector3 } from "three"
import { type BallState, LENGTH, WIDTH, predict } from "./court"
import { createWalker } from "./walker"

const X = new Vector3(1, 0, 0),
  Y = new Vector3(0, 1, 0)
const V = (x: number, y: number, z: number) => new Vector3(x, y, z)
const turn = (axis: Vector3, angle: number) => new Quaternion().setFromAxisAngle(axis, angle)
const HOME = V(0, 0, -14.5) // where he waits: well behind the baseline (the ball keeps its pace through the bounce), in the middle
const HIP = 0.9 // the planned pelvis height
const READY = V(0, 0.1, 0.8) // where the sweet spot is held between strokes, from the racket's pivot: straight ahead of the hand
const SWING = 0.5 // s from the start of the swing to contact
const COMMIT = 0.15 // s before contact after which the swing is not replanned
const FOLLOW = 0.45 // s of follow-through
const REACH = 0.5 // racket: hand to sweet spot (m)
const RELAXED: Pose = {
  neck: [0, 0, 0],
  head: [0, 0, 0],
  shoulderL: [0, 0],
  upperArmL: [-0.2, 0.2, 0],
  forearmL: [-0.9, 0],
  handL: [0, 0],
  shoulderR: [0, 0],
  upperArmR: [0, 0, 0],
  forearmR: [-0.4, 0],
  handR: [0, 0],
}

/** A stroke, from the stance: where the ball is met, where the racket swings about, how the body turns, where the feet stand, where the swing ends. */
interface Stroke {
  name: "forehand" | "backhand"
  sign: 1 | -1
  contact: Vector3
  pivot: Vector3
  yaw: number
  feet: { R: Vector3; L: Vector3 }
  finish: Vector3
}
const FOREHAND: Stroke = {
  name: "forehand",
  sign: 1,
  contact: V(-1.0, 0, 0.4),
  pivot: V(-0.25, 0.25, 0.05),
  yaw: -0.5,
  feet: { R: V(-0.2, 0, -0.12), L: V(0.1, 0, 0.2) },
  finish: V(0.45, 0.6, 0.35),
}
const BACKHAND: Stroke = {
  name: "backhand",
  sign: -1,
  contact: V(0.8, 0, 0.6),
  pivot: V(0.15, 0.2, 0.15),
  yaw: 0.6,
  feet: { R: V(0.05, 0, 0.25), L: V(0.2, 0, -0.12) },
  finish: V(-0.55, 0.65, 0.4),
}

export interface Shot {
  id: number
  stroke: Stroke
  time: number
  contact: Vector3
  aim: Vector3
  late: boolean
  done: boolean
  frozen?: { curve: ReturnType<typeof toward>; since: number }
}
/** The ball as the match sees it: its physics state, whether it is this player's to hit, how often it has bounced on his side since it was hit, and which hit it is. */
export interface Incoming {
  state: BallState
  mine: boolean
  bounced: number
  id: number
}

export function createPlayer(facing: number, random: () => number) {
  const frame = new Group() // the player's own frame: turned to face the net
  frame.rotation.y = facing
  const body: Body = createHumanoid()
  frame.add(body.root)
  body.q[0] = HOME.x
  body.q[2] = HOME.z
  body.update()
  const racket = new Group()
  racket.name = "racket"
  racket.userData.mass = 0.3
  const sweet = mark(racket, "sweet", V(0, REACH, 0))
  body.attach(racket, mark(body.get("handR"), "hold", V(0, -0.08, 0), turn(X, 0.6).multiply(new Quaternion(0.5, 0.5, 0.5, 0.5))))
  const walker = createWalker(body, frame)
  const top = Object.assign(mark(racket, "top", V(0, 0.1, 0)), { userData: { given: { position: true } } }) // where the other hand holds it for a backhand
  const eyes = mark(body.get("head"), "eyes", V(0, 0.1, 0))
  const to = { sweet: new Target(), hand: new Target(), roll: new Target(), look: new Target() }
  frame.add(...Object.values(to))
  const local = (world: Vector3) => frame.worldToLocal(world.clone())
  const spin = (world: Vector3) => world.clone().applyAxisAngle(Y, -facing) // a direction or velocity into the player's frame
  let shot: Shot | undefined,
    side = 1 // which side the racket is held on, eased between strokes

  /**
   * Decide the shot for a ball that is his to hit: when and where to meet it, with which stroke, and where to send it.
   * Of all the moments after the bounce at which the ball is at a height he can swing at, he takes the one he can
   * be standing for in time with the least hurry, preferring waist height and the stroke he already chose.
   */
  const decide = (t: number, dt: number, ball: Incoming, state: BallState, before?: Shot): Shot | undefined => {
    const ahead = predict(state, 4)
    const land = ball.bounced ? 0 : ahead.bounces[0]?.time,
      second = ahead.bounces[ball.bounced ? 0 : 1]?.time ?? (land ?? 0) + 1.2
    const at = ball.bounced ? state.position : ahead.bounces[0]?.position
    if (land === undefined || !at || at.z > 0 || at.z < -LENGTH - 0.3 || Math.abs(at.x) > WIDTH + 0.3) return // not coming into his court: leave it
    let best: { time: number; stroke: Stroke; contact: Vector3 } | undefined,
      least = Infinity
    for (let k = Math.ceil((t + land + 0.05) / dt); k * dt < t + second - 0.04; k++) {
      // on the frame grid, so that a frame is solved exactly then
      const time = k * dt,
        contact = predict(state, time - t).position
      for (const stroke of [FOREHAND, BACKHAND]) {
        const go = contact.clone().sub(stroke.contact).setY(0).sub(walker.position),
          way = go.length()
        const hurry = Math.max(0, Math.max(Math.abs(go.x) / 1.5, Math.abs(go.z) / 3) + 0.5 - (time - t)) // s short of walking there and setting the feet
        const cost =
          10 * hurry +
          2 * Math.max(0, 0.6 - contact.y, contact.y - 1.35) +
          0.3 * Math.abs(contact.y - 1) +
          0.1 * way +
          (before && before.stroke !== stroke ? 0.3 : 0)
        if (cost < least) [best, least] = [{ time, stroke, contact }, cost]
      }
    }
    if (!best) return
    const aim = before?.aim ?? V((random() * 2 - 1) * 2.2, 0.033, 4.5 + 3 * random()) // somewhere in the other court
    return { id: ball.id, ...best, aim, late: best.time - t < SWING, done: false }
  }

  /** This frame's goals. `t` is the time of the pose being solved; the body is still in the pose of t - dt. */
  const plan = (t: number, dt: number, ball: Incoming): Goal[] => {
    const state = { position: local(ball.state.position), velocity: spin(ball.state.velocity) }
    // Replan every frame until the swing starts; from then on the time and the stroke stay.
    const mine = shot?.id === ball.id && !shot.done ? shot : undefined
    if (ball.mine && ball.bounced <= 1 && (!shot || shot.id !== ball.id || (mine && t < mine.time - SWING))) shot = decide(t, dt, ball, state, mine) ?? shot
    if (shot && t - shot.time > FOLLOW + 0.5) shot = undefined
    const playing = shot && !shot.done ? shot : undefined,
      since = shot ? t - shot.time : -9
    // Until the swing is committed, the contact follows the ball as it really flies (the bounce is never quite as predicted).
    if (playing && since < -COMMIT && shot!.id === ball.id) playing.contact = predict(state, playing.time - t).position

    // Feet and pelvis: ask the locomotion planner for the stance, explicitly.
    const stroke = shot?.stroke ?? FOREHAND,
      stance = shot ? shot.contact.clone().sub(stroke.contact).setY(0) : HOME
    const turned = shot ? stroke.yaw * (since < 0 ? ease((since + 0.9) / 0.5) : 1 - ease(since / 0.4)) : 0
    if (playing && since < -0.2) {
      // "this foot planted here, turned so, by then": the back foot first, then the front one
      const back = stroke.sign > 0 ? "R" : "L",
        front = stroke.sign > 0 ? "L" : "R"
      walker.plant(back, stance.clone().add(stroke.feet[back]), stroke.yaw, playing.time - 0.45)
      walker.plant(front, stance.clone().add(stroke.feet[front]), stroke.yaw, playing.time - 0.2)
    }
    const goals = walker.step(t, dt, since < FOLLOW ? stance : HOME, turned)

    // The racket: the sweet spot's path, from where it is and how it moves now.
    side += Math.min(1, Math.max(-1, stroke.sign - side)) * Math.min(1, 6 * dt)
    const hips = V(walker.position.x, HIP, walker.position.z)
    const pivot = hips.clone().add(FOREHAND.pivot.clone().lerp(BACKHAND.pivot, (1 - side) / 2))
    const now = local(body.positionOf(sweet)),
      moving = spin(body.velocityOf(sweet))
    const forward = shot ? shot.aim.clone().sub(shot.contact).setY(0).normalize() : V(0, 0, 1)
    let curve: ReturnType<typeof toward>,
      ahead = dt
    if (playing && since >= -SWING) {
      // the swing: to be at the ball, moving through it, at the contact time
      const through = forward
        .clone()
        .multiplyScalar(9)
        .add(V(0, 2.5, 0))
      if (!playing.frozen && since >= -COMMIT) playing.frozen = { curve: toward(now, moving, playing.contact, through, playing.time - t + dt), since: t - dt }
      curve = playing.frozen?.curve ?? toward(now, moving, playing.contact, through, playing.time - t + dt)
      if (playing.frozen) ahead = t - playing.frozen.since
    } else if (shot && since > 0 && since < FOLLOW)
      curve = toward(
        now,
        moving,
        hips
          .clone()
          .add(stroke.finish)
          .addScaledVector(walker.velocity, FOLLOW - since + dt),
        walker.velocity,
        FOLLOW - since + dt,
      )
    else curve = toward(now, moving, pivot.clone().add(READY).addScaledVector(walker.velocity, 0.3), walker.velocity, 0.3) // carried along with the pelvis
    const want = curve(ahead).position
    const out = want.clone().sub(pivot)
    out.setLength(Math.min(1.1, Math.max(0.75, out.length()))) // the racket swings about the pivot: no further than the arm reaches, no nearer than keeps the hand off the body
    const spot = pivot.clone().add(out),
      axis = out.clone().normalize()
    to.sweet.set({ position: spot, velocity: spot.clone().sub(now).divideScalar(dt).applyAxisAngle(Y, facing) }) // a target's velocity is in the world
    to.hand.set({ position: spot.clone().addScaledVector(axis, -REACH) })
    // its roll: the strings face the way the ball is to go (the palm side for a forehand, the back of the hand for a backhand)
    // Only around contact: elsewhere the strings have no business
    // facing the target and the arm holds the racket as it likes. Nor where the racket points along the shot.
    const z = forward.clone().multiplyScalar(stroke.sign)
    z.addScaledVector(axis, -z.dot(axis))
    const square = 30 * bump(since / 0.3) * ease((z.length() - 0.2) / 0.5)
    to.roll.set({ quaternion: new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3().crossVectors(axis, z.normalize()), axis, z)) })
    // the head turns to where the ball will be met, or to the ball
    const gaze = (playing ? playing.contact : state.position).clone().sub(local(body.positionOf(eyes)))
    to.look.set({ quaternion: new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(gaze, V(0, 0, 0), Y)) })
    const coil = -stroke.sign * (shot ? 0.5 * bump((since + 0.3) / 0.45) - 0.35 * bump((since - 0.2) / 0.3) : 0) // the trunk winds up, then through
    // The hand's place shapes the swing's arc; between strokes the arm carries the racket as it likes (lower, elbow down).
    const swinging = shot ? ease((since + SWING + 0.2) / 0.2) * (1 - ease((since - FOLLOW) / 0.3)) : 0
    return [
      ...goals,
      hard(sweet, to.sweet),
      soft(racket, to.hand, 20 * swinging),
      soft(racket, to.roll, square),
      posture(body, { spine: [0.06, coil / 2, 0], chest: [0.06, coil / 2, 0] }, 3),
      posture(body, RELAXED, 0.2),
      soft(body.get("head"), to.look, 0.05),
      { joints: body.q.slice(), weights: body.q.map((_, k) => (k < 6 ? 0 : 1)), weight: 1 }, // stay near the pose he is in: no joint turns far in a frame without need
      soft(body.get("palmL"), top, 40 * ((1 - side) / 2) ** 2), // a backhand is played with both hands: a goal between two points of the body
    ]
  }

  return {
    frame,
    body,
    racket,
    sweet,
    walker,
    plan,
    /** The names of the goals `plan` returns, in order. */
    names: [
      "foot L",
      "foot R",
      "pelvis (soft)",
      "foot L flat (soft)",
      "foot R flat (soft)",
      "sweet spot",
      "racket hand (soft)",
      "racket roll (soft)",
      "trunk (soft)",
      "relaxed (soft)",
      "head (soft)",
      "calm (soft)",
      "off hand on racket (soft)",
    ],
    /** The shot being played, if any. */
    get shot() {
      return shot
    },
    /** Where he means the ball to land, in the world. */
    aim: () => (shot ? frame.localToWorld(shot.aim.clone()) : new Vector3()),
    /** How far his pelvis is from where the stroke wanted it. */
    offStance: () => (shot ? walker.position.distanceTo(shot.contact.clone().sub(shot.stroke.contact).setY(0)) : 0),
  }
}
export type Player = ReturnType<typeof createPlayer>
