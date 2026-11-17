// Tennis strokes, each played by a stroke planner of goal trajectories: a classic forehand, a two-handed backhand and a serve. A stroke is a short
// list of timed keys; between keys everything is splined, so each goal is a smooth function of time:
//   hard  feet (planted, the back foot may pivot and lift its heel), pelvis (weight shift, hip turn),
//         racket: the hand and the sweet spot each follow their path exactly, which fixes where the racket
//         points, and the sweet spot passes exactly through the contact point at the contact time
// The hands hold the racket in the grips found for them, found once and then rigid: the racket hangs from the
// right hand, and in the two-handed backhand the left closes the loop.
//   soft  the racket's roll about its own axis: a gentle guide through the stroke (the way a relaxed arm rolls it,
//         found by letting the solver choose), firm around contact where the strings must face the target;
//         the trunk's coil and uncoil as a pose over time (held firmly: it is the stroke's plan), the off hand,
//         the head turning to the contact point
// The hitting arm is listed in no pose: the racket decides it.

import { createRacket, GRIPS, REACH } from "@drawcall/example-stage/racket"
import {
  bump,
  type Goal,
  grip,
  type Grip,
  HandPose,
  Humanoid,
  hard,
  loopingCurve,
  mark,
  mix,
  type Pose,
  posture,
  soft,
  type Side,
  Target,
} from "@drawcall/animate"
import { type Group, MathUtils, Matrix4, Mesh, type Object3D, Quaternion, SphereGeometry, Vector3 } from "three"

const { smoothstep } = MathUtils
type V3 = [number, number, number]

export interface Key {
  t: number
  /** x, height, z, heading (rad, + turns left). The height is for a pelvis standing `STANDING` over the soles. */
  pelvis: [number, number, number, number]
  /** Forward bend, twist, side bend of the trunk (rad), shared equally by spine and chest. */
  trunk: V3
  /** Racket: where the hand is, where the head points, and roughly where the palm-side strings face (a soft guide). */
  hand: V3
  head: V3
  face: V3
  /** Off hand (in the chest frame, or in the world for the serve's toss); in a two-handed stroke, whose off hand is on
   *  the racket, the off elbow (in the chest frame), which keeps that arm out of the trunk. */
  left: V3
  /** Right foot heading and heel lift, left foot heading and heel lift (rad). */
  feet: [number, number, number, number]
  /** Optional guide for the hitting arm: shoulder flexion, abduction, twist and elbow flexion (rad). The racket
   *  goals decide the arm; this only says which of several ways to hold it is meant (arm overhead in the serve). */
  arm?: [number, number, number, number]
}

export interface Stroke {
  name: string
  period: number
  /** Time of ball contact. */
  contact: number
  /** Where the feet stand: x, z of the right and of the left sole. */
  stance: Record<Side, [number, number]>
  /** Which strings hit: +1 palm side (forehand, serve), -1 back of the hand. */
  side: 1 | -1
  /** The off hand's keys are world positions (the toss) instead of chest-relative. */
  toss?: boolean
  /** Both hands hold the racket: the left hand is attached above the right, which closes a loop. */
  twoHanded?: boolean
  keys: Key[]
}

const X = new Vector3(1, 0, 0),
  Y = new Vector3(0, 1, 0)
const V = (v: number[]) => new Vector3(v[0], v[1], v[2])
const turn = (axis: Vector3, angle: number) => new Quaternion().setFromAxisAngle(axis, angle)
const RELAXED: Pose = {
  neck: [0, 0, 0],
  head: [0, 0, 0],
  shoulderL: [0, 0],
  upperArmL: [0, 0, 0],
  forearmL: [-0.4, 0],
  handL: [0, 0],
  shoulderR: [0, 0],
  upperArmR: [0, 0, 0],
  forearmR: [-0.4, 0],
  handR: [0, 0],
}
/** how high over its soles the pelvis stands upright, for which the keys' pelvis heights are written (m) */
const STANDING = 0.98
/** the ball's radius (m) */
export const BALL = 0.033

