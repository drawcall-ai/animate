// A tennis player's planner: a body, a racket, a locomotion planner and the strokes, all plain code. Each frame it looks
// at the ball where it really is, predicts it (bounce included), and
//   - picks the contact (a time on the frame grid after the bounce that he can be standing for, and the ball's
//     place then) and the stroke,
//   - asks the locomotion planner to stand for it (go there, plant these feet there by then),
//   - builds the swing from the racket's CURRENT state (position and velocity) so that the sweet spot is at the
//     ball, moving as intended, at the contact time.
// It replans every frame: the time and stroke until the swing starts, the path until its last 0.15 s; after
// that the swing is committed and left alone.
// Everything is in the player's own frame: he stands at negative z, the net is ahead at z = 0.

import { createRacket, GRIPS, REACH } from "@drawcall/example-stage/racket"
import {
  bump,
  curveTo,
  type Goal,
  grip,
  HandPose,
  Humanoid,
  hard,
  LocomotionPlanner,
  mark,
  mix,
  type Pose,
  posture,
  soft,
  type Side,
  stay,
  Target,
} from "@drawcall/animate"
import { Group, MathUtils, Matrix4, type Object3D, Quaternion, Vector3 } from "three"
import { type BallState, LENGTH, WIDTH, predict } from "./court"

const { smoothstep } = MathUtils
const Y = new Vector3(0, 1, 0)
const V = (x: number, y: number, z: number) => new Vector3(x, y, z)
const HOME = V(0, 0, -14.5) // where he waits: well behind the baseline (the ball keeps its pace through the bounce), in the middle
const HIP = 0.9 // the planned pelvis height
const SPEED = 3.2 // m/s forwards and back
const SIDE = 1.6 // m/s sideways: he faces the net and side-steps
const ACCELERATION = 8 // m/s^2
const READY = V(0, 0.1, 0.8) // where the sweet spot is held between strokes, from the racket's pivot: straight ahead of the hand
const SWING = 0.5 // s from the start of the swing to contact
const COMMIT = 0.15 // s before contact after which the swing is not replanned
const FOLLOW = 0.45 // s of follow-through
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
  feet: Record<Side, Vector3>
  finish: Vector3
}
const FOREHAND: Stroke = {
  name: "forehand",
  sign: 1,
  contact: V(-1.0, 0, 0.4),
  pivot: V(-0.25, 0.25, 0.05),
  yaw: -0.5,
  feet: { right: V(-0.2, 0, -0.12), left: V(0.1, 0, 0.2) },
  finish: V(0.45, 0.6, 0.35),
}
const BACKHAND: Stroke = {
  name: "backhand",
  sign: -1,
  contact: V(0.8, 0, 0.6),
  pivot: V(0.15, 0.2, 0.15),
  yaw: 0.6,
  feet: { right: V(0.05, 0, 0.25), left: V(0.2, 0, -0.12) },
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
  frozen?: { curve: ReturnType<typeof curveTo>; since: number }
}
/** The ball as the match sees it: its physics state, whether it is this player's to hit, how often it has bounced on his side since it was hit, and which hit it is. */
export interface Incoming {
  state: BallState
  mine: boolean
  bounced: number
  id: number
}

/** A player and his planner, facing the net from his own frame turned by `facing`; `rigged` is the rigged tennis player
 * at rest, whom he plays as. */
