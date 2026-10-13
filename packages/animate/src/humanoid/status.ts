import { Vector3, type Quaternion } from 'three';
import type { Stance } from './stance';

/**
 * planted: bearing weight on the ground; swing: stepping (also a foot target striding low and
 * away, being put down); lifted: held up by a foot target; carried: standing on a mount
 */
export type FootPhase = 'planted' | 'swing' | 'lifted' | 'carried';

/** Where a foot stands or, mid-step, will land. */
export interface Foot {
  /** flat-foot ankle position: where it stands, or will land swinging */
  position: Vector3;
  yaw: number;
  phase: FootPhase;
}

/** A target as the body is asked to meet it, in world space; `weight` 0..1. */
export interface Effector {
  position: Vector3;
  quaternion?: Quaternion;
  weight: number;
}

/**
 * What the body is asked to do, as the behaviours took it on: their effector targets (the eye
 * midpoint for the head, the wrists for the hands, the ankles for the feet; the chest's and hips'
 * bone origins), where it looks, the seat it sits on (the seat surface under the hips), the
 * mount it rides (`lean` 0..1: how much of the mount's lean is the body's own) and the force the
 * hands exert on what they hold (per kg of body mass, m/s²). Absent: not asked.
 */
export interface Intent {
  head?: Effector;
  chest?: Effector;
  hips?: Effector;
  leftHand?: Effector;
  rightHand?: Effector;
  leftFoot?: Effector;
  rightFoot?: Effector;
  lookAt?: Vector3;
  seat?: Effector;
  mount?: Effector & { lean: number };
  handForce?: Vector3;
}

/**
 * What the behaviours report of the body beyond its solved state, shared by all of them and
 * read by the app (and the metrics): each foot's footing [left, right], how far the body is
 * seated (0 standing … 1 seated), whether it rides a mount, its intent, how it stands at ease
 * (set by the `humanoid` bundle, read by whatever places the feet).
 */
export interface Status {
  feet: [Foot, Foot];
  seated: number;
  mounted: boolean;
  intent: Intent;
  stance: Stance;
}

/** A status standing in `stance` with the feet planted at `feet` (flat-foot ankle positions). */
export function createStatus(feet: [Omit<Foot, 'phase'>, Omit<Foot, 'phase'>], stance: Stance): Status {
  const foot = ({ position, yaw }: Omit<Foot, 'phase'>): Foot => ({ position: position.clone(), yaw, phase: 'planted' });
  return { feet: [foot(feet[0]), foot(feet[1])], seated: 0, mounted: false, intent: {}, stance };
}