/** A stroke's planner: the stroke repeats, so its goals are a function of time alone, evaluated at any time (`goalsAt`). */
export interface StrokePlanner {
  body: Humanoid
  racket: Group
  /** the racket's sweet spot */
  sweet: Object3D
  /** how each hand that holds the racket holds it */
  grips: Partial<Record<Side, Grip>>
  /** in a serve, how the left hand holds the ball until it lets go of it */
  toss?: Grip
  /** The goals at time t (s): the planner places its targets for then and lists what should match them. */
  goalsAt: (t: number) => Goal[]
  /** Ball position, for drawing. */
  ball: (t: number) => Vector3
  /** Where the stroke meets the ball if the contact point is left alone. */
  nominal: Vector3
}

/** The planner of a stroke, played by `rigged`, the rigged tennis player at rest. `contact` may move the meeting point
 * (the example's draggable ball); the swing bends towards it. */
export function createStrokePlanner(stroke: Stroke, rigged: Object3D, contact?: () => Vector3): StrokePlanner {
  const body = new Humanoid({ rig: rigged }),
    { hands } = body,
    { racket, sweet } = createRacket()
  // Each hand takes hold once, and from then on the arm is not free: the racket hangs from the right hand, and in a
  // two-handed stroke the left closes the loop.
  const grips: StrokePlanner["grips"] = { right: body.hold("right", racket, GRIPS.right) }
  if (stroke.twoHanded) grips.left = body.hold("left", racket, GRIPS.left)
  const ground = body.get("soleR").getWorldPosition(new Vector3()).y
  // the keys' pelvis heights, for another body's legs: as far down from standing, of how high it stands
  const legs = (body.get("pelvis").getWorldPosition(new Vector3()).y - ground) / STANDING
  const times = stroke.keys.map((k) => k.t)
  const curve = (pick: (k: Key) => number[]) => loopingCurve(times, stroke.keys.map(pick))
  const unit = (v: number[]) => V(v).normalize().toArray()
  const pelvis = curve((k) => k.pelvis),
    trunk = curve((k) => k.trunk),
    feet = curve((k) => k.feet),
    left = curve((k) => k.left)
  const handPath = curve((k) => k.hand),
    head = curve((k) => unit(k.head)),
    face = curve((k) => unit(k.face))

  const swing = (t: number) => {
    // hand, sweet spot, and the racket's frame (+Y along the racket, +Z out of the palm-side strings)
    const y = V(head(t)).normalize(),
      f = V(face(t)),
      z = f.addScaledVector(y, -f.dot(y)).normalize()
    const quaternion = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3().crossVectors(y, z), y, z))
    return { hand: V(handPath(t)), sweet: V(handPath(t)).addScaledVector(y, REACH), quaternion, normal: z }
  }
  const nominal = swing(stroke.contact).sweet
  const meet = () => (contact ? contact() : nominal.clone())
  const since = (t: number) => {
    // time relative to contact, within the current repetition
    const x = (((t - stroke.contact + stroke.period / 2) % stroke.period) + stroke.period) % stroke.period
    return x - stroke.period / 2
  }
  const near = (t: number, width: number) => bump(since(t) / width)
  const shift = (t: number) => meet().sub(nominal).multiplyScalar(near(t, 0.45)) // the swing bends towards a moved contact point, fully at contact

  const arm = stroke.keys.some((k) => k.arm) ? curve((k) => k.arm ?? [0, 0, 0, -0.4]) : null
  const coil = (t: number): Pose => {
    const [bend, twist, side] = trunk(t)
    return { spine: [bend / 2, twist / 2, side / 2], chest: [bend / 2, twist / 2, side / 2] }
  }
  const armGuide =
    arm &&
    ((t: number): Pose => {
      const a = arm(t)
      return { upperArmR: [a[0], a[1], a[2]], forearmR: [a[3], 0] }
    })

  // The toss. The ball is at the top of its flight at contact, so its whole flight follows from the contact point:
  // it leaves the hand RELEASE seconds earlier, straight below, moving up at g * RELEASE. The tossing hand is
  // planned backwards from that: it lifts the ball to the release point arriving at exactly that speed, lets go,
  // and keeps rising while it slows down. Outside that window the hand follows its keys.
  // The left hand holds the ball in its fingertips, the thumb, index and middle under it, found once; the ball is where
  // that grip has it in the hand (`held`), and the toss moves that point. The fingers open as the ball leaves them and
  // close again before the next ball is in the hand.
  const RELEASE = 0.42,
    LIFT = 0.5,
    FOLLOW = 0.22,
    RETURN = 0.5,
    OPEN = 0.15,
    GRAVITY = 9.81
  const toss = stroke.toss
    ? grip(hands.left, new Mesh(new SphereGeometry(BALL, 24, 16)), {
        at: new Vector3(),
        approachFrom: new Vector3(0, -1, 0.3),
        thumbToward: new Vector3(1, 0, 0),
        using: ["thumb", "index", "middle"],
      })
    : undefined
  const inHand = toss && new Matrix4().compose(toss.position, toss.quaternion, new Vector3(1, 1, 1)).invert()
  const held = inHand && mark(hands.left.bone, "ball", new Vector3().setFromMatrixPosition(inHand), new Quaternion().setFromRotationMatrix(inHand))
  const fingers = (t: number) => {
    // how far the fingers are closed on the ball: open after the release, closed again for the next
    const x = since(t)
    return x < -RELEASE ? 1 : Math.max(1 - (x + RELEASE) / OPEN, (x - stroke.period / 2) / (2 * OPEN) + 1, 0)
  }
  const tossHand = (t: number): Vector3 => {
    const dt = since(t) + RELEASE,
      key = V(left(t)) // dt: time since the ball left the hand
    if (dt < -LIFT || dt > FOLLOW + RETURN) return key
    const up = GRAVITY * RELEASE,
      release = meet().add(new Vector3(0, -0.5 * GRAVITY * RELEASE * RELEASE, 0))
    if (dt <= 0) {
      // lift: from where the keys had the hand, at rest, to the release point at the ball's speed
      const u = (dt + LIFT) / LIFT,
        u2 = u * u,
        u3 = u2 * u
      return V(left(t - dt - LIFT))
        .multiplyScalar(2 * u3 - 3 * u2 + 1)
        .addScaledVector(release, -2 * u3 + 3 * u2)
        .add(new Vector3(0, (u3 - u2) * LIFT * up, 0))
    }
    const s = Math.min(dt, FOLLOW),
      top = release.add(new Vector3(0, up * s - (0.5 * up * s * s) / FOLLOW, 0))
    const w = Math.max(0, (dt - FOLLOW) / RETURN)
    return top.lerp(key, w * w * (3 - 2 * w)) // then back to the keys (the arm tucks in for the hit)
  }

  // The head does not chase the ball (it passes within a metre at speed, and following it whipped the head around
  // by a quarter of a radian per frame). It turns calmly from looking down the court to the contact point, is
  // still through the hit, and turns back.
  const gaze = (t: number) => {
    const dt = since(t)
    return new Vector3(0, 1.4, 12).lerp(meet(), dt < 0 ? smoothstep((dt + 0.9) / 0.6, 0, 1) : 1 - smoothstep((dt - 0.15) / 0.6, 0, 1))
  }
  const eyes = mark(body.get("head"), "eyes", new Vector3(0, 0.1, 0))
  // The points this planner moves each frame. World points for the feet, pelvis, racket and gaze; the off hand's
  // spot is a marker on the chest, so that goal is between two points of the body.
  const to = {
    footR: new Target(),
    footL: new Target(),
    pelvis: new Target(),
    sweet: new Target(),
    hand: new Target(),
    roll: new Target(),
    toss: new Target(),
    upright: new Target().set({ quaternion: new Quaternion() }),
    look: new Target(),
  }
  const spot = new Target() // where the off hand (or in a two-handed stroke the off elbow) is, in the chest's frame
  body.get("chest").add(spot)
  const fistL = body.get("fistL")
  const goalsAt = (t: number): Goal[] => {
    const f = feet(t),
      p = pelvis(t),
      s = swing(t),
      by = shift(t)
    to.footR.set({ position: new Vector3(stroke.stance.right[0], ground, stroke.stance.right[1]), quaternion: turn(Y, f[0]).multiply(turn(X, f[1])) })
    to.footL.set({ position: new Vector3(stroke.stance.left[0], ground, stroke.stance.left[1]), quaternion: turn(Y, f[2]).multiply(turn(X, f[3])) })
    to.pelvis.set({ position: new Vector3(p[0], ground + p[1] * legs, p[2]), quaternion: turn(Y, p[3]) })
    to.sweet.set({ position: s.sweet.add(by) })
    to.hand.set({ position: s.hand.add(by) })
    to.roll.set({ quaternion: s.quaternion })
    to.look.set({ quaternion: new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(gaze(t).sub(body.positionOf(eyes)), new Vector3(), Y)) })
    if (toss) {
      to.toss.set({ position: tossHand(t) })
      hands.left.setPose(mix(HandPose.relaxed, toss.pose, fingers(t)))
    } else spot.set({ position: V(left(t)) })
    return [
      hard(body.get("soleR"), to.footR),
      hard(body.get("soleL"), to.footL),
      hard(body.get("pelvis"), to.pelvis),
      hard(sweet, to.sweet),
      hard(racket, to.hand),
      soft(racket, to.roll, 0.3 + 30 * near(t, 0.15)),
      // The trunk's coil is the stroke's plan and is held firmly: the arms adapt to it, and it gives way only where
      // the racket cannot be reached otherwise.
      posture(body, coil(t), 1),
      ...(armGuide ? [posture(body, armGuide(t), 0.05)] : []),
      posture(body, RELAXED, 0.02), // a light preference, so that what the other goals leave open settles quickly
      // the off hand has a goal while it is free; in a two-handed stroke it is on the racket and its elbow has one
      ...(stroke.twoHanded ? [soft(body.get("forearmL"), spot, 10)] : held ? [soft(held, to.toss, 4), soft(held, to.upright, 0.3)] : [soft(fistL, spot)]),
      soft(body.get("head"), to.look, 0.1),
    ]
  }

  // The ball, for drawing only: it arrives at the contact point at the contact time and leaves along the strings.
  const flight = (from: Vector3, v: Vector3, dt: number) => {
    const p = from
      .clone()
      .addScaledVector(v, dt)
      .add(new Vector3(0, -0.5 * GRAVITY * dt * dt, 0))
    if (p.y < 0.033) p.y = 0.033 + 0.6 * (0.033 - p.y) // one crude bounce
    return p
  }
  const ball = (t: number): Vector3 => {
    const dt = since(t),
      c = meet()
    if (dt >= 0)
      return flight(
        c,
        swing(stroke.contact)
          .normal.multiplyScalar(stroke.side * (stroke.toss ? 24 : 17))
          .add(new Vector3(0, stroke.toss ? -1.5 : 3, 0)),
        dt,
      )
    if (!held) return flight(c, new Vector3(0.4 * stroke.side, -2.2, -10), dt)
    const inFingers = body.positionOf(held) // in the hand until the release, then in free flight
    if (dt < -RELEASE) return inFingers
    return inFingers.lerp(flight(c, new Vector3(), dt), Math.min(1, (dt + RELEASE) / 0.05)) // the hand is a soft goal: hide the few millimetres it may be off
  }
  return { body, racket, sweet, grips, toss, goalsAt, ball, nominal }
}

