import { Quaternion, Vector3 } from 'three';

/** A two-bone chain as the analytic IK leaves it. */
export interface Limb {
  root: Vector3;
  mid: Vector3;
  end: Vector3;
  /** unit, ⊥ root→end: the side the middle joint was pushed to */
  bend: Vector3;
}

export const createLimb = (): Limb => ({ root: new Vector3(), mid: new Vector3(), end: new Vector3(), bend: new Vector3() });

/** Where the head sits on the neck for a head rotation (written by `headFrom`). */
export interface HeadFrame {
  /** lower-neck rotation */
  qNeck: Quaternion;
  /** head bone origin (skull base) */
  head: Vector3;
  qHead: Quaternion;
  headCenter: Vector3;
  /** eye midpoint */
  eyes: Vector3;
}

export const createHeadFrame = (): HeadFrame => ({ qNeck: new Quaternion(), head: new Vector3(), qHead: new Quaternion(), headCenter: new Vector3(), eyes: new Vector3() });

/**
 * The trunk's bone origins (VRM names) and rotations for a posture (written by `trunkFK`),
 * with the head as the posture carries it: turned as tracked, or facing with the chest.
 */
export interface TrunkFrame extends HeadFrame {
  /** the pelvis's facing (yaw + blade) before the gait's overlay: forward and left */
  forward: Vector3;
  left: Vector3;
  hips: Vector3;
  qHips: Quaternion;
  spine: Vector3;
  qSpine: Quaternion;
  chest: Vector3;
  qChest: Quaternion;
  neck: Vector3;
  /** shoulder (clavicle) bone origins [left, right] */
  shoulders: [Vector3, Vector3];
  /** upper-arm joints with the clavicles at rest */
  upperArms: [Vector3, Vector3];
  /** hip joints */
  upperLegs: [Vector3, Vector3];
}

export const createTrunkFrame = (): TrunkFrame => ({
  ...createHeadFrame(),
  forward: new Vector3(),
  left: new Vector3(),
  hips: new Vector3(),
  qHips: new Quaternion(),
  spine: new Vector3(),
  qSpine: new Quaternion(),
  chest: new Vector3(),
  qChest: new Quaternion(),
  neck: new Vector3(),
  shoulders: [new Vector3(), new Vector3()],
  upperArms: [new Vector3(), new Vector3()],
  upperLegs: [new Vector3(), new Vector3()],
});

export interface Side {
  /** origin of the shoulder (clavicle) bone */
  clavicle: Vector3;
  /** root = upper-arm joint; it lies at rest.offsets.*UpperArm from the clavicle */
  arm: Limb;
  /** wrist rotation target (VRM hand bone world rotation), blended in by `weight`; null: the hand continues the forearm */
  hand: { quaternion: Quaternion; weight: number } | null;
  /** root = hip joint, end = ankle */
  leg: Limb;
  foot: Quaternion;
  /** bent up flat on the ball while the heel is up, relaxing into line with the foot as it swings */
  toes: Quaternion;
}

const createSide = (): Side => ({ clavicle: new Vector3(), arm: createLimb(), hand: null, leg: createLimb(), foot: new Quaternion(), toes: new Quaternion() });

/** The frames the body is posed into each tick: what the pose is written from. */
export interface Frames {
  /** the settled posture's trunk (the legs lower it to reach their feet) */
  trunk: TrunkFrame;
  /** the neck and head as the gaze turned them */
  head: HeadFrame;
  sides: readonly [Side, Side];
}

export const createFrames = (): Frames => ({ trunk: createTrunkFrame(), head: createHeadFrame(), sides: [createSide(), createSide()] });
