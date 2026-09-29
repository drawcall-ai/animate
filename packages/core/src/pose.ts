import { Vector3 } from 'three';

export const JOINTS = [
  'pelvis',
  'spine',
  'chest',
  'neck',
  'headBase',
  'headCenter',
  'headTop',
  'nose',
  'leftEye',
  'rightEye',
  'leftEar',
  'rightEar',
  'leftShoulder',
  'leftElbow',
  'leftWrist',
  'rightShoulder',
  'rightElbow',
  'rightWrist',
  'leftHip',
  'leftKnee',
  'leftAnkle',
  'leftHeel',
  'leftBigToe',
  'leftSmallToe',
  'rightHip',
  'rightKnee',
  'rightAnkle',
  'rightHeel',
  'rightBigToe',
  'rightSmallToe',
] as const;

export type JointName = (typeof JOINTS)[number];
export type Pose = Record<JointName, Vector3>;

export function createPose(): Pose {
  const p = {} as Pose;
  for (const j of JOINTS) p[j] = new Vector3();
  return p;
}

/** OpenPose BODY_25 keypoint order. */
export const BODY25_KEYPOINTS: readonly JointName[] = [
  'nose',
  'neck',
  'rightShoulder',
  'rightElbow',
  'rightWrist',
  'leftShoulder',
  'leftElbow',
  'leftWrist',
  'pelvis', // MidHip
  'rightHip',
  'rightKnee',
  'rightAnkle',
  'leftHip',
  'leftKnee',
  'leftAnkle',
  'rightEye',
  'leftEye',
  'rightEar',
  'leftEar',
  'leftBigToe',
  'leftSmallToe',
  'leftHeel',
  'rightBigToe',
  'rightSmallToe',
  'rightHeel',
];

/** BODY_25 limb pairs in OpenPose render order. */
export const BODY25_PAIRS: readonly [number, number][] = [
  [1, 8], [1, 2], [1, 5], [2, 3], [3, 4], [5, 6], [6, 7], [8, 9], [9, 10], [10, 11], [8, 12], [12, 13],
  [13, 14], [1, 0], [0, 15], [15, 17], [0, 16], [16, 18], [14, 19], [19, 20], [14, 21], [11, 22], [22, 23], [11, 24],
];

/** OpenPose BODY_25 per-keypoint RGB colours; a limb uses the colour of its child keypoint. */
export const BODY25_COLORS: readonly [number, number, number][] = [
  [255, 0, 85], [255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0], [85, 255, 0], [0, 255, 0],
  [255, 0, 0], [0, 255, 85], [0, 255, 170], [0, 255, 255], [0, 170, 255], [0, 85, 255], [0, 0, 255], [255, 0, 170],
  [170, 0, 255], [255, 0, 255], [85, 0, 255], [0, 0, 255], [0, 0, 255], [0, 0, 255], [0, 255, 255], [0, 255, 255],
  [0, 255, 255],
];

/** BODY_25 keypoints as [x, y, z] triples. */
export function toBody25(pose: Pose): [number, number, number][] {
  return BODY25_KEYPOINTS.map((j) => [pose[j].x, pose[j].y, pose[j].z]);
}
