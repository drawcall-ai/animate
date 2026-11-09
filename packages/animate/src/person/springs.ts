import { Quaternion, Vector3, type Object3D } from 'three';
import type { Binding } from '../body/binding';
import type { Capsule, Trunk } from '../body/springs';
import { INDEX } from './anatomy/bones';
import type { Proportions } from './anatomy/proportions';
import { BODY_RADIUS } from './hands/clearance';

/**
 * a person's trunk as its springs keep out of it: the capsule `clearBody` keeps a load from, from the hips up the neck to the skull, but
 * as wide as the hip joints stand below the neck, two more beside it (a trunk is wider than it is deep: in a round one alone, a braid
 * slid round inside the flank and out at the side of the waist after a hard stop)
 */
export function trunkOf(proportions: Proportions, binding: Binding): Trunk {
  const points = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()] as const;
  const [atHips, atNeck, skull, leftHips, leftNeck, rightHips, rightNeck] = points;
  const { hips, neck, head, leftUpperLeg: leftHip, rightUpperLeg: rightHip }: Record<string, Object3D> = binding.bones;
  // (hips to neck in the middle, to the left and to the right, and neck to skull)
  const capsules: readonly Capsule[] = [[points[0], points[1]], [points[3], points[4]], [points[5], points[6]], [points[1], points[2]]];
  return {
    capsules,
    radius: 0,
    place() {
      head.updateWorldMatrix(true, false);
      hips.getWorldPosition(atHips);
      neck.getWorldPosition(atNeck);
      const aside = leftHip.getWorldPosition(_aside).sub(rightHip.getWorldPosition(_out)).multiplyScalar(0.5);
      leftHips.addVectors(atHips, aside);
      leftNeck.addVectors(atNeck, aside);
      rightHips.subVectors(atHips, aside);
      rightNeck.subVectors(atNeck, aside);
      // (the skull centre is in the solver's head frame: the bone is turned from it by its rest turn)
      const scale = head.getWorldScale(_scale).x / binding.scaleOf(INDEX.head);
      const turn = head.getWorldQuaternion(_head).multiply(_rest.copy(binding.restOf(INDEX.head)).invert());
      skull.copy(proportions.headCenter).multiplyScalar(scale).applyQuaternion(turn).add(head.getWorldPosition(_out));
      this.radius = BODY_RADIUS * proportions.height * scale;
    },
  };
}

const _scale = new Vector3(), _aside = new Vector3(), _out = new Vector3(), _head = new Quaternion(), _rest = new Quaternion();