// ---------------------------------------------------------------- the strokes
// The player stands at the origin facing the net (+Z); +X is the player's left. Right-handed.

export const FOREHAND: Stroke = {
  name: "Forehand",
  period: 2.6,
  contact: 1.2,
  side: 1,
  stance: { right: [-0.22, -0.14], left: [-0.02, 0.3] },
  keys: [
    {
      t: 0,
      pelvis: [-0.1, 0.93, 0.06, -0.35],
      trunk: [0.08, 0, 0],
      hand: [-0.14, 1.05, 0.36],
      head: [0.25, 0.5, 0.83],
      face: [0.92, 0.14, -0.36],
      left: [0.12, -0.22, 0.33],
      feet: [-0.9, 0, -0.5, 0],
    },
    {
      t: 0.75,
      pelvis: [-0.14, 0.9, 0, -1.1],
      trunk: [0.05, -0.55, 0],
      hand: [-0.6, 1.2, -0.15],
      head: [-0.2, 0.8, -0.55],
      face: [-0.05, 0.56, 0.83],
      left: [0.05, -0.05, 0.5],
      feet: [-1.1, 0, -0.55, 0],
    },
    {
      t: 1.08,
      pelvis: [-0.13, 0.885, 0.04, -0.95],
      trunk: [0.06, -0.4, 0.02],
      hand: [-0.62, 0.9, -0.1],
      head: [-0.5, -0.3, -0.8],
      face: [-0.72, 0.67, 0.2],
      left: [0.12, -0.08, 0.42],
      feet: [-1.1, 0, -0.55, 0],
    },
    {
      t: 1.2,
      pelvis: [-0.08, 0.915, 0.13, -0.4],
      trunk: [0.06, -0.05, 0],
      hand: [-0.5, 0.92, 0.36],
      head: [-0.92, -0.05, 0.38],
      face: [0.36, 0.06, 0.93],
      left: [0.22, -0.12, 0.25],
      feet: [-0.85, 0.25, -0.5, 0],
    },
    {
      t: 1.33,
      pelvis: [-0.07, 0.92, 0.13, -0.2],
      trunk: [0.05, 0.25, 0],
      hand: [-0.2, 1.2, 0.6],
      head: [0.2, 0.55, 0.8],
      face: [0.98, -0.14, -0.16],
      left: [0.21, -0.08, 0.22],
      feet: [-0.65, 0.4, -0.47, 0],
    },
    {
      t: 1.6,
      pelvis: [-0.07, 0.915, 0.13, -0.05],
      trunk: [0.04, 0.5, 0],
      hand: [0.14, 1.45, 0.34],
      head: [0.5, 0.62, -0.6],
      face: [0.45, -0.78, -0.43],
      left: [0.2, -0.05, 0.2],
      feet: [-0.45, 0.5, -0.45, 0],
    },
    {
      t: 2.6,
      pelvis: [-0.1, 0.93, 0.06, -0.35],
      trunk: [0.08, 0, 0],
      hand: [-0.14, 1.05, 0.36],
      head: [0.25, 0.5, 0.83],
      face: [0.92, 0.14, -0.36],
      left: [0.12, -0.22, 0.33],
      feet: [-0.9, 0, -0.5, 0],
    },
  ],
}

