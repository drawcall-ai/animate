// A person as the metrics read it: what the public body reports, and what only its insides know (its proportions, its landmarks, its
// feet's phases, what its hands hold by which grip). The one place the examples' tests reach into the library's source.
import { Quaternion, Vector3, type Object3D } from 'three';
import type { Body } from '@drawcall/animate';
import { selfOf } from '../../packages/animate/src/body/body';
import { personOf, type Person as Insides } from '../../packages/animate/src/body/person';
import { INDEX, type BoneName } from '../../packages/animate/src/species/humanoid/bones';
import { pointsOf } from '../../packages/animate/src/species/humanoid/landmarks';
import type { Person } from '../src/scenario';

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
  readonly insides: Insides;
  private readonly points: ReturnType<typeof pointsOf>;

  constructor(readonly body: Person) {
    this.insides = personOf(selfOf(body as Body));
    this.points = pointsOf(this.insides.proportions);
  }

  get proportions() {
    return this.insides.proportions;
  }

  /** its walk: facing, ground velocity, quiet stance displacement */
  get locomotion() {
    return this.insides.locomotion;
  }

  get feet(): Foot[] {
    return (this.insides.stepper?.legs ?? []).map((leg) => ({ position: leg.anchor, yaw: leg.yaw, phase: leg.swing ? 'swing' : 'planted' }));
  }

  /** what each hand holds (the scene's world matrices as of its last update) */
  get holding(): Record<Side, Held | null> {
    const held = (side: Side): Held | null => {
      const hold = this.insides.holding[side];
      if (!hold) return null;
      const grip = hold.thing.grip(hold.grip).node.getWorldPosition(new Vector3());
      return { thing: hold.thing.object, grip, mass: hold.thing.mass };
    };
    return { left: held('left'), right: held('right') };
  }

  /** what it bears of the things it holds and wears: each one's centre of mass (world) and the share it bears (kg) */
  get borne(): { centre: Vector3; kg: number }[] {
    return [...this.insides.borne].map(([thing, { kg }]) => ({ centre: thing.object.localToWorld(thing.centre.clone()), kg }));
  }

  /** where a bone (by its humanoid name) or a landmark (`leftEye`, `leftHeel`, `leftBigToe`, `nose`, …) is (world) */
  joint(name: string, out = new Vector3()): Vector3 {
    const pose = this.body.pose;
    if (name in INDEX) return out.copy(pose.position(INDEX[name as BoneName]));
    const point = this.points[name as keyof typeof this.points];
    if (!point) throw new Error(`a person has no ${name}`);
    return pose.point(point.bone, point.at, out);
  }

  /** a bone's turn (world; identity standing in the T-pose facing +Z) */
  turn(name: BoneName, out = new Quaternion()): Quaternion {
    return out.copy(this.body.pose.rotation(INDEX[name]));
  }

  /** a point fixed in a bone's frame, where it is now (world) */
  point(name: BoneName, local: Vector3, out = new Vector3()): Vector3 {
    return this.body.pose.point(INDEX[name], local, out);
  }
}

/** the world position of `name`, a bone or landmark of `h` */
export const jointOf = (h: Actor, name: string, out = new Vector3()) => h.joint(name, out);

/** the eyes' midpoint (where a head target goes) */
export const eyesOf = (h: Actor, out = new Vector3()) => h.joint('leftEye', out).add(h.joint('rightEye', _v)).multiplyScalar(0.5);

/** the unit vector a facing of `yaw` points along (rad about +Y; 0 faces +Z) */
export const forwardOf = (yaw: number) => new Vector3(Math.sin(yaw), 0, Math.cos(yaw));

/** the unit vector to the left of a facing of `yaw` */
export const leftOf = (yaw: number) => new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

/** `angle` wrapped into (−π, π] */
export const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

const _v = new Vector3();
