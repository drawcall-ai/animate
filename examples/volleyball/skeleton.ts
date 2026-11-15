import { CachedRigLoader } from '@drawcall/rig'
import type { Landmarks } from '../humanoid'

/**
 * Where the spiker's joints are, measured on her model (public/models/spiker.glb) by cross-sections of its solid (m):
 * standing on y = 0 with her arms out and palms down, facing +z, her left at +x. She is 1.82 m to the top of her
 * head, her hair in a bun at the back of it, her arms a little below level, knee pads over her knees, her fingers
 * spread and the thumb ahead under the index; both sides measured alike, so the right is the left mirrored.
 */
export const landmarks: Landmarks = {
  hips: [0, 0.96, -0.025],
  spine: [0, 1.07, -0.01],
  chest: [0, 1.21, -0.02],
  neck: [0, 1.525, -0.05],
  head: [0, 1.575, -0.01],
  crown: [0, 1.805, -0.02],
  left: {
    shoulder: [0.04, 1.47, -0.05],
    arm: [0.18, 1.455, -0.055],
    elbow: [0.46, 1.426, -0.065],
    wrist: [0.7, 1.427, -0.022],
    thumb: [0.745, 1.39, 0.025],
    tips: {
      thumb: [0.804, 1.364, 0.082],
      index: [0.887, 1.39, 0.034],
      middle: [0.907, 1.407, 0.006],
      ring: [0.897, 1.418, -0.029],
      little: [0.876, 1.442, -0.054],
    },
    hip: [0.09, 0.945, -0.02],
    knee: [0.157, 0.53, -0.03],
    ankle: [0.205, 0.09, -0.06],
    ball: [0.218, 0.035, 0.06],
    toe: [0.225, 0.03, 0.16],
  },
}

/**
 * The spiker rigged to her skeleton, which is `humanoid(landmarks)` of ../humanoid written out: the vitecache plugin
 * rigs her ahead, in Node, for a load it reads as it is written.
 */
