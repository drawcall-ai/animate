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
  /** the rifle in the frame's frame, and each hand on it in the rifle's */
  rifle: Matrix4;
  grips: Record<Side, Matrix4>;
}

/** Takes the pose `puppet`'s body stands in, holding `rifle`, in `frame`'s frame. */
export function stand(puppet: Puppet, frame: Object3D, rifle: Object3D): Standing {
  const local = (bone: Bone) => frame.worldToLocal(puppet.position(bone));
  const back = frame.getWorldQuaternion(new Quaternion()).invert();
  const pose = puppet.capture();
  for (const rotation of pose.values()) rotation.premultiply(back);
  const bend = (upper: Bone, middle: Bone, end: Bone) => local(middle).sub(local(upper).add(local(end)).multiplyScalar(0.5));
  const onRifle = (side: Side) => rifle.matrixWorld.clone().invert().multiply(new Matrix4().compose(puppet.position(`${side}Hand`), puppet.rotation(`${side}Hand`), new Vector3(1, 1, 1)));
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
    rifle: frame.matrixWorld.clone().invert().multiply(rifle.matrixWorld), grips: { left: onRifle('left'), right: onRifle('right') },
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
  /** hand `side` holding the rifle as it did standing, the rifle where `rifle` (a world matrix) puts it */
  carrying(rifle: Matrix4, side: Side = 'right'): Hold {
    const wrist = new Vector3(), hand = new Quaternion();
    rifle.clone().multiply(this.standing.grips[side]).decompose(wrist, hand, new Vector3());
    return { wrist, hand };
  }
  /** where the rifle is (a world matrix), `t` of the way from held as it stood (0) to `stowed` (a world matrix) at `take`, as a soldier
   * slings a weapon and takes it back: brought down turned halfway over `down`, held there while the support hand leaves it (or, taking it
   * back, comes onto it), and turned on the rest of the way over `away` — from the full hang, or the support hand's grip taken late, the
   * hand reaches for a rifle swinging past it */
  rifle(stowed: Matrix4, t: number, { down, away }: { down: Beat; away: Beat }): Matrix4 {
    const held = this.object.matrixWorld.clone().multiply(this.standing.rifle), [from, to] = [held, stowed].map(placed);
    // (halfway its barrel turned the least way toward where it is stowed, not rolled: a rifle stowed top to the rear, turned halfway there
    // whole, lay on its side, the support hand twisted round under it)
    const swing = new Quaternion().setFromUnitVectors(BARREL.clone().applyQuaternion(from.q), BARREL.clone().applyQuaternion(to.q));
    const halfway = new Matrix4().compose(from.p.clone().lerp(to.p, 0.5), new Quaternion().slerp(swing, 0.5).multiply(from.q), new Vector3(1, 1, 1));
    return t <= down[1] ? mixed(held, halfway, phase(t, down)) : mixed(halfway, stowed, phase(t, away));
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

/** The rifle's barrel, out along its +Z. */
const BARREL = new Vector3(0, 0, 1);

/** `s` of the way from `a` to `b` (world matrices, unscaled): its place along the line between, its turn the least way round. */
function mixed(a: Matrix4, b: Matrix4, s: number) {
  const [at, to] = [a, b].map(placed);
  return new Matrix4().compose(at.p.lerp(to.p, s), at.q.slerp(to.q, s), new Vector3(1, 1, 1));
}

/** Where `matrix` places and how it turns. */
function placed(matrix: Matrix4) {
  const p = new Vector3(), q = new Quaternion();
  matrix.decompose(p, q, new Vector3());
  return { p, q };
}

/** A copy of `bone`'s rotation in `pose`. */
function turnIn(pose: Pose, bone: Bone) {
  const rotation = pose.get(bone);
  if (!rotation) throw new Error(`No standing pose for ${bone}`);
  return rotation.clone();
}
