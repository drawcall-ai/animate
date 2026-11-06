import { MathUtils, Quaternion, Vector3, type Object3D } from 'three';
import type { Body, HandPlacement } from '@drawcall/animate';
import { frame } from './angles';
import type { Hold } from './choreography';
import { SOLDIER } from './skeleton';

export type Bone = (typeof SOLDIER)[number]['name'];
export type Side = 'left' | 'right';
export type Pose = Map<Bone, Quaternion>;

/** Every bone the puppet turns, parents before children. */
export const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
] as const satisfies readonly Bone[];

const Z = new Vector3(0, 0, 1);
/**
 * How far the wrist twists at the most (rad): the rest of the hand's turn about the forearm the forearm takes, as the radius rolls round
 * the ulna (half the turn left in the wrist, a hand turned far at the landing still tore the cuff's skin there; taken by the wrist alone,
 * the sleeve twisted through itself).
 */
const WRIST_TWIST = 0.2;
const REST = new Map(SOLDIER.map((bone) => [bone.name, new Vector3(...bone.position)]));

/** The direction from `from` to `to` in the skeleton as written, at rest. */
function restAxis(from: Bone, to: Bone) {
  const a = REST.get(from), b = REST.get(to);
  if (!a || !b) throw new Error(`no rest bones ${from}, ${to}`);
  return b.clone().sub(a).normalize();
}

/**
 * Poses a soldier's bones directly, for what @drawcall/animate's bodies do not do (sit, climb): by each bone's world rotation in the
 * skeleton's rest convention (a T-pose facing +Z, +X to its left, so identity is that T-pose), and by two-bone limbs reaching a point.
 * Turn parents before children: each bone keeps its world rotation only until its parent next turns.
 */
export class Puppet {
  /** each bone's world rotation at rest, in its model's frame */
  private readonly rest = new Map<Bone, Quaternion>();
  /** the length of each limb's upper and lower segment (m) */
  private readonly lengths = new Map<Bone, number>();
  /** each hand's placements on the grips it has held, by grip */
  private readonly placements: Record<Side, WeakMap<Object3D, HandPlacement>> = { left: new WeakMap(), right: new WeakMap() };

  readonly bones: Readonly<Record<Bone, Object3D>>;

  constructor(private readonly body: Body, model?: Object3D) {
    this.bones = body.bones;
    model?.updateMatrixWorld(true);
    const inverse = model ? model.getWorldQuaternion(new Quaternion()).invert() : new Quaternion();
    const measured = (bone: Bone) => {
      if (!model) return new Quaternion();
      const node = model.getObjectByName(bone);
      if (!node) throw new Error(`The model has no bone ${bone}`);
      return inverse.clone().multiply(node.getWorldQuaternion(new Quaternion()));
    };
    for (const bone of BONES) this.rest.set(bone, measured(bone));
    for (const [upper, lower, end] of LIMBS) {
      this.lengths.set(upper, this.position(upper).distanceTo(this.position(lower)));
      this.lengths.set(lower, this.position(lower).distanceTo(this.position(end)));
    }
  }

  position(bone: Bone, target = new Vector3()) { return this.bones[bone].getWorldPosition(target); }

  /** `bone`'s world rotation in the rest convention. */
  rotation(bone: Bone, target = new Quaternion()) {
    return this.bones[bone].getWorldQuaternion(target).multiply(this.restOf(bone).clone().invert());
  }

  /** Every bone's world rotation now, to blend from. */
  capture(): Pose { return new Map(BONES.map((bone) => [bone, this.rotation(bone)])); }

  turn(bone: Bone, rotation: Readonly<Quaternion>) {
    const node = this.bones[bone], parent = node.parent;
    if (!parent) throw new Error(`${bone} has no parent`);
    const world = rotation.clone().multiply(this.restOf(bone));
    node.quaternion.copy(parent.getWorldQuaternion(new Quaternion()).invert().multiply(world));
    node.updateMatrixWorld(true);
  }

  /** How hand `side` holds the grip `empty`, as `Body.gripOn` places it on `placement`: where its wrist goes and how it is turned. */
  hold(side: Side, empty: Object3D): Hold {
    const { wrist, rotation } = this.body.gripOn(side, this.placement(side, empty));
    return { wrist, hand: rotation.multiply(this.restOf(`${side}Hand`).clone().invert()) };
  }

