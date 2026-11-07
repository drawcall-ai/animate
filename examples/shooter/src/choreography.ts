import { MathUtils, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import type { Play } from './audio';
import type { Bone, Pose, Puppet, Side } from './puppet';

/** The span of progress, from and to, over which one part moves. */
export type Beat = readonly [from: number, to: number];

/** A sound to play, as `Play` takes it. */
export type Effect = Readonly<Parameters<Play>>;

/** The sounds of a part's move over `beat`: `on` as it ends getting on, `off` as it ends getting off (where the beat begins). */
export interface Cue { beat: Beat; on?: Effect; off?: Effect }

/** Progress of `t` through `beat`, from 0 to 1. */
export function linear(t: number, [from, to]: Beat) { return MathUtils.clamp((t - from) / (to - from), 0, 1); }

/** Eased progress of `t` through `beat`. */
export function phase(t: number, beat: Beat) {
  const s = linear(t, beat);
  return s * s * (3 - 2 * s);
}

/** Where a mounted soldier looks: off the way it faces (rad, + left, head and shoulders turned) and up (rad). */
export interface Gaze { yaw: number; pitch: number }

/** Where a hand goes and how it is turned there. */
export interface Hold { wrist: Vector3; hand: Quaternion }

/** `s` of the way from `a` to `b`. */
export function between(a: Hold, b: Hold, s: number): Hold {
  return { wrist: a.wrist.clone().lerp(b.wrist, s), hand: a.hand.clone().slerp(b.hand, s) };
}

/** The soldier as it stood, rifle in hand, in the frame of what it gets on: what getting on starts from and getting off ends on. */
export interface Standing {
  pose: Pose;
  hips: Vector3;
  ankles: Record<Side, Vector3>;
  /** where its ankles stand squared under its hips, and how its feet are turned there, as level as the lower one: where a foot still
   * stepping as it arrived comes down */
  stance: Record<Side, Vector3>;
  soles: Record<Side, Quaternion>;
  wrists: Record<Side, Vector3>;
  /** which way each knee and elbow pointed */
  knees: Record<Side, Vector3>;
  elbows: Record<Side, Vector3>;
  /** the right hand on the rifle, in the rifle's frame */
  grip: Matrix4;
}

/** Takes the pose `puppet`'s body stands in, holding `rifle`, in `frame`'s frame. */
export function stand(puppet: Puppet, frame: Object3D, rifle: Object3D): Standing {
  const local = (bone: Bone) => frame.worldToLocal(puppet.position(bone));
  const back = frame.getWorldQuaternion(new Quaternion()).invert();
  const pose = puppet.capture();
  for (const rotation of pose.values()) rotation.premultiply(back);
  const bend = (upper: Bone, middle: Bone, end: Bone) => local(middle).sub(local(upper).add(local(end)).multiplyScalar(0.5));
  const hand = new Matrix4().compose(puppet.position('rightHand'), puppet.rotation('rightHand'), new Vector3(1, 1, 1));
  const ankles = { left: local('leftFoot'), right: local('rightFoot') }, floor = Math.min(ankles.left.y, ankles.right.y);
  // (each foot pitched as the lower one, from its heel to its toes, still pointing the way it did)
  const along = (side: Side) => local(`${side}Toes`).sub(local(`${side}Foot`)).normalize();
  const drop = along(ankles.left.y <= ankles.right.y ? 'left' : 'right').y;
  const sole = (side: Side) => {
    const now = along(side), level = now.clone().setY(0).normalize().multiplyScalar(Math.sqrt(1 - drop * drop)).setY(drop);
    return new Quaternion().setFromUnitVectors(now, level).multiply(turnIn(pose, `${side}Foot`));
  };
  return {
    pose, hips: local('hips'), ankles,
    stance: { left: local('leftUpperLeg').setY(floor), right: local('rightUpperLeg').setY(floor) },
    soles: { left: sole('left'), right: sole('right') },
    wrists: { left: local('leftHand'), right: local('rightHand') },
    knees: { left: bend('leftUpperLeg', 'leftLowerLeg', 'leftFoot'), right: bend('rightUpperLeg', 'rightLowerLeg', 'rightFoot') },
    elbows: { left: bend('leftUpperArm', 'leftLowerArm', 'leftHand'), right: bend('rightUpperArm', 'rightLowerArm', 'rightHand') },
    grip: rifle.matrixWorld.clone().invert().multiply(hand),
  };
}

/** The frame of what the soldier gets on, and the pose it stood in there, in world terms. */
export class Frame {
  readonly rotation: Quaternion;
  constructor(readonly object: Object3D, readonly standing: Standing) { this.rotation = object.getWorldQuaternion(new Quaternion()); }
  point(local: Vector3) { return this.object.localToWorld(local.clone()); }
  direction(local: Vector3) { return local.clone().transformDirection(this.object.matrixWorld); }
  turn(local: Quaternion) { return local.premultiply(this.rotation); }
  /** a bone's rotation as the soldier stood, in this frame */
  was(bone: Bone) { return turnIn(this.standing.pose, bone); }
  /** a hand as it stood, in world terms */
  hand(side: Side): Hold { return { wrist: this.point(this.standing.wrists[side]), hand: this.turn(this.was(`${side}Hand`)) }; }
  /** the right hand holding the rifle as it did standing, the rifle where `rifle` (a world matrix) puts it */
  carrying(rifle: Matrix4): Hold {
    const wrist = new Vector3(), hand = new Quaternion();
    rifle.clone().multiply(this.standing.grip).decompose(wrist, hand, new Vector3());
    return { wrist, hand };
  }
}

/** `side`'s ankle and foot's turn (in the frame) as it stood, `s` of the way onto its squared stance. */
export function planted(standing: Standing, side: Side, s: number) {
  const ankle = standing.ankles[side].clone().lerp(standing.stance[side], s);
  return { ankle, foot: turnIn(standing.pose, `${side}Foot`).slerp(standing.soles[side], s) };
}

/** Turns the shoulders with the chest, set on it as they stood. */
export function shoulders(puppet: Puppet, frame: Frame) {
  for (const side of ['left', 'right'] as const) {
    const shoulder = `${side}Shoulder` as const;
    puppet.turn(shoulder, puppet.rotation('chest').multiply(frame.was('chest').invert().multiply(frame.was(shoulder))));
  }
}

/** A copy of `bone`'s rotation in `pose`. */
function turnIn(pose: Pose, bone: Bone) {
  const rotation = pose.get(bone);
  if (!rotation) throw new Error(`No standing pose for ${bone}`);
  return rotation.clone();
}
