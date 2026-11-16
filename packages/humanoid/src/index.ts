// A procedural humanoid as three.js bones: 1.75 m, 70 kg, 48 degrees of freedom. Neutral pose: standing, arms
// hanging. Every bone frame is world-aligned in the zero pose: +X left, +Y up, +Z forward. Each joint is a short
// sequence of hinges with box limits (rad). An approximation, not anatomy: 48 DOF, two spine joints, no scapula,
// fingers or toes, ranges from typical values, Euler hinges with independent box limits.

import { Body, type Goal, type Hinge, joint, mark, type Pose, soft, Target } from "@drawcall/ik"
import { Bone, type Object3D, Quaternion, Vector3 } from "three"

const X = new Vector3(1, 0, 0),
  Y = new Vector3(0, 1, 0),
  Z = new Vector3(0, 0, 1)
const hinge = (axis: Vector3, min: number, max: number): Hinge => ({ axis, min, max })
const V = (x: number, y: number, z: number) => new Vector3(x, y, z)

/** Body build. `girth` runs from 0 (slim) to 1 (heavy): a bigger trunk and bulkier arms leave less room to fold the arms in. */
export interface Build {
  girth?: number
  /**
   * A rigged skeleton to use instead of building one (a @drawcall/rig result's object, say): bones with the VRM
   * humanoid names (hips, spine, chest, neck, head, leftShoulder, leftUpperArm, leftLowerArm, leftHand, leftUpperLeg,
   * leftLowerLeg, leftFoot and the right ones) in a T-pose, standing on y = 0 and facing +Z, unscaled. The body gets
   * its proportions, and its bones are hung on the body's, so whatever is skinned to them follows: put the body's
   * root and the rigged object into the same parent.
   */
  skeleton?: Object3D
}
const RIGGED: Record<string, string> = { pelvis: "hips", forearm: "LowerArm", thigh: "UpperLeg", shin: "LowerLeg" }
const rigged = (name: string) => {
  const side = /[LR]$/.test(name) ? (name.endsWith("L") ? "left" : "right") : "",
    part = side ? name.slice(0, -1) : name
  return side ? side + (RIGGED[part] ?? part[0].toUpperCase() + part.slice(1)) : (RIGGED[part] ?? part)
}

/**
 * Builds the skeleton and its Body. Bones: pelvis (root), spine, chest, neck, head, and per side (L / R) shoulder,
 * upperArm, forearm, hand, thigh, shin, foot. Marked points: `eyes` (looking along +Z) and per side `sole` (under
 * the foot, with `heel` and `ball` behind and ahead of it), `fist` (centre of the closed hand) and `palm` (turned so that, with the forearm held forward, +Y is up
 * and +Z forward). A bone is a point too: `body.get("chest")`.
 */
export function createHumanoid(build: Build = {}): Body {
  const girth = Math.min(1, Math.max(0, build.girth ?? 0))
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
  const found = new Map(NAMES.map((name) => [name, build.skeleton?.getObjectByName(rigged(name))])) // before any is moved
  const given = (name: string) => found.get(name)
  build.skeleton?.updateWorldMatrix(true, true)
  const ankle = given("footL")?.getWorldPosition(V(0, 0, 0)).y ?? 0.06 // how high the ankle is over the sole
  const turnOf = (o: Object3D) => (o.updateWorldMatrix(true, false), o.getWorldQuaternion(new Quaternion()))
  // A bone at its place. With a rigged skeleton the place is the rigged joint's, and the rigged bone is hung on the
  // new one (after turning it so that the limb hangs down, or the foot lies flat, as the neutral pose has them): the
  // body's own bones stay world-aligned whatever the rig's are, and the skinned mesh follows through the scene graph.
  const bone = (name: string, parent: Bone | null, at: Vector3, hinges: Hinge[], mass: number, com: Vector3, neutral: number[] = [], next?: string) => {
    const b = new Bone(),
      rig = given(name)
    b.name = name
    b.position.copy(rig ? rig.getWorldPosition(V(0, 0, 0)) : at)
    if (rig && parent) parent.worldToLocal(b.position)
    parent?.add(b)
    if (rig) {
      const above = turnOf(rig.parent!),
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
    joint(b, hinges, neutral, mass, com)
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
    const shin = bone("shin" + S, thigh, V(0, -0.43, 0), [hinge(X, 0.06, 2.4)], 3.26, V(0, -0.2, 0), [0.1], "foot" + S)
    // Ankle: dorsi/plantar flexion, inversion/eversion.
    const foot = bone("foot" + S, shin, V(0, -0.42, 0), [hinge(X, -0.7, 0.6), hinge(Z, -0.35, 0.35)], 1.02, V(0, -0.04, 0.05), [-0.05, 0])
    mark(foot, "sole" + S, V(0, -ankle, 0.04))
    mark(foot, "heel" + S, V(0, -ankle, -0.05)) // what it lands on in a walk
    mark(foot, "ball" + S, V(0, -ankle, 0.13)) // what it pushes off from
  }
  return new Body(pelvis)
}

/** Trunk, head and legs in the neutral standing pose; the arms are left out, so they are free to work. */
export function upright(body: Body): Pose {
  const pose: Pose = {},
    neutral = body.pose()
  for (const name of ["spine", "chest", "neck", "head", "thighL", "shinL", "footL", "thighR", "shinR", "footR"]) {
    const chain = body.chain(body.get(name)),
      hinges = (body.get(name).userData.hinges as Hinge[]).length
    pose[name] = chain.slice(-hinges).map((k) => neutral[k])
  }
  return pose
}

/** Balance as an ordinary soft goal for this frame: the centre of mass over the middle of the soles, horizontally. Static: no support polygon, no dynamics. */
export function balance(body: Body, weight = 1): Goal {
  const middle = body
    .positionOf(body.get("soleL"))
    .add(body.positionOf(body.get("soleR")))
    .multiplyScalar(0.5)
  return soft(body.centre, new Target().set({ position: middle, axes: new Vector3(1, 0, 1) }), weight)
}
