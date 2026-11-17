// A humanoid as three.js bones, procedural or on a rigged skeleton: 1.75 m, 70 kg, 48 degrees of freedom when
// procedural. Neutral pose: standing, arms hanging. Every bone frame is world-aligned in the zero pose: +X left, +Y up,
// +Z forward. Each joint is a short sequence of hinges with box limits (rad). An approximation, not anatomy: two spine
// joints, no scapula, fingers or toes in the body (a rig's fingers are its hands'), ranges from typical values, Euler
// hinges with independent box limits.

import { type Grip, grip, type GripOptions, Hand, type Side } from "@drawcall/hand"
import { Body, type Goal, type Hinge, Joint, mark, type Pose, soft, Target } from "@drawcall/ik"
import { type Object3D, Quaternion, Vector3 } from "three"

const X = new Vector3(1, 0, 0),
  Y = new Vector3(0, 1, 0),
  Z = new Vector3(0, 0, 1)
const hinge = (axis: Vector3, min: number, max: number): Hinge => ({ axis, min, max })
const V = (x: number, y: number, z: number) => new Vector3(x, y, z)

/** How a humanoid is built. */
export interface HumanoidOptions {
  /** How heavily built, from 0 (slim, the default) to 1 (heavy): a bigger trunk and bulkier arms leave less room to fold the arms in (two narrower limits; there is no self-collision). */
  girth?: number
  /**
   * A rigged character to carry instead of building bones of its own (a @drawcall/rig result's object, say): an
   * Object3D with bones named as VRM names them (hips, spine, chest, neck, head, leftShoulder, leftUpperArm,
   * leftLowerArm, leftHand, leftUpperLeg, leftLowerLeg, leftFoot and the right ones) in a T-pose, standing on y = 0 and
   * facing +Z, unscaled. The body gets its proportions, and the rig's bones are moved onto the body's joints, so
   * whatever is skinned to them follows: put the body's root and the rigged object into the same parent, and find the
   * rig's bones through the body from then on. Each rig bone the body carries is renamed `rigged <joint>` (the rig's
   * `head` becomes `rigged head`), so that a name in the body's tree names one thing and `get("head")` is the joint.
   * Missing bones throw, all of them named. Finger bones with the VRM names make the humanoid's `hands`.
   */
  rig?: Object3D
  /** Where it stands (m): the point on the ground under its pelvis, in the frame of the parent its root goes into. Default: the origin. */
  position?: Vector3
  /** Which way it faces (rad about +Y, 0 facing +Z). Default: 0. */
  yaw?: number
}
const RIGGED: Record<string, string> = { pelvis: "hips", forearm: "LowerArm", thigh: "UpperLeg", shin: "LowerLeg" }
const rigged = (name: string) => {
  const side = /[LR]$/.test(name) ? (name.endsWith("L") ? "left" : "right") : "",
    part = side ? name.slice(0, -1) : name
  return side ? side + (RIGGED[part] ?? part[0].toUpperCase() + part.slice(1)) : (RIGGED[part] ?? part)
}
/** The rigged bone for each of the body's bone names. */
function riggedBones(rig: Object3D, names: string[]): Record<string, Object3D> {
  const found: Record<string, Object3D> = {},
    missing: string[] = []
  for (const name of names) {
    const bone = rig.getObjectByName(rigged(name))
    if (bone) found[name] = bone
    else missing.push(rigged(name))
  }
  if (missing.length) throw new Error(`the rig has no ${missing.map((name) => `'${name}'`).join(", ")}`)
  return found
}

