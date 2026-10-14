import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../core/body';
import type { Placement } from '../core/goal';
import type { Humanoid } from './humanoid';

/**
 * `local` (a placement in bone `bone`'s frame, its distances scaled with the body; with `facing`,
 * in a frame at the bone's joint turned as the body faces instead: left +x, up +y, ahead +z) as a
 * goal: where it is in the world at a sub-step, the bone as posed so far (the bones before the
 * task's are placed by then).
 */
export function onBone<W>(h: Humanoid<W>, bone: number, local: Placement, options: { facing?: boolean } = {}): (f: Frame<W>) => Required<Placement> {
  const out = { position: new Vector3(), quaternion: new Quaternion() };
  return (f) => {
    const turned = options.facing ? out.quaternion.setFromAxisAngle(UP, h.gait.facing) : out.quaternion.copy(f.current.rotation(bone));
    out.position.copy(local.position).multiplyScalar(h.proportions.scale).applyQuaternion(turned).add(f.current.position(bone));
    if (local.quaternion) turned.multiply(local.quaternion);
    return out;
  };
}

const UP = new Vector3(0, 1, 0);