export const BACKHAND: Stroke = {
  name: "Backhand",
  period: 2.6,
  contact: 1.2,
  side: -1,
  twoHanded: true,
  stance: { right: [0.02, 0.3], left: [0.22, -0.14] },
  keys: [
    {
      t: 0,
      pelvis: [0.08, 0.93, 0.06, 0.35],
      trunk: [0.08, 0, 0],
      hand: [0.06, 1.0, 0.46],
      head: [0.25, 0.5, 0.83],
      face: [0.92, -0.38, -0.05],
      left: [0.22, -0.1, 0.08],
      feet: [0.5, 0, 0.9, 0],
    },
    {
      t: 0.4,
      pelvis: [0.11, 0.915, 0.03, 0.8],
      trunk: [0.06, 0.3, 0],
      hand: [0.34, 1.0, 0.24],
      head: [0.5, 0.75, 0.2],
      face: [0.64, -0.23, -0.74],
      left: [0.22, -0.1, 0.06],
      feet: [0.55, 0, 1.05, 0],
    },
    {
      t: 0.75,
      pelvis: [0.13, 0.9, 0, 1.15],
      trunk: [0.05, 0.6, 0],
      hand: [0.5, 0.95, -0.03],
      head: [0.3, 0.65, -0.7],
      face: [-0.59, -0.45, -0.67],
      left: [0.22, -0.08, 0.06],
      feet: [0.6, 0, 1.1, 0],
    },
    {
      t: 1.08,
      pelvis: [0.12, 0.885, 0.05, 0.95],
      trunk: [0.08, 0.4, -0.03],
      hand: [0.4, 0.8, 0.04],
      head: [0.5, -0.2, -0.84],
      face: [-0.85, -0.27, -0.45],
      left: [0.22, -0.06, 0.1],
      feet: [0.6, 0, 1.1, 0],
    },
    {
      t: 1.2,
      pelvis: [0.08, 0.915, 0.13, 0.5],
      trunk: [0.08, -0.05, 0],
      hand: [0.2, 0.88, 0.44],
      head: [0.95, -0.05, 0.3],
      face: [0.3, 0, -0.95],
      left: [0.18, -0.02, 0.15],
      feet: [0.6, 0, 0.9, 0.2],
    },
    {
      t: 1.34,
      pelvis: [0.07, 0.925, 0.14, 0.3],
      trunk: [0.05, -0.25, 0],
      hand: [-0.02, 1.15, 0.56],
      head: [0.55, 0.5, 0.67],
      face: [0.73, -0.68, -0.08],
      left: [0.12, 0.06, 0.18],
      feet: [0.6, 0, 0.75, 0.3],
    },
    {
      t: 1.6,
      pelvis: [0.06, 0.925, 0.14, 0],
      trunk: [0.03, -0.5, 0],
      hand: [-0.25, 1.45, 0.25],
      head: [-0.45, 0.6, -0.66],
      face: [0.55, 0.77, 0.32],
      left: [0.08, 0.14, 0.16],
      feet: [0.55, 0, 0.5, 0.45],
    },
    {
      t: 2.6,
      pelvis: [0.08, 0.93, 0.06, 0.35],
      trunk: [0.08, 0, 0],
      hand: [0.06, 1.0, 0.46],
      head: [0.25, 0.5, 0.83],
      face: [0.92, -0.38, -0.05],
      left: [0.22, -0.1, 0.08],
      feet: [0.5, 0, 0.9, 0],
    },
  ],
}

