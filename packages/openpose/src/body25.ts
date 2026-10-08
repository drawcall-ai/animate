import { Vector3, type Object3D } from 'three';
import type { CharacterModel } from '@pmndrs/viverse';

/**
 * OpenPose BODY_25 keypoints in order, as the nodes of a character model a Humanoid drives:
 * its VRM-named bones and the landmarks the Humanoid adds.
 */
export const BODY25_KEYPOINTS = [
  'nose',
  'neck',
  'rightUpperArm', // RShoulder
  'rightLowerArm', // RElbow
  'rightHand', // RWrist
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'hips', // MidHip
  'rightUpperLeg', // RHip
  'rightLowerLeg', // RKnee
  'rightFoot', // RAnkle
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
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
] as const;

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

/** The model's BODY_25 keypoint nodes, in order. */
export function keypointsOf(model: CharacterModel): Object3D[] {
  return BODY25_KEYPOINTS.map((name) => {
    const node = model.scene.getObjectByName(name);
    if (!node) throw new Error(`character model has no ${name}: drive it with a Humanoid (the landmarks come with it); bones are read by their VRM names`);
    return node;
  });
}

/** The model's BODY_25 keypoints as world [x, y, z] triples. */
export function toBody25(model: CharacterModel): [number, number, number][] {
  return keypointsOf(model).map((node) => node.getWorldPosition(new Vector3()).toArray());
}