  /** The placement hand `side` takes the grip `empty` by (`Body.placement`): picked the first time it is asked for, and kept, so the hand
   * holds a grip the same however the body has come to it. */
  placement(side: Side, empty: Object3D): HandPlacement {
    const known = this.placements[side].get(empty);
    if (known) return known;
    const placement = this.body.placement(side, empty);
    this.placements[side].set(empty, placement);
    return placement;
  }

  /** Moves the root bone to a world position. */
  place(bone: Bone, at: Readonly<Vector3>) {
    const node = this.bones[bone], parent = node.parent;
    if (!parent) throw new Error(`${bone} has no parent`);
    parent.updateWorldMatrix(true, false);
    node.position.copy(parent.worldToLocal(at.clone()));
    node.updateMatrixWorld(true);
  }

  /**
   * Bends a leg so its ankle reaches `ankle`, its knee toward `knee` (a direction), the foot then turned to `foot`; out of reach, it
   * points the straight leg at it.
   */
  leg(side: Side, ankle: Readonly<Vector3>, knee: Readonly<Vector3>, foot: Readonly<Quaternion>) {
    // A leg's knee is to the front (+Z) at rest.
    this.limb(`${side}UpperLeg`, `${side}LowerLeg`, `${side}Foot`, ankle, knee, Z);
    this.turn(`${side}Foot`, foot);
    this.turn(`${side}Toes`, foot);
  }

  /** Bends an arm so its wrist reaches `wrist`, its elbow pointing along `elbow`, the hand then turned to `hand`; the forearm rolls with
   * the hand about its length, all but `WRIST_TWIST` of the way (or half, turned less). */
  arm(side: Side, wrist: Readonly<Vector3>, elbow: Readonly<Vector3>, hand: Readonly<Quaternion>) {
    const lower = `${side}LowerArm` as const;
    // An arm reaches out sideways at rest, palm down, its elbow behind (−Z).
    this.limb(`${side}UpperArm`, lower, `${side}Hand`, wrist, elbow, Z.clone().negate());
    // (the hand's turn off the forearm's, its twist about the forearm's rest axis: the roll a forearm's bones make)
    const forearm = this.rotation(lower), off = forearm.clone().invert().multiply(hand), axis = restAxis(lower, `${side}Hand`);
    const along = axis.dot(new Vector3(off.x, off.y, off.z)), angle = 2 * Math.atan2(along, off.w);
    const turned = Math.atan2(Math.sin(angle), Math.cos(angle)), roll = turned - MathUtils.clamp(turned / 2, -WRIST_TWIST, WRIST_TWIST);
    this.turn(lower, forearm.multiply(new Quaternion().setFromAxisAngle(axis, roll)));
    this.turn(`${side}Hand`, hand);
  }

  private limb(upper: Bone, lower: Bone, tip: Bone, end: Readonly<Vector3>, pole: Readonly<Vector3>, toward: Vector3) {
    const root = this.position(upper), a = this.length(upper), b = this.length(lower);
    const reach = end.clone().sub(root), distance = Math.min(Math.max(reach.length(), 1e-4), a + b - 1e-4);
    const axis = reach.normalize();
    const bend = pole.clone().addScaledVector(axis, -pole.dot(axis)).normalize();
    const forward = (a * a - b * b + distance * distance) / (2 * distance);
    const joint = root.clone().addScaledVector(axis, forward).addScaledVector(bend, Math.sqrt(Math.max(0, a * a - forward * forward)));
    this.turn(upper, frame(restAxis(upper, lower), joint.clone().sub(root), toward, bend));
    const reached = root.addScaledVector(axis, distance);
    this.turn(lower, frame(restAxis(lower, tip), reached.sub(joint), toward, bend));
  }

  private length(bone: Bone) {
    const length = this.lengths.get(bone);
    if (length === undefined) throw new Error(`${bone} is not a limb segment`);
    return length;
  }

  private restOf(bone: Bone) {
    const rest = this.rest.get(bone);
    if (!rest) throw new Error(`${bone} is not posed by the puppet`);
    return rest;
  }
}

const LIMBS = [
  ['leftUpperLeg', 'leftLowerLeg', 'leftFoot'], ['rightUpperLeg', 'rightLowerLeg', 'rightFoot'],
  ['leftUpperArm', 'leftLowerArm', 'leftHand'], ['rightUpperArm', 'rightLowerArm', 'rightHand'],
] as const satisfies readonly (readonly [Bone, Bone, Bone])[];