/** The skeleton's joints, carrying a rig's bones if there is one, standing where the options say: its root, the pelvis. */
function skeleton(options: HumanoidOptions): Joint {
  const girth = Math.min(1, Math.max(0, options.girth ?? 0))
  // Stand-ins for the arm running into the trunk and the forearm into the upper arm (there is no self-collision):
  // the upper arm may cross less far in front of the body, the elbow closes less.
  const adduct = 0.8 - 0.5 * girth,
    elbow = 2.6 - 0.5 * girth
  // The upper arm's way sideways. Hanging or swung back it goes out but not in: the trunk is there. Only as it is
  // raised forward (70 degrees for the full range) can it cross in front of the chest.
  const across = (s: number): Hinge => {
    const range = ([flexion]: number[]): [number, number] => {
      const inward = adduct * Math.min(1, Math.max(0, -flexion / 1.2))
      return s > 0 ? [-inward, 2.6] : [-2.6, inward]
    }
    return { axis: Z, min: range([0])[0], max: range([0])[1], range }
  }
  const NAMES = [
    "pelvis",
    "spine",
    "chest",
    "neck",
    "head",
    ...["shoulder", "upperArm", "forearm", "hand", "thigh", "shin", "foot"].flatMap((n) => [n + "L", n + "R"]),
  ]
  const found = options.rig && riggedBones(options.rig, NAMES) // before any is moved
  const given = (name: string) => found?.[name]
  options.rig?.updateWorldMatrix(true, true)
  const ankle = found ? found.footL.getWorldPosition(V(0, 0, 0)).y : 0.06 // how high the ankle is over the sole
  const turnOf = (o: Object3D) => (o.updateWorldMatrix(true, false), o.getWorldQuaternion(new Quaternion()))
  // A bone at its place. With a rigged skeleton the place is the rigged joint's, and the rigged bone is hung on the
  // new one (after turning it so that the limb hangs down, or the foot lies flat, as the neutral pose has them): the
  // body's own bones stay world-aligned whatever the rig's are, and the skinned mesh follows through the scene graph.
  const bone = (name: string, parent: Joint | null, at: Vector3, hinges: Hinge[], mass: number, center: Vector3, neutral: number[] = [], next?: string) => {
    const b = new Joint(hinges, neutral, mass, center),
      rig = given(name)
    b.name = name
    b.position.copy(rig ? rig.getWorldPosition(V(0, 0, 0)) : at)
    if (rig && parent) parent.worldToLocal(b.position)
    parent?.add(b)
    if (rig) {
      const above = rig.parent ? turnOf(rig.parent) : new Quaternion(),
        child = next && given(next)
      if (child)
        rig.quaternion.premultiply(
          above
            .clone()
            .invert()
            .multiply(new Quaternion().setFromUnitVectors(child.position.clone().normalize().applyQuaternion(turnOf(rig)), V(0, -1, 0)))
            .multiply(above),
        )
      else if (name.startsWith("foot")) rig.quaternion.copy(above.invert())
      rig.name = "rigged " + name
      b.attach(rig)
    }
    return b
  }
  // Floating base: it slides freely, then turns by yaw (unbounded), pitch, roll.
  const pelvis = bone("pelvis", null, V(0, 0.98, 0), [hinge(Y, -1e9, 1e9), hinge(X, -1.2, 1.2), hinge(Z, -1.2, 1.2)], 9.8, V(0, 0.03, 0))
  // +X rotation of an upward bone is forward flexion.
  const spine = bone("spine", pelvis, V(0, 0.1, 0), [hinge(X, -0.3, 0.6), hinge(Y, -0.4, 0.4), hinge(Z, -0.3, 0.3)], 7, V(0, 0.075, 0))
  const chest = bone("chest", spine, V(0, 0.15, 0), [hinge(X, -0.2, 0.4), hinge(Y, -0.4, 0.4), hinge(Z, -0.25, 0.25)], 13.3, V(0, 0.12, 0))
  const neck = bone("neck", chest, V(0, 0.24, 0), [hinge(X, -0.4, 0.5), hinge(Y, -0.6, 0.6), hinge(Z, -0.3, 0.3)], 1.4, V(0, 0.045, 0))
  const head = bone("head", neck, V(0, 0.09, 0), [hinge(X, -0.4, 0.4), hinge(Y, -0.6, 0.6), hinge(Z, -0.25, 0.25)], 4.9, V(0, 0.09, 0))
  mark(head, "eyes", V(0, 0.1, 0.09))

  for (const [S, s] of [
    ["L", 1],
    ["R", -1],
  ] as const) {
    // Y and Z rotations change sign under left/right mirroring; limits are given for the left side.
    const side = (axis: Vector3, min: number, max: number) => (s > 0 ? hinge(axis, min, max) : hinge(axis, -max, -min))
    // Clavicle: protraction, elevation.
    const shoulder = bone("shoulder" + S, chest, V(0.03 * s, 0.19, 0), [side(Y, -0.3, 0.3), side(Z, -0.15, 0.5)], 0.7, V(0.075 * s, 0, 0))
    // Shoulder ball joint: flexion (-X raises the arm forward), abduction, axial twist.
    const upperArm = bone(
      "upperArm" + S,
      shoulder,
      V(0.15 * s, 0, 0),
      [hinge(X, -3.0, 1.0), across(s), side(Y, -1.4, 1.4)],
      1.96,
      V(0, -0.145, 0),
      [],
      "forearm" + S,
    )
    // Elbow flexion, forearm pronation/supination.
    const forearm = bone("forearm" + S, upperArm, V(0, -0.29, 0), [hinge(X, -elbow, 0), side(Y, -1.4, 1.4)], 1.12, V(0, -0.13, 0), [-0.25, 0], "hand" + S)
    // Wrist. The palm faces the body and the thumb forward, so turning about X tilts the hand towards the thumb
    // (radial, -) or the little finger (ulnar, +), and turning about Z flexes (towards the palm) or extends it.
    const hand = bone("hand" + S, forearm, V(0, -0.26, 0), [hinge(X, -0.35, 0.6), side(Z, -1.4, 1.2)], 0.42, V(0, -0.08, 0))
    mark(hand, "fist" + S, V(0, -0.08, 0))
    mark(hand, "palm" + S, V(-0.015 * s, -0.08, 0), new Quaternion().setFromAxisAngle(X, Math.PI / 2))
    // Hip: flexion (-X swings the leg forward), abduction, twist.
    const thigh = bone(
      "thigh" + S,
      pelvis,
      V(0.09 * s, -0.07, 0),
      [hinge(X, -2.0, 0.5), side(Z, -0.4, 0.8), side(Y, -0.6, 0.6)],
      7,
      V(0, -0.21, 0),
      [-0.05, 0, 0],
      "shin" + S,
    )
    // The knee stops short of straight: the solver can stay on a limit that is a straight limb.
    const shin = bone("shin" + S, thigh, V(0, -0.43, 0), [hinge(X, 0.06, 2.4)], 3.26, V(0, -0.2, 0), [0.1], "foot" + S)
    // Ankle: dorsi/plantar flexion, inversion/eversion.
    const foot = bone("foot" + S, shin, V(0, -0.42, 0), [hinge(X, -0.7, 0.6), hinge(Z, -0.35, 0.35)], 1.02, V(0, -0.04, 0.05), [-0.05, 0])
    mark(foot, "sole" + S, V(0, -ankle, 0.04))
    mark(foot, "heel" + S, V(0, -ankle, -0.05)) // what it lands on in a walk
    mark(foot, "ball" + S, V(0, -ankle, 0.13)) // what it pushes off from
  }
  if (options.position) pelvis.position.add(options.position)
  return pelvis
}

