import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../core/body';
import type { Placement } from '../core/goal';
import type { Humanoid } from './humanoid';

/**
 * `local` (a placement in bone `bone`'s frame, its distances scaled with the body; with `facing`,
 * in a frame at the bone's joint turned as the body faces instead: left +x, up +y, ahead +z) as a
 * goal: where it is in the world at a sub-step, the bone as posed so far (the bones before the
 * task's are placed by then), and how fast it goes there (from where it was the sub-step before:
 * a hand on it goes along with the body, not after it).
 */
export function onBone<W>(h: Humanoid<W>, bone: number, local: Placement, options: { facing?: boolean } = {}): (f: Frame<W>) => Required<Placement> & { velocity: Vector3 } {
  let last: { time: number; position: Vector3 } | null = null;
  const velocity = new Vector3();
  return (f) => {
    const quaternion = options.facing ? new Quaternion().setFromAxisAngle(UP, h.gait.facing) : f.current.rotation(bone).clone();
    const position = local.position.clone().multiplyScalar(h.proportions.scale).applyQuaternion(quaternion).add(f.current.position(bone));
    if (local.quaternion) quaternion.multiply(local.quaternion);
    // (read again in the same sub-step: as it was; in the next: from where it was)
    if (last && Math.abs(f.time - f.dt - last.time) < 1e-9) velocity.subVectors(position, last.position).divideScalar(f.dt);
    else if (!last || last.time !== f.time) velocity.set(0, 0, 0);
    if (!last || last.time !== f.time) last = { time: f.time, position: position.clone() };
    return { position, quaternion, velocity: velocity.clone() };
  };
}

const UP = new Vector3(0, 1, 0);
