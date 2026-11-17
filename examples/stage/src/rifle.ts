// The PAC-9 rifle (the Drawcall market asset pac9-rifle) as one group of meshes, in the asset's frame: metres, the
// muzzle towards -Z, up +Y, its right +X, the barrel's axis through the origin. How the soldier's hands take hold of
// it, and how he carries it at low ready.

import { grip, type GripOptions, type Hand, HandPose, type Humanoid, mark, type Pose, type Side } from "@drawcall/animate"
import { Color, Group, Matrix4, Mesh, MeshStandardMaterial, type Object3D, Quaternion, Vector3 } from "three"
import { buildRifleParts, RIFLE } from "./pac9-rifle/rifle-geometry"

/** The right face of the trigger's blade, low on it, where the index's pad presses it. */
const TRIGGER = new Vector3(0.0032, -0.08, 0.002)
export const MUZZLE = new Vector3(...RIFLE.muzzle)
/** The pistol grip, a little ahead of its middle so that the index reaches the trigger and low enough that the middle
 * finger closes round it below the trigger guard as far as the ring finger does (fingers side by side bent alike keep
 * the glove's skin between them whole), and the way up the grip (it leans forward). */
const GRIP = new Vector3(0, -0.12, 0.065)
const GRIP_UP = new Vector3(0, 0.97, -0.25).normalize()
/** The underside of the handguard, mid-way between the receiver and the block hanging under it. */
const HANDGUARD = new Vector3(0, -RIFLE.handguardRadius, -0.17)

/** How the hands take hold: the right palm round the pistol grip from its right and behind, the knuckles up it, the
 * index out of the way; the left round the handguard from below, the knuckles along it toward the muzzle. */
const GRIPS = {
  right: {
    at: GRIP,
    approachFrom: new Vector3(1, 0, 0.5).normalize(),
    thumbToward: GRIP_UP,
    using: ["palm", "thumb", "middle", "ring", "little"],
    idlePose: HandPose.pointing,
  },
  left: { at: HANDGUARD, approachFrom: new Vector3(0, -1, 0), thumbToward: new Vector3(0, 0, -1) },
} satisfies Record<Side, GripOptions>

/** How the hands hold the rifle: the right round the pistol grip (`pistol`) and then its index on the trigger (`right`),
 * the left round the handguard (`left`); and each hand bone's place on the rifle (`seats`), the marks `Humanoid.hold`
 * attaches the hands at. */
export function gripRifle(hands: Record<Side, Hand>, rifle: Object3D) {
  const pistol = grip(hands.right, rifle, GRIPS.right)
  const grips = { right: grip(hands.right, rifle, { at: TRIGGER, using: ["index"], on: pistol }), left: grip(hands.left, rifle, GRIPS.left), pistol }
  const seats = {
    right: mark(rifle, "seatR", grips.right.position, grips.right.quaternion),
    left: mark(rifle, "seatL", grips.left.position, grips.left.quaternion),
  }
  return { grips, seats }
}

/** The arms at low ready, made by solving them for the rifle there with the trunk upright and the elbows drawn out from
 * the body: a posture to go with it. */
export const LOW_READY: Pose = {
  shoulderL: [-0.15, 0],
  upperArmL: [-1.07, 0.07, 0.81],
  forearmL: [0, 0.93],
  handL: [0.29, -0.4],
  shoulderR: [0.21, 0],
  upperArmR: [-0.3, -0.21, 0.55],
  forearmR: [-1.51, -0.48],
  handR: [0.37, -0.23],
}

/** Where the end of the stock is at low ready: a mark on the pelvis, the muzzle down and across the body (+X is his left). */
export function lowReady(body: Humanoid): Object3D {
  const across = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(), new Vector3(0.6, -0.4, 0.6), new Vector3(0, 1, 0)))
  return mark(body.get("pelvis"), "lowReady", new Vector3(-0.1, 0.5, 0.1), across)
}

// the asset's base colours (linear) and finishes; its geometry carries a colour multiplier per vertex
const finish = (rgb: [number, number, number], roughness: number, metalness = 0) =>
  new MeshStandardMaterial({ color: new Color().setRGB(...rgb), roughness, metalness, vertexColors: true })
const FINISHES = [
  ["anodized", finish([0.0085, 0.009, 0.0105], 0.4, 0.45)],
  ["steel", finish([0.016, 0.016, 0.0165], 0.5, 0.7)],
  ["polymer", finish([0.0125, 0.0128, 0.0135], 0.62)],
  ["rubber", finish([1, 1, 1], 0.92)],
  ["bolt", finish([0.016, 0.016, 0.0165], 0.5, 0.7)],
  ["magazine", finish([0.105, 0.08, 0.05], 0.62)],
  ["rounds", finish([0.75, 0.52, 0.22], 0.35, 1)],
] as const

/** The rifle, and the end of its stock on the barrel's axis (`butt`), which goes into the shoulder. */
export function createRifle(): { rifle: Group; butt: Object3D } {
  const rifle = new Group(),
    magazine = new Group()
  rifle.name = "rifle"
  rifle.userData.mass = 3.5
  const parts = buildRifleParts()
  for (const [name, material] of FINISHES) {
    const mesh = new Mesh(parts[name], material)
    if (name === "magazine" || name === "rounds") magazine.add(mesh)
    else rifle.add(mesh)
  }
  magazine.position.fromArray(RIFLE.magazineOffset) // the magazine and its rounds sit in the well
  rifle.add(magazine)
  return { rifle, butt: mark(rifle, "butt", new Vector3(0, 0, 0.347)) }
}