export const SERVE: Stroke = {
  name: "Serve",
  period: 3.2,
  contact: 1.75,
  side: 1,
  toss: true,
  stance: { right: [-0.05, -0.18], left: [0, 0.2] },
  keys: [
    {
      t: 0,
      pelvis: [-0.02, 0.93, 0.03, -1.1],
      trunk: [0.05, 0, 0],
      hand: [-0.29, 1.0, 0.18],
      head: [0.2, 0.15, 0.97],
      face: [0.97, -0.16, -0.18],
      left: [-0.22, 1.08, 0.5],
      feet: [-1.35, 0, -0.8, 0],
      arm: [0, 0, 0, -0.6],
    },
    {
      t: 0.35,
      pelvis: [-0.02, 0.925, 0.025, -1.14],
      trunk: [0.03, -0.08, 0.02],
      hand: [-0.34, 1.1, 0],
      head: [0, 0.9, 0.45],
      face: [0.77, -0.28, 0.57],
      left: [-0.15, 1.0, 0.45],
      feet: [-1.35, 0, -0.8, 0],
      arm: [-0.3, -0.2, 0, -1.2],
    },
    {
      t: 0.65,
      pelvis: [-0.02, 0.92, 0.02, -1.18],
      trunk: [0, -0.15, 0.05],
      hand: [-0.36, 1.25, -0.2],
      head: [-0.25, 0.6, -0.75],
      face: [-0.07, 0.77, 0.64],
      left: [-0.12, 0.92, 0.4],
      feet: [-1.35, 0, -0.8, 0],
      arm: [0.2, -0.9, -0.6, -1.2],
    },
    {
      t: 1.2,
      pelvis: [-0.02, 0.87, 0.05, -1.25],
      trunk: [-0.3, -0.25, 0.1],
      hand: [-0.3, 1.6, -0.35],
      head: [-0.05, 0.99, 0.1],
      face: [-0.53, -0.11, 0.84],
      left: [-0.12, 0.95, 0.4],
      feet: [-1.35, 0, -0.8, 0],
      arm: [-0.3, -1.4, -1.2, -1.6],
    },
    {
      t: 1.33,
      pelvis: [-0.016, 0.88, 0.06, -1.15],
      trunk: [-0.35, -0.2, 0.1],
      hand: [-0.28, 1.63, -0.34],
      head: [-0.08, 0.8, -0.6],
      face: [0, 0.61, 0.79],
      left: [-0.12, 1.0, 0.4],
      feet: [-1.33, 0.08, -0.8, 0.08],
      arm: [-0.6, -1.4, -1.3, -1.9],
    },
    {
      t: 1.46,
      pelvis: [-0.012, 0.9, 0.07, -1.0],
      trunk: [-0.35, -0.12, 0.05],
      hand: [-0.25, 1.68, -0.26],
      head: [-0.1, 0.25, -0.97],
      face: [0.82, 0.57, 0.06],
      left: [0, 1.6, 0.32],
      feet: [-1.3, 0.15, -0.8, 0.15],
      arm: [-1.0, -1.2, -1.3, -2.0],
    },
    {
      t: 1.61,
      pelvis: [-0.005, 0.92, 0.08, -0.65],
      trunk: [-0.25, 0.08, -0.1],
      hand: [-0.22, 1.84, -0.02],
      head: [-0.15, 0.75, -0.64],
      face: [0.92, 0.33, 0.19],
      left: [0.1, 1.4, 0.33],
      feet: [-1.15, 0.3, -0.75, 0.3],
      arm: [-2.0, -0.7, -0.6, -1.0],
    },
    {
      t: 1.75,
      pelvis: [0, 0.93, 0.09, -0.35],
      trunk: [-0.1, 0.25, -0.25],
      hand: [-0.2, 1.93, 0.2],
      head: [0.05, 0.98, 0.2],
      face: [0.05, -0.2, 0.98],
      left: [0.15, 1.15, 0.28],
      feet: [-0.9, 0.4, -0.7, 0.4],
      arm: [-2.7, -0.3, 0, -0.2],
    },
    {
      t: 1.95,
      pelvis: [0.01, 0.92, 0.11, -0.1],
      trunk: [0.22, 0.3, -0.1],
      hand: [0.02, 1.7, 0.52],
      head: [0.2, -0.25, 0.95],
      face: [-0.47, -0.87, -0.13],
      left: [0.18, 1.1, 0.28],
      feet: [-0.65, 0.5, -0.65, 0.2],
      arm: [-1.6, 0.1, 0.3, -0.3],
    },
    {
      t: 2.3,
      pelvis: [0.02, 0.9, 0.12, -0.05],
      trunk: [0.3, 0.35, 0],
      hand: [0.3, 0.85, 0.4],
      head: [0.45, -0.75, -0.45],
      face: [-0.87, -0.27, -0.42],
      left: [0.2, 1.05, 0.3],
      feet: [-0.55, 0.6, -0.6, 0],
      arm: [-0.4, 0.3, 0.4, -0.5],
    },
    {
      t: 2.75,
      pelvis: [0, 0.92, 0.07, -0.6],
      trunk: [0.15, 0.15, 0],
      hand: [-0.05, 0.95, 0.33],
      head: [0.45, -0.1, 0.85],
      face: [0.87, 0.24, -0.43],
      left: [0, 1.05, 0.38],
      feet: [-1.0, 0.2, -0.7, 0],
      arm: [-0.2, 0.1, 0, -0.8],
    },
    {
      t: 3.2,
      pelvis: [-0.02, 0.93, 0.03, -1.1],
      trunk: [0.05, 0, 0],
      hand: [-0.29, 1.0, 0.18],
      head: [0.2, 0.15, 0.97],
      face: [0.97, -0.16, -0.18],
      left: [-0.22, 1.08, 0.5],
      feet: [-1.35, 0, -0.8, 0],
      arm: [0, 0, 0, -0.6],
    },
  ],
}

export const STROKES = [FOREHAND, BACKHAND, SERVE]