/**
 * A person to pose: the procedural humanoid, or one built on a rigged character (`HumanoidOptions.rig`). The procedural
 * one is bones only, with no mesh (show it with three's SkeletonHelper or hang meshes of your own on its bones) and no
 * hands; a rigged one shows the rig's skinned mesh and has hands if the rig has finger bones.
 *
 * In the zero pose every bone's axes are the world's (+X left, +Y up, +Z forward), standing with the arms hanging.
 * Each bone's hinges, in the order a `Pose` lists its angles (rad), with the sign each turns, for the left side; the
 * right side mirrors it, with the same X angles and Y and Z angles of opposite sign:
 * - `pelvis` (the root, which also slides freely): Y yaw (+ turns left, unbounded), X pitch (+ tips forward), Z roll (+ tips toward the right, the left hip up)
 * - `spine`, `chest`, `neck`, `head`: X bend (+ forward), Y twist (+ turns left), Z side bend (+ toward the right)
 * - `shoulderL` (the clavicle): Y (+ draws the shoulder back), Z (+ raises it)
 * - `upperArmL`: X flexion (- raises the arm forward, + swings it back), Z abduction (+ out to the side), Y axial twist (+ turns it outward)
 * - `forearmL`: X elbow (- bends it; neutral -0.25), Y forearm roll (+ turns the palm forward, supination)
 * - `handL` (the wrist, the palm facing the body and the thumb forward): X (- tilts the hand toward the thumb, + toward the little finger), Z (- flexes toward the palm, + extends)
 * - `thighL`: X flexion (- swings the leg forward), Z abduction (+ out to the side), Y twist (+ turns the foot outward)
 * - `shinL`: X knee (+ bends it; it stops short of straight)
 * - `footL`: X ankle (+ points the toes down), Z (+ tips the sole toward the body's left, for both feet)
 * Writing more angles for a bone than it has hinges throws.
 *
 * Marked points: `eyes` (looking along +Z) and per side (L / R) `sole` (under the foot, with `heel` and `ball` behind
 * and ahead of it), `fist` (centre of the closed hand) and `palm` (turned so that, with the forearm held forward, +Y is
 * up and +Z forward). A bone is a point too: `humanoid.get("chest")`. Joints, limits, the neutral pose and the marked
 * points are the same procedural or rigged, with the rig's proportions, so a planner's goals and poses carry over; its
 * distances (a hand's reach, how high the pelvis stands) are the body's own.
 */
