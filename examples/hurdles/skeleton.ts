import { CachedRigLoader } from '@drawcall/rig'
import type { Landmarks } from '../humanoid'

/**
 * Where the hurdler's joints are, measured on her model (public/models/hurdler.glb) by cross-sections of its solid (m):
 * standing on y = 0 with her arms out and palms down, facing +z, her left at +x. She is 1.72 m to her crown, her hair in
 * a bun behind it, long in the leg, her arms nearly level, her hands turned a little ahead with the fingers spread and
 * the thumb ahead and below the index; both sides measured alike, so the right is the left mirrored.
 */
export const landmarks: Landmarks = {
  hips: [0, 0.91, -0.02],
  spine: [0, 1.03, 0.005],
  chest: [0, 1.21, 0.0],
  neck: [0, 1.44, -0.045],
  head: [0, 1.51, 0.0],
  crown: [0, 1.712, -0.01],
  left: {
    shoulder: [0.03, 1.375, -0.045],
    arm: [0.175, 1.37, -0.048],
    elbow: [0.43, 1.358, -0.05],
    wrist: [0.665, 1.361, -0.002],
    thumb: [0.69, 1.345, 0.03],
    tips: {
      thumb: [0.765, 1.295, 0.093],
      index: [0.835, 1.321, 0.062],
      middle: [0.855, 1.336, 0.032],
      ring: [0.847, 1.353, -0.003],
      little: [0.822, 1.358, -0.036],
    },
    hip: [0.095, 0.9, -0.01],
    knee: [0.133, 0.535, -0.026],
    ankle: [0.183, 0.09, -0.05],
    ball: [0.207, 0.03, 0.065],
    toe: [0.21, 0.025, 0.14],
  },
}

/**
 * The hurdler rigged to her skeleton, which is `humanoid(landmarks)` of ../humanoid written out: the vitecache plugin
 * rigs her ahead, in Node, for a load it reads as it is written.
 */
