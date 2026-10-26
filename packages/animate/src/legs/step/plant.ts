// A planted foot posed: rolling over its sole, its ankle and toes on the floor.
import { Quaternion, Vector3 } from 'three';
import { forwardOf, leftOf } from '../../kernel/math';
import { _a, _b, _f, _l, beyond, rollOf, type FootPose, type Leg, type Steps } from './state';
import { lengthOf, pivotLimit, pointed, shankLean } from './reach';

/** A planted foot: rolling flat off its heel strike, onto its heel or ball as far as the hip needs to reach it. */
export function plantedPose(steps: Steps, leg: Leg, at: Vector3): FootPose {
  const now = steps.now;
  if (!now) throw new Error('pose before move');
  const { st, feet } = steps;
  // (from the roll off the heel strike, on toward the pivot that brings the ankle nearer)
  const roll = rollOf(leg);
  const depth = feet.legs[leg.i].depth;
  const far = (pitch: number) => {
    const ankle = feet.ankle(leg.i, leg.anchor, leg.yaw, pitch, _a);
    if (!depth) return ankle.distanceTo(at) > st.reach * lengthOf(steps, leg);
    // (a leg whose joints reach less than a sphere's: as far as they hold its top where it is)
    const d = _b.subVectors(ankle, at);
    return depth(d.dot(leftOf(now.yaw, _l)) * leg.sign, d.dot(forwardOf(now.yaw, _f)), pitch) < -d.y;
  };
  leg.free = !far(roll);
  let lo = roll, hi = leg.free ? roll : pivotLimit(steps, now, leg);
  for (let k = 0; k < 24 && hi !== roll; k++) { const mid = (lo + hi) / 2; if (far(mid)) lo = mid; else hi = mid; }
  leg.pitch = hi;
  // (the heel lifts once the shank leans further over the foot than the ankle bends: deep in a crouch)
  leg.pitch -= beyond(shankLean(steps, at, feet.ankle(leg.i, leg.anchor, leg.yaw, leg.pitch, _a), leg.yaw) + leg.pitch - st.dorsiflexion);
  leg.pitch = pointed(steps, now, leg, leg.pitch, at);
  const ankle = feet.ankle(leg.i, leg.anchor, leg.yaw, leg.pitch, new Vector3());
  const foot = feet.rotation(leg.yaw, leg.pitch, new Quaternion()), toes = feet.rotation(leg.yaw, Math.max(0, leg.pitch), new Quaternion());
  return { ankle, foot, toes, yaw: leg.yaw };
}