export class Humanoid extends Body {
  /** Trunk, head and legs in the neutral standing pose, the arms left out so that they are free to work: a pose for `posture`. */
  readonly uprightPose: Pose
  readonly #rigged: boolean
  #hands: { left: Hand; right: Hand } | undefined

  constructor(options: HumanoidOptions = {}) {
    super(skeleton(options))
    this.#rigged = !!options.rig
    this.angles[this.dofs(this.root)[0]] = options.yaw ?? 0
    this.update()
    const neutral = this.anglesOf()
    this.uprightPose = {}
    for (const name of ["spine", "chest", "neck", "head", "thighL", "shinL", "footL", "thighR", "shinR", "footR"])
      this.uprightPose[name] = this.dofs(this.get(name)).map((k) => neutral[k])
  }

  /**
   * The rig's hands, read from its finger bones the first time they are asked for: leave the rig's fingers as they
   * rest until then. Each holds `HandPose.relaxed` until posed otherwise. Throws for the procedural humanoid, or a rig
   * without finger bones.
   */
  get hands(): { left: Hand; right: Hand } {
    if (this.#hands) return this.#hands
    if (!this.#rigged) throw new Error("the procedural humanoid has no hands: only a humanoid built on a rig with finger bones has (HumanoidOptions.rig)")
    if (!this.root.getObjectByName("leftMiddleProximal") && !this.root.getObjectByName("rightMiddleProximal"))
      throw new Error("this humanoid has no hands: its rig has no finger bones named as VRM names them, {side}{Finger}{Proximal,Intermediate,Distal}")
    return (this.#hands = { left: new Hand(this.root, "left"), right: new Hand(this.root, "right") })
  }

  /**
   * Take hold of `object` with a hand and keep it: the grip is found (or taken as given, found earlier with `grip`),
   * the fingers take its pose, the hand bone's place on the object is marked (`seatL` or `seatR`) and the object is
   * attached there. Holding with the second hand what the first holds closes a loop; an object hanging on the body
   * by a mark of its own (a sling) goes into the hand. Returns the grip.
   */
  hold(side: Side, object: Object3D, how: GripOptions | Grip): Grip {
    const hand = this.hands[side]
    const held = "pose" in how ? how : grip(hand, object, how)
    hand.setPose(held.pose)
    const name = side === "left" ? "seatL" : "seatR"
    const seat = object.children.find((child) => child.name === name) ?? mark(object, name)
    seat.position.copy(held.position)
    seat.quaternion.copy(held.quaternion)
    this.attach(object, hand.bone, seat)
    return held
  }

  /** Let go of `object` with a hand: see `detach`. The fingers stay as they are until posed otherwise. */
  release(side: Side, object: Object3D) {
    this.detach(object, this.hands[side].bone)
  }

  /** Balance as an ordinary soft goal for this frame: the center of mass over the middle of the soles, horizontally. It reads where the soles are now, so build it every frame. Static: no support polygon, no dynamics. */
  balance(weight = 1): Goal {
    const middle = this.positionOf(this.get("soleL"))
      .add(this.positionOf(this.get("soleR")))
      .multiplyScalar(0.5)
    return soft(this.centerOfMass, new Target().set({ position: middle, axisWeights: new Vector3(1, 0, 1) }), weight)
  }
}

export type { Side } from "@drawcall/hand"
