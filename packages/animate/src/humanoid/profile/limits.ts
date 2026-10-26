import { Quaternion, Vector3 } from 'three';
import type { Limit } from '../../core/skeleton';
import { CHILD_BONES, INDEX, type ChildBone } from '../bones';

const DEG = Math.PI / 180;

/** a range in degrees: the twist about `axis`, the swings about the next two axes in turn */
const range = (axis: 0 | 1 | 2, a: [number, number], b: [number, number], twist: [number, number], neutral?: Quaternion) => ({ axis, swing: [a, b], twist, neutral }) satisfies Omit<Limit, 'bone'>;

/**
 * Each joint's range of motion (°, the left side's; the right mirrors it), in the bone's parent's
 * frame from the T-pose (the shoulder's from the arm hanging). Clinical norms of active motion
 * (AAOS: Greene & Heckman 1994; Norkin & White 2016), signs by the right-hand rule about +x
 * (left), +y (up), +z (forward):
 * - spine (lumbar) and chest (thoracic), each half of the thoracolumbar spine's flexion 80°,
 *   extension 25° (30 here), lateral flexion 35° (40) and rotation 45° (50): about x − extension,
 *   + flexion; z ± lateral flexion; y ± rotation
 * - neck and head, each half of the cervical spine's flexion 60°, extension 80°, lateral flexion
 *   50° and rotation 75° (Youdas 1992; AAOS gives 45°, 45°, 45° and 60°)
 * - clavicle (sternoclavicular; Levangie & Norkin 2011): about z depression 15° … elevation 45°;
 *   y protraction … retraction 30°; about its own axis, x: posterior rotation 50° … 10°
 * - shoulder, from the arm hanging: about z adduction (across the body) 40° … abduction 180°;
 *   x flexion 180° … extension 60°; about its axis, y: internal rotation 70° … external 90°
 * - elbow: about y flexion 150° … hyperextension 5°; z ±5° (a hinge); x half of the forearm's
 *   pronation and supination (80° each), the hand turning the other half
 * - wrist: about y radial deviation 20° … ulnar 30°; z flexion 80° … extension 70°; x the other half
 * - hip: about x flexion 120° … extension 30°; z adduction 30° … abduction 45°; y internal …
 *   external rotation 45°
 * - knee: about x hyperextension 5° … flexion 155° (a full squat's, thigh on calf: Hemmerich
 *   2006; active 135°); z ±5° (a hinge); y tibial rotation ±30°
 * - ankle, about the shank: x dorsiflexion 40° (bearing weight, a lunge: Bennell 1998; 20°
 *   unloaded) … plantarflexion 50°; z inversion 35° … eversion 15°; y the foot turned in or out
 *   (ab- and adduction of the ankle and foot together) ±20°
 * - toes (first MTP): about x extension 70° … flexion 45°; y, about their own axis z: ±10°
 */
/** Comfortable total cervical flexion, shared by neck and head (degrees). */
export const NECK_PITCH = 60;
/** Total cervical extension from the clinical range above (degrees). */
const NECK_EXTENSION = 80;
/** Total thoracolumbar flexion, shared by spine and chest (degrees). */
const TRUNK_PITCH = 80;

/** The knee's most flexion (degrees). */
export const KNEE_FLEXION = 155;

const RANGES = {
  spine: range(1, [-20, 20], [-15, TRUNK_PITCH / 2], [-25, 25]),
  chest: range(1, [-20, 20], [-15, TRUNK_PITCH / 2], [-25, 25]),
  neck: range(1, [-25, 25], [-NECK_EXTENSION / 2, NECK_PITCH / 2], [-37, 37]),
  head: range(1, [-25, 25], [-NECK_EXTENSION / 2, NECK_PITCH / 2], [-37, 37]),
  shoulder: range(0, [-30, 30], [-15, 45], [-50, 10]),
  upperArm: range(1, [-40, 180], [-180, 60], [-70, 90], new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2)),
  lowerArm: range(0, [-150, 5], [-5, 5], [-45, 45]),
  hand: range(0, [-20, 30], [-80, 70], [-45, 45]),
  upperLeg: range(1, [-30, 45], [-120, 30], [-45, 45]),
  lowerLeg: range(1, [-5, 5], [-5, KNEE_FLEXION], [-30, 30]),
  foot: range(1, [-35, 15], [-40, 50], [-20, 20]),
  toes: range(2, [-70, 45], [-10, 10], [-10, 10]),
};

type Joint = keyof typeof RANGES;
const JOINT_OF: Record<ChildBone, Joint> = {
  spine: 'spine',
  chest: 'chest',
  neck: 'neck',
  head: 'head',
  leftShoulder: 'shoulder',
  leftUpperArm: 'upperArm',
  leftLowerArm: 'lowerArm',
  leftHand: 'hand',
  rightShoulder: 'shoulder',
  rightUpperArm: 'upperArm',
  rightLowerArm: 'lowerArm',
  rightHand: 'hand',
  leftUpperLeg: 'upperLeg',
  leftLowerLeg: 'lowerLeg',
  leftFoot: 'foot',
  leftToes: 'toes',
  rightUpperLeg: 'upperLeg',
  rightLowerLeg: 'lowerLeg',
  rightFoot: 'foot',
  rightToes: 'toes',
};

const rad = ([lo, hi]: [number, number]): [number, number] => [lo * DEG, hi * DEG];
/** a range about an axis, mirrored to the right side: the reflection across x negates turns about y and z */
const side = (r: [number, number], axis: number, right: boolean): [number, number] => (right && axis !== 0 ? [-r[1], -r[0]] : r);

/**
 * The human ranges of motion of every joint but the root (the hips) as the skeleton's limits:
 * each bone's rotation in its parent's frame (swing–twist).
 */
export function ranges(): Limit[] {
  return CHILD_BONES.map((bone) => {
    const r = RANGES[JOINT_OF[bone]];
    const right = bone.startsWith('right');
    const j = (r.axis + 1) % 3;
    const k = (r.axis + 2) % 3;
    const neutral = r.neutral && (right ? new Quaternion(r.neutral.x, -r.neutral.y, -r.neutral.z, r.neutral.w) : r.neutral.clone());
    return {
      bone: INDEX[bone],
      axis: r.axis,
      twist: side(rad(r.twist), r.axis, right),
      swing: [side(rad(r.swing[0]), j, right), side(rad(r.swing[1]), k, right)],
      neutral,
    };
  });
}
