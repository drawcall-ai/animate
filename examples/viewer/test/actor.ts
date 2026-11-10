// Pose metrics use public bones, proportions and feet. Grip ownership, borne loads and quiet-stance intent still need the body's self.
import { Quaternion, Vector3, type Object3D } from 'three';
import type { HumanoidBone } from '@drawcall/animate';
import { personOf } from '../../../packages/animate/src/verbs/person-of';
import type { Person as PersonSelf } from '../../../packages/animate/src/person/person';
import type { Person } from '../src/scenario';
import { poseOf } from '@drawcall/animate';

type Proportions = NonNullable<Person['species']['person']>;
type BoneName = HumanoidBone | 'leftToes' | 'rightToes';
export type Side = 'left' | 'right';

/** what a hand holds: the thing, its grip where it is now (world) and the thing's mass (kg) */
export interface Held {
  thing: Object3D;
  grip: Vector3;
  mass: number;
}

/** A foot as the stepper has it: where it stands or lands, which way it points, planted or swinging. */
export interface Foot {
  position: Vector3;
  yaw: number;
  phase: 'planted' | 'swing';
}

/** A person read for the metrics: its bones and landmarks (world), its walk, its feet and what its hands hold and its body bears. */
export class Actor {
  readonly self: PersonSelf;
  private readonly points: Record<string, { bone: BoneName; at: Vector3 }>;

  constructor(readonly body: Person) {
    this.self = personOf(body, 'Actor');
    this.points = pointsOf(this.proportions);
  }

  get proportions() {
    const proportions = this.body.species.person;
    if (!proportions) throw new Error('metrics need a person');
    return proportions;
  }

  /** Locomotion intent: public velocity/facing include pose sway and cannot classify steady strides. */
  get locomotion() {
    return this.self.locomotion;
  }

  get feet(): Foot[] {
    return this.body.feet.map((foot) => ({ position: foot.position, yaw: foot.yaw, phase: foot.planted ? 'planted' : 'swing' }));
  }

  /** what each hand holds (the scene's world matrices as of its last update) */
  get holding(): Record<Side, Held | null> {
    const held = (side: Side): Held | null => {
      const hold = this.self.holding[side];
      if (!hold) return null;
      const grip = hold.thing.grip(hold.grip).node.getWorldPosition(new Vector3());
      return { thing: hold.thing.object, grip, mass: hold.thing.mass };
    };
    return { left: held('left'), right: held('right') };
  }

  /** what it bears of the things it holds and wears: each one's centre of mass (world) and the share it bears (kg) */
  get borne(): { centre: Vector3; kg: number }[] {
    return [...this.self.borne].map(([thing, { kg }]) => ({ centre: thing.object.localToWorld(thing.centre.clone()), kg }));
  }

  /** where a bone (by its humanoid name) or a landmark (`leftEye`, `leftHeel`, `leftBigToe`, `nose`, …) is (world) */
  joint(name: string, out = new Vector3()): Vector3 {
    const pose = poseOf(this.body);
    const index = pose.skeleton.bones.findIndex((bone) => bone.name === name);
    if (index >= 0) return out.copy(pose.position(index));
    const point = this.points[name];
    if (!point) throw new Error(`a person has no ${name}`);
    return pose.point(pose.skeleton.index(point.bone), point.at, out);
  }

  /** a bone's turn (world; identity standing in the T-pose facing +Z) */
  turn(name: BoneName, out = new Quaternion()): Quaternion {
    return out.copy(poseOf(this.body).rotation(poseOf(this.body).skeleton.index(name)));
  }

  /** a point fixed in a bone's frame, where it is now (world) */
  point(name: BoneName, local: Vector3, out = new Vector3()): Vector3 {
    return poseOf(this.body).point(poseOf(this.body).skeleton.index(name), local, out);
  }
}

/** The named points that are not bone origins (OpenPose BODY_25 needs them), each fixed in a bone's frame; the right mirrors the left's x. */
function pointsOf(proportions: Proportions): Record<string, { bone: BoneName; at: Vector3 }> {
  const { head, sole, eyes } = proportions, mirror = (at: Vector3) => new Vector3(-at.x, at.y, at.z);
  // (the palm's centre, where a hand holds a grip: 0.043 of the height past the wrist along the hand, as the library has it)
  const palm = (side: Side) => proportions.offsets[`${side}Hand`].clone().setLength(0.043 * proportions.height);
  return {
    nose: { bone: 'head', at: head.nose },
    headTop: { bone: 'head', at: head.top },
    eyes: { bone: 'head', at: eyes },
    leftEye: { bone: 'head', at: head.eye },
    rightEye: { bone: 'head', at: mirror(head.eye) },
    leftEar: { bone: 'head', at: head.ear },
    rightEar: { bone: 'head', at: mirror(head.ear) },
    leftHeel: { bone: 'leftFoot', at: sole.heel },
    rightHeel: { bone: 'rightFoot', at: mirror(sole.heel) },
    leftBigToe: { bone: 'leftToes', at: sole.bigToe },
    rightBigToe: { bone: 'rightToes', at: mirror(sole.bigToe) },
    leftSmallToe: { bone: 'leftToes', at: sole.smallToe },
    rightSmallToe: { bone: 'rightToes', at: mirror(sole.smallToe) },
    leftWrist: { bone: 'leftHand', at: new Vector3() },
    rightWrist: { bone: 'rightHand', at: new Vector3() },
    leftPalm: { bone: 'leftHand', at: palm('left') },
    rightPalm: { bone: 'rightHand', at: palm('right') },
  };
}

/** the world position of `name`, a bone or landmark of `h` */
export const jointOf = (h: Actor, name: string, out = new Vector3()) => h.joint(name, out);

/** the eyes' midpoint (where a head target goes) */
export const eyesOf = (h: Actor, out = new Vector3()) => h.joint('leftEye', out).add(h.joint('rightEye', _v)).multiplyScalar(0.5);

const _v = new Vector3();

export { forwardOf, leftOf, wrapAngle } from '../../../packages/animate/test/kit/angles';