export const rig = () =>
  new CachedRigLoader().loadAsync({
    url: '/models/hurdler.glb',
    resolution: 512,
    skeleton: [
      { name: 'hips', position: [0, 0.91, -0.02] },
      { name: 'spine', parent: 'hips', position: [0, 1.03, 0.005] },
      { name: 'chest', parent: 'spine', position: [0, 1.21, 0] },
      { name: 'neck', parent: 'chest', position: [0, 1.44, -0.045] },
      { name: 'head', parent: 'neck', position: [0, 1.51, 0] },
      { name: 'head_end', parent: 'head', position: [0, 1.712, -0.01] },
      { name: 'leftShoulder', parent: 'chest', position: [0.03, 1.375, -0.045] },
      { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.175, 1.37, -0.048] },
      { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.43, 1.358, -0.05] },
      { name: 'leftHand', parent: 'leftLowerArm', position: [0.665, 1.361, -0.002] },
      { name: 'leftMiddleProximal', parent: 'leftHand', position: [0.77, 1.347, 0.017] },
      { name: 'leftMiddleIntermediate', parent: 'leftMiddleProximal', position: [0.81, 1.342, 0.024] },
      { name: 'leftMiddleDistal', parent: 'leftMiddleIntermediate', position: [0.835, 1.339, 0.028] },
      { name: 'leftMiddleDistal_end', parent: 'leftMiddleDistal', position: [0.855, 1.336, 0.032] },
      { name: 'leftIndexProximal', parent: 'leftHand', position: [0.759, 1.339, 0.033] },
      { name: 'leftIndexIntermediate', parent: 'leftIndexProximal', position: [0.794, 1.331, 0.047] },
      { name: 'leftIndexDistal', parent: 'leftIndexIntermediate', position: [0.817, 1.325, 0.055] },
      { name: 'leftIndexDistal_end', parent: 'leftIndexDistal', position: [0.835, 1.321, 0.062] },
      { name: 'leftRingProximal', parent: 'leftHand', position: [0.765, 1.357, -0.003] },
      { name: 'leftRingIntermediate', parent: 'leftRingProximal', position: [0.804, 1.355, -0.003] },
      { name: 'leftRingDistal', parent: 'leftRingIntermediate', position: [0.828, 1.354, -0.003] },
      { name: 'leftRingDistal_end', parent: 'leftRingDistal', position: [0.847, 1.353, -0.003] },
      { name: 'leftLittleProximal', parent: 'leftHand', position: [0.747, 1.359, -0.02] },
      { name: 'leftLittleIntermediate', parent: 'leftLittleProximal', position: [0.782, 1.359, -0.027] },
      { name: 'leftLittleDistal', parent: 'leftLittleIntermediate', position: [0.805, 1.358, -0.032] },
      { name: 'leftLittleDistal_end', parent: 'leftLittleDistal', position: [0.822, 1.358, -0.036] },
      { name: 'leftThumbMetacarpal', parent: 'leftHand', position: [0.69, 1.345, 0.03] },
      { name: 'leftThumbProximal', parent: 'leftThumbMetacarpal', position: [0.722, 1.324, 0.056] },
      { name: 'leftThumbDistal', parent: 'leftThumbProximal', position: [0.746, 1.308, 0.077] },
      { name: 'leftThumbDistal_end', parent: 'leftThumbDistal', position: [0.765, 1.295, 0.093] },
      { name: 'leftUpperLeg', parent: 'hips', position: [0.095, 0.9, -0.01] },
      { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.133, 0.535, -0.026] },
      { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.183, 0.09, -0.05] },
      { name: 'leftToes', parent: 'leftFoot', position: [0.207, 0.03, 0.065] },
      { name: 'leftToes_end', parent: 'leftToes', position: [0.21, 0.025, 0.14] },
      { name: 'rightShoulder', parent: 'chest', position: [-0.03, 1.375, -0.045] },
      { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.175, 1.37, -0.048] },
      { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.43, 1.358, -0.05] },
      { name: 'rightHand', parent: 'rightLowerArm', position: [-0.665, 1.361, -0.002] },
      { name: 'rightMiddleProximal', parent: 'rightHand', position: [-0.77, 1.347, 0.017] },
      { name: 'rightMiddleIntermediate', parent: 'rightMiddleProximal', position: [-0.81, 1.342, 0.024] },
      { name: 'rightMiddleDistal', parent: 'rightMiddleIntermediate', position: [-0.835, 1.339, 0.028] },
      { name: 'rightMiddleDistal_end', parent: 'rightMiddleDistal', position: [-0.855, 1.336, 0.032] },
      { name: 'rightIndexProximal', parent: 'rightHand', position: [-0.758, 1.339, 0.033] },
      { name: 'rightIndexIntermediate', parent: 'rightIndexProximal', position: [-0.794, 1.331, 0.047] },
      { name: 'rightIndexDistal', parent: 'rightIndexIntermediate', position: [-0.817, 1.325, 0.055] },
      { name: 'rightIndexDistal_end', parent: 'rightIndexDistal', position: [-0.835, 1.321, 0.062] },
      { name: 'rightRingProximal', parent: 'rightHand', position: [-0.765, 1.357, -0.003] },
      { name: 'rightRingIntermediate', parent: 'rightRingProximal', position: [-0.804, 1.355, -0.003] },
      { name: 'rightRingDistal', parent: 'rightRingIntermediate', position: [-0.828, 1.354, -0.003] },
      { name: 'rightRingDistal_end', parent: 'rightRingDistal', position: [-0.847, 1.353, -0.003] },
      { name: 'rightLittleProximal', parent: 'rightHand', position: [-0.747, 1.359, -0.02] },
      { name: 'rightLittleIntermediate', parent: 'rightLittleProximal', position: [-0.782, 1.359, -0.027] },
      { name: 'rightLittleDistal', parent: 'rightLittleIntermediate', position: [-0.805, 1.358, -0.032] },
      { name: 'rightLittleDistal_end', parent: 'rightLittleDistal', position: [-0.822, 1.358, -0.036] },
      { name: 'rightThumbMetacarpal', parent: 'rightHand', position: [-0.69, 1.345, 0.03] },
      { name: 'rightThumbProximal', parent: 'rightThumbMetacarpal', position: [-0.721, 1.324, 0.056] },
      { name: 'rightThumbDistal', parent: 'rightThumbProximal', position: [-0.745, 1.308, 0.077] },
      { name: 'rightThumbDistal_end', parent: 'rightThumbDistal', position: [-0.765, 1.295, 0.093] },
      { name: 'rightUpperLeg', parent: 'hips', position: [-0.095, 0.9, -0.01] },
      { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.133, 0.535, -0.026] },
      { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.183, 0.09, -0.05] },
      { name: 'rightToes', parent: 'rightFoot', position: [-0.207, 0.03, 0.065] },
      { name: 'rightToes_end', parent: 'rightToes', position: [-0.21, 0.025, 0.14] },
    ],
  })
