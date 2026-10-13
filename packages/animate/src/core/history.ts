import { Quaternion, Vector3 } from 'three';
import { pointKey, type Merged } from './board';
import { log } from './rotation';
import type { BodyState } from './state';
import type { Contact, Target } from './types';

/** how long a new contact takes to close the gap from where its point was to where it holds it (s) */
export const RAMP = 0.05;

/** a contact as remembered: when and where it set in, and where it held last */
interface Held {
  age: number;
  from: { position: Vector3; rotation?: Quaternion };
  last: Contact;
}

/**
 * What a body remembers of the last sub-step's proposals, by identity (owner, kind and point):
 * each target's value and each contact's place, so a moving one's velocity is fed forward; each
 * contact's onset, so a contact proposed off its point ramps in over `RAMP` instead of snapping
 * (a jolt through the body). A target proposed twice under one identity in a sub-step gets no
 * velocity (which one moved is unknown); a target or contact missing for a sub-step starts over.
 */
export class History {
  private values = new Map<string, Vector3 | Quaternion>();
  private held = new Map<string, Held>();

  /** sets the merged targets' and contacts' velocities and ramps the new contacts in, from `state` */
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

    const held = new Map<string, Held>();
    merged.contacts = merged.contacts.map((c) => {
      const id = `${c.owner ?? ''}|${pointKey(c.point)}`;
      const was = this.held.get(id);
      const age = was ? was.age + dt : dt;
      const from = was?.from ?? start(c, state);
      const at = ramp(c, from, age);
      held.set(id, { age, from, last: at });
      if (!was) return at;
      const spin = at.rotation && was.last.rotation ? log(was.last.rotation.clone().invert().premultiply(at.rotation), new Vector3()).divideScalar(dt) : undefined;
      return { ...at, velocity: at.position.clone().sub(was.last.position).divideScalar(dt), spin };
    });
    this.held = held;
  }
}

const identify = (t: Target) => `${t.owner ?? ''}|${t.kind}|${pointKey(t.point)}`;

/** how fast `t`'s value moves from `was` (m/s, or rad/s about the frame its rotation is in) */
function rate(t: Target, was: Vector3 | Quaternion, dt: number): Vector3 | undefined {
  if (t.kind === 'position' || t.kind === 'aim') return was instanceof Vector3 ? t.value.clone().sub(was).divideScalar(dt) : undefined;
  if (!(was instanceof Quaternion)) return undefined;
  return log(was.clone().invert().premultiply(t.value), new Vector3()).divideScalar(dt);
}

/** where `c`'s point is in `state`: where a new contact sets in from */
function start(c: Contact, state: BodyState) {
  const rotation = c.rotation && c.point !== 'com' ? state.rotations[c.point.bone].clone() : undefined;
  return { position: state.point(c.point, new Vector3()), rotation };
}

/** `c` as far along its ramp from where it set in (`from`) as its `age` has it */
function ramp(c: Contact, from: { position: Vector3; rotation?: Quaternion }, age: number): Contact {
  if (age >= RAMP) return c;
  const x = age / RAMP;
  const s = x * x * (3 - 2 * x);
  const position = from.position.clone().lerp(c.position, s);
  const rotation = c.rotation && from.rotation ? from.rotation.clone().slerp(c.rotation, s) : c.rotation;
  return { ...c, position, rotation };
}
