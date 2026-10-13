import { Quaternion, Vector3 } from 'three';
import { pointKey, type Merged } from './board';
import { log } from './rotation';
import type { BodyState } from './state';
import type { Contact, Target } from './types';

/** how long a new contact takes to close the gap from where its point was to where it holds it (s) */
export const RAMP = 0.05;

/**
 * What a body remembers of the last sub-step's proposals, by identity (owner, kind and point):
 * each target's value, so a moving target's velocity is fed forward; each contact's onset, so
 * a contact proposed off its point ramps in over `RAMP` instead of snapping (a jolt through the
 * body). A target proposed twice under one identity in a sub-step gets no velocity (which one
 * moved is unknown); a target or contact missing for a sub-step starts over.
 */
export class History {
  private values = new Map<string, Vector3 | Quaternion>();
  private onsets = new Map<string, { age: number; position: Vector3; rotation?: Quaternion }>();

  /** sets the merged targets' velocities and ramps the new contacts in, from `state` */
  apply(merged: Merged, state: BodyState, dt: number): void {
    const seen = new Map<string, number>();
    for (const t of merged.targets) seen.set(identify(t.target), (seen.get(identify(t.target)) ?? 0) + 1);
    const values = new Map<string, Vector3 | Quaternion>();
    for (const t of merged.targets) {
      const id = identify(t.target);
      if (seen.get(id) !== 1) continue;
      values.set(id, t.target.value);
      const was = this.values.get(id);
      if (was) t.velocity = rate(t.target, was, dt);
    }
    this.values = values;

    const onsets = new Map<string, { age: number; position: Vector3; rotation?: Quaternion }>();
    merged.contacts = merged.contacts.map((c) => {
      const id = `${c.owner ?? ''}|${pointKey(c.point)}`;
      const was = this.onsets.get(id);
      const onset = was ? { ...was, age: was.age + dt } : start(c, state, dt);
      onsets.set(id, onset);
      return ramp(c, onset);
    });
    this.onsets = onsets;
  }
}

const identify = (t: Target) => `${t.owner ?? ''}|${t.kind}|${pointKey(t.point)}`;

/** how fast `t`'s value moves from `was` (m/s, or rad/s about the frame its rotation is in) */
function rate(t: Target, was: Vector3 | Quaternion, dt: number): Vector3 | undefined {
  if (t.kind === 'position' || t.kind === 'aim') return was instanceof Vector3 ? t.value.clone().sub(was).divideScalar(dt) : undefined;
  if (!(was instanceof Quaternion)) return undefined;
  return log(was.clone().invert().premultiply(t.value), new Vector3()).divideScalar(dt);
}

function start(c: Contact, state: BodyState, dt: number) {
  const rotation = c.rotation && c.point !== 'com' ? state.rotations[c.point.bone].clone() : undefined;
  return { age: dt, position: state.point(c.point, new Vector3()), rotation };
}

/** `c` as far along its ramp from its onset as its age has it */
function ramp(c: Contact, onset: { age: number; position: Vector3; rotation?: Quaternion }): Contact {
  if (onset.age >= RAMP) return c;
  const x = onset.age / RAMP;
  const s = x * x * (3 - 2 * x);
  const position = onset.position.clone().lerp(c.position, s);
  const rotation = c.rotation && onset.rotation ? onset.rotation.clone().slerp(c.rotation, s) : c.rotation;
  return { ...c, position, rotation };
}
