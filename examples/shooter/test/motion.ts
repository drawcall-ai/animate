import type { Body } from '@drawcall/animate';
import { Quaternion, Vector3 } from 'three';
import { expect } from 'vitest';
import { poseOf } from '@drawcall/animate/puppet';

interface Peak { joint: string; frame: number; value: number }

/** Completed poses only: measure actual joint motion, including changes in velocity at contact. */
export class Motion {
  readonly positionStep: Peak = { joint: '', frame: 0, value: 0 };
  readonly positionChange: Peak = { joint: '', frame: 0, value: 0 };
  readonly rotationStep: Peak = { joint: '', frame: 0, value: 0 };
  readonly rotationChange: Peak = { joint: '', frame: 0, value: 0 };
  private previous;
  private deltas: { position: Vector3; rotation: Quaternion }[] | undefined;

  constructor(private readonly body: Body) { this.previous = this.read(); }

  sample(frame: number) {
    const current = this.read();
    const deltas = current.map((joint, index) => {
      const previous = this.previous[index];
      const position = joint.position.clone().sub(previous.position);
      const rotation = joint.rotation.clone().multiply(previous.rotation.clone().invert());
      this.keep(this.positionStep, position.length(), joint.name, frame);
      this.keep(this.rotationStep, rotation.angleTo(IDENTITY), joint.name, frame);
      const delta = this.deltas?.[index];
      if (delta) {
        this.keep(this.positionChange, position.distanceTo(delta.position), joint.name, frame);
        this.keep(this.rotationChange, rotation.angleTo(delta.rotation), joint.name, frame);
      }
      return { position, rotation };
    });
    this.previous = current;
    this.deltas = deltas;
  }

  private read() {
    const pose = poseOf(this.body);
    return pose.skeleton.bones.map((bone, index) => ({
      name: bone.name, position: pose.position(index).clone(), rotation: pose.local(index).clone(),
    }));
  }

  private keep(peak: Peak, value: number, joint: string, frame: number) {
    if (value > peak.value) Object.assign(peak, { joint, frame, value });
  }
}

const IDENTITY = new Quaternion();

/** Generous limits per 60 Hz tick: catch pose jumps while allowing full-speed strides and physical landings. */
export function expectSmooth(motion: Motion) {
  const { positionStep, positionChange, rotationStep, rotationChange } = motion;
  const detail = JSON.stringify({ positionStep, positionChange, rotationStep, rotationChange });
  expect(motion.positionStep.value, detail).toBeLessThan(0.2);
  expect(motion.positionChange.value, detail).toBeLessThan(0.15);
  expect(motion.rotationStep.value, detail).toBeLessThan(Math.PI / 4);
  expect(motion.rotationChange.value, detail).toBeLessThan(Math.PI / 3);
}
