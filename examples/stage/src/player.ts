// The tennis player: a generated model (models/player.glb) rigged by @drawcall/rig to a skeleton measured on it. He
// stands on y = 0 in a T-pose facing +z, 1.85 m to his crown.

import type { RigResult, SkeletonBone } from "@drawcall/rig"
import { rig } from "./rig"

/** The tennis player, rigged afresh on each load. Load him as `new CachedPlayerLoader().loadAsync()`, written out, so
 * that the vitecache plugin finds the load and computes his skin weights ahead. */
export class CachedPlayerLoader {
  loadAsync(): Promise<RigResult> {
    return rig(new URL("../models/player.glb", import.meta.url).href, SKELETON)
  }
}

const SKELETON: SkeletonBone[] = [
  { name: "hips", position: [0, 0.91, -0.01] },
  { name: "spine", parent: "hips", position: [0, 1.02, -0.01] },
  { name: "chest", parent: "spine", position: [0, 1.22, -0.025] },
  { name: "neck", parent: "chest", position: [0, 1.56, -0.05] },
  { name: "head", parent: "neck", position: [0, 1.64, -0.005] },
  { name: "head_end", parent: "head", position: [0, 1.845, 0.005] },
  { name: "leftShoulder", parent: "chest", position: [0.04, 1.495, -0.055] },
  { name: "leftUpperArm", parent: "leftShoulder", position: [0.19, 1.46, -0.062] },
  { name: "leftLowerArm", parent: "leftUpperArm", position: [0.46, 1.445, -0.059] },
  { name: "leftHand", parent: "leftLowerArm", position: [0.7, 1.427, 0.041] },
  { name: "leftMiddleProximal", parent: "leftHand", position: [0.808, 1.414, 0.102] },
  { name: "leftMiddleIntermediate", parent: "leftMiddleProximal", position: [0.849, 1.413, 0.118] },
  { name: "leftMiddleDistal", parent: "leftMiddleIntermediate", position: [0.876, 1.411, 0.13] },
  { name: "leftMiddleDistal_end", parent: "leftMiddleDistal", position: [0.897, 1.412, 0.136] },
  { name: "leftIndexProximal", parent: "leftHand", position: [0.796, 1.409, 0.125] },
  { name: "leftIndexIntermediate", parent: "leftIndexProximal", position: [0.832, 1.401, 0.146] },
  { name: "leftIndexDistal", parent: "leftIndexIntermediate", position: [0.855, 1.392, 0.159] },
  { name: "leftIndexDistal_end", parent: "leftIndexDistal", position: [0.872, 1.388, 0.164] },
  { name: "leftRingProximal", parent: "leftHand", position: [0.809, 1.415, 0.077] },
  { name: "leftRingIntermediate", parent: "leftRingProximal", position: [0.852, 1.415, 0.087] },
  { name: "leftRingDistal", parent: "leftRingIntermediate", position: [0.878, 1.414, 0.092] },
  { name: "leftRingDistal_end", parent: "leftRingDistal", position: [0.9, 1.416, 0.097] },
  { name: "leftLittleProximal", parent: "leftHand", position: [0.796, 1.413, 0.054] },
  { name: "leftLittleIntermediate", parent: "leftLittleProximal", position: [0.834, 1.413, 0.055] },
  { name: "leftLittleDistal", parent: "leftLittleIntermediate", position: [0.86, 1.413, 0.056] },
  { name: "leftLittleDistal_end", parent: "leftLittleDistal", position: [0.882, 1.413, 0.057] },
  { name: "leftThumbMetacarpal", parent: "leftHand", position: [0.735, 1.4, 0.09] },
  { name: "leftThumbProximal", parent: "leftThumbMetacarpal", position: [0.758, 1.387, 0.125] },
  { name: "leftThumbDistal", parent: "leftThumbProximal", position: [0.781, 1.371, 0.155] },
  { name: "leftThumbDistal_end", parent: "leftThumbDistal", position: [0.787, 1.367, 0.177] },
  { name: "leftUpperLeg", parent: "hips", position: [0.095, 0.895, -0.01] },
  { name: "leftLowerLeg", parent: "leftUpperLeg", position: [0.16, 0.52, -0.05] },
  { name: "leftFoot", parent: "leftLowerLeg", position: [0.205, 0.095, -0.065] },
  { name: "leftToes", parent: "leftFoot", position: [0.22, 0.035, 0.065] },
  { name: "leftToes_end", parent: "leftToes", position: [0.225, 0.03, 0.165] },
  { name: "rightShoulder", parent: "chest", position: [-0.04, 1.495, -0.055] },
  { name: "rightUpperArm", parent: "rightShoulder", position: [-0.19, 1.46, -0.062] },
  { name: "rightLowerArm", parent: "rightUpperArm", position: [-0.46, 1.445, -0.059] },
  { name: "rightHand", parent: "rightLowerArm", position: [-0.7, 1.427, 0.041] },
  { name: "rightMiddleProximal", parent: "rightHand", position: [-0.808, 1.414, 0.102] },
  { name: "rightMiddleIntermediate", parent: "rightMiddleProximal", position: [-0.849, 1.413, 0.118] },
  { name: "rightMiddleDistal", parent: "rightMiddleIntermediate", position: [-0.876, 1.411, 0.13] },
  { name: "rightMiddleDistal_end", parent: "rightMiddleDistal", position: [-0.897, 1.412, 0.136] },
  { name: "rightIndexProximal", parent: "rightHand", position: [-0.796, 1.409, 0.125] },
  { name: "rightIndexIntermediate", parent: "rightIndexProximal", position: [-0.832, 1.401, 0.146] },
  { name: "rightIndexDistal", parent: "rightIndexIntermediate", position: [-0.855, 1.392, 0.159] },
  { name: "rightIndexDistal_end", parent: "rightIndexDistal", position: [-0.872, 1.388, 0.164] },
  { name: "rightRingProximal", parent: "rightHand", position: [-0.809, 1.415, 0.077] },
  { name: "rightRingIntermediate", parent: "rightRingProximal", position: [-0.852, 1.415, 0.087] },
  { name: "rightRingDistal", parent: "rightRingIntermediate", position: [-0.878, 1.414, 0.092] },
  { name: "rightRingDistal_end", parent: "rightRingDistal", position: [-0.9, 1.416, 0.097] },
  { name: "rightLittleProximal", parent: "rightHand", position: [-0.796, 1.413, 0.054] },
  { name: "rightLittleIntermediate", parent: "rightLittleProximal", position: [-0.834, 1.413, 0.055] },
  { name: "rightLittleDistal", parent: "rightLittleIntermediate", position: [-0.86, 1.413, 0.056] },
  { name: "rightLittleDistal_end", parent: "rightLittleDistal", position: [-0.882, 1.413, 0.057] },
  { name: "rightThumbMetacarpal", parent: "rightHand", position: [-0.735, 1.4, 0.09] },
  { name: "rightThumbProximal", parent: "rightThumbMetacarpal", position: [-0.758, 1.387, 0.125] },
  { name: "rightThumbDistal", parent: "rightThumbProximal", position: [-0.781, 1.371, 0.155] },
  { name: "rightThumbDistal_end", parent: "rightThumbDistal", position: [-0.787, 1.367, 0.177] },
  { name: "rightUpperLeg", parent: "hips", position: [-0.095, 0.895, -0.01] },
  { name: "rightLowerLeg", parent: "rightUpperLeg", position: [-0.16, 0.52, -0.05] },
  { name: "rightFoot", parent: "rightLowerLeg", position: [-0.205, 0.095, -0.065] },
  { name: "rightToes", parent: "rightFoot", position: [-0.22, 0.035, 0.065] },
  { name: "rightToes_end", parent: "rightToes", position: [-0.225, 0.03, 0.165] },
]