export const rig = () =>
  new CachedRigLoader().loadAsync({
    url: '/models/spiker.glb',
    resolution: 512,
    skeleton: [
      { name: 'hips', position: [0, 0.96, -0.025] },
      { name: 'spine', parent: 'hips', position: [0, 1.07, -0.01] },
      { name: 'chest', parent: 'spine', position: [0, 1.21, -0.02] },
      { name: 'neck', parent: 'chest', position: [0, 1.525, -0.05] },
      { name: 'head', parent: 'neck', position: [0, 1.575, -0.01] },
      { name: 'head_end', parent: 'head', position: [0, 1.805, -0.02] },
      { name: 'leftShoulder', parent: 'chest', position: [0.04, 1.47, -0.05] },
      { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.18, 1.455, -0.055] },
      { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.46, 1.426, -0.065] },
      { name: 'leftHand', parent: 'leftLowerArm', position: [0.7, 1.427, -0.022] },
      { name: 'leftMiddleProximal', parent: 'leftHand', position: [0.814, 1.416, -0.007] },
      { name: 'leftMiddleIntermediate', parent: 'leftMiddleProximal', position: [0.858, 1.412, -0.001] },
      { name: 'leftMiddleDistal', parent: 'leftMiddleIntermediate', position: [0.886, 1.409, 0.003] },
      { name: 'leftMiddleDistal_end', parent: 'leftMiddleDistal', position: [0.907, 1.407, 0.006] },
      { name: 'leftIndexProximal', parent: 'leftHand', position: [0.803, 1.407, 0.009] },
      { name: 'leftIndexIntermediate', parent: 'leftIndexProximal', position: [0.842, 1.399, 0.021] },
      { name: 'leftIndexDistal', parent: 'leftIndexIntermediate', position: [0.868, 1.394, 0.028] },
      { name: 'leftIndexDistal_end', parent: 'leftIndexDistal', position: [0.887, 1.39, 0.034] },
      { name: 'leftRingProximal', parent: 'leftHand', position: [0.808, 1.422, -0.026] },
      { name: 'leftRingIntermediate', parent: 'leftRingProximal', position: [0.85, 1.42, -0.027] },
      { name: 'leftRingDistal', parent: 'leftRingIntermediate', position: [0.877, 1.419, -0.028] },
      { name: 'leftRingDistal_end', parent: 'leftRingDistal', position: [0.897, 1.418, -0.029] },
      { name: 'leftLittleProximal', parent: 'leftHand', position: [0.792, 1.435, -0.039] },
      { name: 'leftLittleIntermediate', parent: 'leftLittleProximal', position: [0.831, 1.438, -0.046] },
      { name: 'leftLittleDistal', parent: 'leftLittleIntermediate', position: [0.857, 1.44, -0.05] },
      { name: 'leftLittleDistal_end', parent: 'leftLittleDistal', position: [0.876, 1.442, -0.054] },
      { name: 'leftThumbMetacarpal', parent: 'leftHand', position: [0.745, 1.39, 0.025] },
      { name: 'leftThumbProximal', parent: 'leftThumbMetacarpal', position: [0.77, 1.379, 0.049] },
      { name: 'leftThumbDistal', parent: 'leftThumbProximal', position: [0.789, 1.371, 0.067] },
      { name: 'leftThumbDistal_end', parent: 'leftThumbDistal', position: [0.804, 1.364, 0.082] },
      { name: 'leftUpperLeg', parent: 'hips', position: [0.09, 0.945, -0.02] },
      { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.157, 0.53, -0.03] },
      { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.205, 0.09, -0.06] },
      { name: 'leftToes', parent: 'leftFoot', position: [0.218, 0.035, 0.06] },
      { name: 'leftToes_end', parent: 'leftToes', position: [0.225, 0.03, 0.16] },
      { name: 'rightShoulder', parent: 'chest', position: [-0.04, 1.47, -0.05] },
      { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.18, 1.455, -0.055] },
      { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.46, 1.426, -0.065] },
      { name: 'rightHand', parent: 'rightLowerArm', position: [-0.7, 1.427, -0.022] },
      { name: 'rightMiddleProximal', parent: 'rightHand', position: [-0.814, 1.416, -0.007] },
      { name: 'rightMiddleIntermediate', parent: 'rightMiddleProximal', position: [-0.858, 1.412, -0.001] },
      { name: 'rightMiddleDistal', parent: 'rightMiddleIntermediate', position: [-0.886, 1.409, 0.003] },
      { name: 'rightMiddleDistal_end', parent: 'rightMiddleDistal', position: [-0.907, 1.407, 0.006] },
      { name: 'rightIndexProximal', parent: 'rightHand', position: [-0.803, 1.407, 0.009] },
      { name: 'rightIndexIntermediate', parent: 'rightIndexProximal', position: [-0.842, 1.399, 0.021] },
      { name: 'rightIndexDistal', parent: 'rightIndexIntermediate', position: [-0.868, 1.394, 0.028] },
      { name: 'rightIndexDistal_end', parent: 'rightIndexDistal', position: [-0.887, 1.39, 0.034] },
      { name: 'rightRingProximal', parent: 'rightHand', position: [-0.808, 1.422, -0.026] },
      { name: 'rightRingIntermediate', parent: 'rightRingProximal', position: [-0.85, 1.42, -0.027] },
      { name: 'rightRingDistal', parent: 'rightRingIntermediate', position: [-0.877, 1.419, -0.028] },
      { name: 'rightRingDistal_end', parent: 'rightRingDistal', position: [-0.897, 1.418, -0.029] },
      { name: 'rightLittleProximal', parent: 'rightHand', position: [-0.792, 1.435, -0.039] },
      { name: 'rightLittleIntermediate', parent: 'rightLittleProximal', position: [-0.831, 1.438, -0.046] },
      { name: 'rightLittleDistal', parent: 'rightLittleIntermediate', position: [-0.857, 1.44, -0.05] },
      { name: 'rightLittleDistal_end', parent: 'rightLittleDistal', position: [-0.876, 1.442, -0.054] },
      { name: 'rightThumbMetacarpal', parent: 'rightHand', position: [-0.745, 1.39, 0.025] },
      { name: 'rightThumbProximal', parent: 'rightThumbMetacarpal', position: [-0.77, 1.379, 0.049] },
      { name: 'rightThumbDistal', parent: 'rightThumbProximal', position: [-0.789, 1.371, 0.067] },
      { name: 'rightThumbDistal_end', parent: 'rightThumbDistal', position: [-0.804, 1.364, 0.082] },
      { name: 'rightUpperLeg', parent: 'hips', position: [-0.09, 0.945, -0.02] },
      { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.157, 0.53, -0.03] },
      { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.205, 0.09, -0.06] },
      { name: 'rightToes', parent: 'rightFoot', position: [-0.218, 0.035, 0.06] },
      { name: 'rightToes_end', parent: 'rightToes', position: [-0.225, 0.03, 0.16] },
    ],
  })
