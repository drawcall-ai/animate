import type { Vec3 } from './define';

/** A spring's restoring strength when it gives none (s⁻²) */
export const STIFFNESS = 40;

/** Spring motion for the bone hierarchy below one root. Lengths and rest directions come from the rig. */
export interface Spring {
  /** Restoring strength per unit mass (s⁻²; default 40). Higher values hold the input pose more firmly. */
  readonly stiffness?: number;
  /** Damping ratio (default 0.7) of each link's swing, under its stiffness and gravity's pull together: 0 oscillates, 1 is critically damped, above 1 settles more slowly. */
  readonly damping?: number;
  /** World acceleration (m/s²; default [0, -9.81, 0]). [0, 0, 0] disables gravity. */
  readonly gravity?: Vec3;
  /**
   * The root's rotation the chain hangs from (XYZ Euler angles in radians, in its parent's frame), in place of the model's or the
   * animation's: hair skinned standing clear of the body hangs from here. Absent, the root keeps its input rotation.
   */
  readonly hang?: Vec3;
}
