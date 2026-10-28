import { Quaternion, Vector3 } from 'three';
import { CHILD_BONES, INDEX, type ChildBone } from './bones';

const DEG = Math.PI / 180;
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);

/** the arms hang a little out from the side (relaxed standing: 5–12°, Collins 2009), the elbows a little bent */
const ABDUCTION = 8 * DEG, ELBOW = 12 * DEG;
/** the knees a little bent, the hips and ankles taking it up so the shanks and feet stay as they were */
const KNEE = 5 * DEG;

/**
 * A relaxed standing pose: each bone's rotation in its parent's frame (+Y-up, +Z-forward; the trunk, head, hands and toes as in the T-pose),
 * all but the root's, whose rotation (in the world's) is the body's facing, not its posture. Signs by the right-hand rule about +x (left),
 * +y (up), +z (forward); the right side mirrors the left.
 */
export function relaxedPose(): { bone: number; rotation: Quaternion }[] {
  return CHILD_BONES.map((b) => ({ bone: INDEX[b], rotation: relaxed(b) }));
}

function relaxed(b: ChildBone): Quaternion {
  const q = new Quaternion(), s = b.startsWith('left') ? 1 : -1;
  // the arm down from the T-pose: its tip (+x on the left) turned about z toward −y
  if (b.endsWith('UpperArm')) return q.setFromAxisAngle(Z, -s * (90 * DEG - ABDUCTION));
  // the forearm forward: about the hanging arm's y, its tip toward +z
  if (b.endsWith('LowerArm')) return q.setFromAxisAngle(Y, -s * ELBOW);
  // the thigh forward (−x), the shank back (+x), the foot level again
  if (b.endsWith('UpperLeg')) return q.setFromAxisAngle(X, -KNEE / 2);
  if (b.endsWith('LowerLeg')) return q.setFromAxisAngle(X, KNEE);
  if (b.endsWith('Foot')) return q.setFromAxisAngle(X, -KNEE / 2);
  return q;
}