export function createPlayerPlanner(facing: number, random: () => number, rigged: Object3D) {
  const frame = new Group() // the player's own frame: turned to face the net
  frame.rotation.y = facing
  const body = new Humanoid({ rig: rigged, position: HOME })
  const { hands } = body
  frame.add(body.root, rigged)
  const { racket, sweet } = createRacket()
  // The right hand takes hold once and the racket hangs from it there. The left one's grip is found too: in a backhand
  // its hand goes to that place on the handle, its fingers closing as it gets there, and takes hold once it is there;
  // it lets go as the racket goes back to the right hand alone.
  const left = grip(hands.left, racket, GRIPS.left)
  const right = body.hold("right", racket, GRIPS.right)
  const seatL = mark(racket, "seatL", left.position, left.quaternion)
  let holdingL = false
  // Where he is over the ground and how he moves, in his own frame: the locomotion planner follows it with steps.
  const position = HOME.clone().setY(0),
    velocity = V(0, 0, 0)
  const locomotion = new LocomotionPlanner(body, { acceleration: ACCELERATION })
  const world = (own: Vector3) => frame.localToWorld(own.clone())
  const turnOut = (own: Vector3) => own.clone().applyAxisAngle(Y, facing) // a direction or velocity out of the player's frame
  const eyes = body.get("eyes")
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
        const go = contact.clone().sub(stroke.contact).setY(0).sub(position),
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

  let time = 0
  /** This frame's goals, `dt` after the last, the sweet spot's first. */
  const update = (dt: number, ball: Incoming): Goal[] => {
    const t = (time += dt) // the time of the pose being solved; the body is still in the pose of t - dt
    const state = { position: local(ball.state.position), velocity: spin(ball.state.velocity) }
    // Replan every frame until the swing starts; from then on the time and the stroke stay.
    const mine = shot?.id === ball.id && !shot.done ? shot : undefined
    if (ball.mine && ball.bounced <= 1 && (!shot || shot.id !== ball.id || (mine && t < mine.time - SWING))) shot = decide(t, dt, ball, state, mine) ?? shot
    if (shot && t - shot.time > FOLLOW + 0.5) shot = undefined
    const playing = shot && !shot.done ? shot : undefined,
      since = shot ? t - shot.time : -9
    // Until the swing is committed, the contact follows the ball as it really flies (the bounce is never quite as predicted).
    if (playing && since < -COMMIT && playing.id === ball.id) playing.contact = predict(state, playing.time - t).position

    // Feet and pelvis: ask the locomotion planner for the stance, explicitly.
    const stroke = shot?.stroke ?? FOREHAND,
      stance = shot ? shot.contact.clone().sub(stroke.contact).setY(0) : HOME
    const turned = shot ? stroke.yaw * (since < 0 ? smoothstep((since + 0.9) / 0.5, 0, 1) : 1 - smoothstep(since / 0.4, 0, 1)) : 0
    if (playing && since < -0.2) {
      // "this foot planted here, turned so, by then": the back foot first, then the front one
      const back = stroke.sign > 0 ? "right" : "left",
        front = stroke.sign > 0 ? "left" : "right"
      locomotion.plant(back, world(stance.clone().add(stroke.feet[back])), playing.time - 0.45 - t, facing + stroke.yaw)
      locomotion.plant(front, world(stance.clone().add(stroke.feet[front])), playing.time - 0.2 - t, facing + stroke.yaw)
    }
    // He goes to where he is to stand: facing the net he side-steps, so he is slower sideways.
    const heading = (since < FOLLOW ? stance : HOME).clone().setY(0).sub(position).multiplyScalar(5)
    heading.multiplyScalar(Math.min(1, SIDE / Math.abs(heading.x || 1), SPEED / Math.abs(heading.z || 1)))
    velocity.add(
      heading
        .clone()
        .sub(velocity)
        .clampLength(0, ACCELERATION * dt),
    )
    position.addScaledVector(velocity, dt)
    const goals = locomotion.update(dt, {
      position: world(position),
      velocity: turnOut(velocity),
      desiredVelocity: turnOut(heading),
      facing: facing + turned,
      crouch: 0.13, // on his toes, knees bent
      taken: ["armL", "armR", "head", "trunk"],
    })

    // The racket: the sweet spot's path, from where it is and how it moves now.
    side += Math.min(1, Math.max(-1, stroke.sign - side)) * Math.min(1, 6 * dt)
    const hips = V(position.x, HIP, position.z)
    const pivot = hips.clone().add(FOREHAND.pivot.clone().lerp(BACKHAND.pivot, (1 - side) / 2))
    const now = local(body.positionOf(sweet)),
      moving = spin(body.velocityOf(sweet))
    const forward = shot ? shot.aim.clone().sub(shot.contact).setY(0).normalize() : V(0, 0, 1)
    let curve: ReturnType<typeof curveTo>,
      ahead = dt
    if (playing && since >= -SWING) {
      // the swing: to be at the ball, moving through it, at the contact time
      const through = forward
        .clone()
        .multiplyScalar(9)
        .add(V(0, 2.5, 0))
      if (!playing.frozen && since >= -COMMIT) playing.frozen = { curve: curveTo(now, moving, playing.contact, through, playing.time - t + dt), since: t - dt }
      curve = playing.frozen?.curve ?? curveTo(now, moving, playing.contact, through, playing.time - t + dt)
      if (playing.frozen) ahead = t - playing.frozen.since
    } else if (shot && since > 0 && since < FOLLOW)
      curve = curveTo(
        now,
        moving,
        hips
          .clone()
          .add(stroke.finish)
          .addScaledVector(velocity, FOLLOW - since + dt),
        velocity,
        FOLLOW - since + dt,
      )
    else curve = curveTo(now, moving, pivot.clone().add(READY).addScaledVector(velocity, 0.3), velocity, 0.3) // carried along with the pelvis
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
    const square = 30 * bump(since / 0.3) * smoothstep((z.length() - 0.2) / 0.5, 0, 1)
    to.roll.set({ quaternion: new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3().crossVectors(axis, z.normalize()), axis, z)) })
    // the head turns to where the ball will be met, or to the ball
    const gaze = (playing ? playing.contact : state.position).clone().sub(local(body.positionOf(eyes)))
    to.look.set({ quaternion: new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(gaze, V(0, 0, 0), Y)) })
    const coil = -stroke.sign * (shot ? 0.5 * bump((since + 0.3) / 0.45) - 0.35 * bump((since - 0.2) / 0.3) : 0) // the trunk winds up, then through
    // The hand's place shapes the swing's arc; between strokes the arm carries the racket as it likes (lower, elbow down).
    const swinging = shot ? smoothstep((since + SWING + 0.2) / 0.2, 0, 1) * (1 - smoothstep((since - FOLLOW) / 0.3, 0, 1)) : 0
    const both = ((1 - side) / 2) ** 2 // how far the left hand is on its way to the handle: all the way in a backhand
    if (holdingL && both < 0.9) {
      body.release("left", racket)
      holdingL = false
    }
    if (!holdingL && both > 0.9 && body.positionOf(hands.left.bone).distanceTo(body.positionOf(seatL)) < 0.01) {
      body.hold("left", racket, left) // the left hand closes a loop
      holdingL = true
    }
    if (!holdingL) hands.left.setPose(mix(HandPose.relaxed, left.pose, both))
    return [
      hard(sweet, to.sweet),
      ...goals,
      soft(racket, to.hand, 20 * swinging),
      soft(racket, to.roll, square),
      posture(body, { spine: [0.06, coil / 2, 0], chest: [0.06, coil / 2, 0] }, 3),
      posture(body, RELAXED, 0.2),
      soft(body.get("head"), to.look, 0.05),
      stay(body), // no joint turns far in a frame without need
      // a backhand is played with both hands: until the left holds, a goal between two points of the body
      ...(holdingL ? [] : [soft(hands.left.bone, seatL, 400 * both ** 4)]),
    ]
  }

  return {
    frame,
    body,
    racket,
    sweet,
    /** how each hand holds the racket: the right always, the left in a backhand */
    grips: { right, left },
    locomotion,
    update,
    /** The shot being played, if any. */
    get shot() {
      return shot
    },
    /** Where he means the ball to land, in the world. */
    aim: () => (shot ? frame.localToWorld(shot.aim.clone()) : new Vector3()),
    /** How far his pelvis is from where the stroke wanted it. */
    offStance: () => (shot ? position.distanceTo(shot.contact.clone().sub(shot.stroke.contact).setY(0)) : 0),
  }
}
export type PlayerPlanner = ReturnType<typeof createPlayerPlanner>
