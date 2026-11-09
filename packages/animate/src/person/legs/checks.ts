// A person's legs and balance checked in development, against the final pose of the last sub-step.
import { Vector3 } from 'three';
import type { Dev } from '../../kernel/dev';
import type { Frame } from '../../kernel/frame';
import { pointSegmentDistance } from '../../kernel/math';
import type { LegGoal } from '../../step/leg-goal';
import { runs } from '../../step/thresholds';
import { bears, hullOf, outside, xcomOf } from '../../step/support';
import { INDEX, SIDES, type Side } from '../anatomy/bones';
import { solePoints } from '../anatomy/landmarks';
import type { Person } from '../person';
import { ballOf, footprint, footRotation, heelOf, heelSides } from './foot';
import type { Leg } from '../../step/types';

/** Development bounds: planted pivot slide (m), touchdown speeds (m/s), closest shanks (m, ~their thickness), a walker's XCoM (m, default body: lengths of a body scale with it), a
 * planted sole's sink into its floor and its lowest point's rise off it (m: rolling over its heel or ball, a rigged sole's points stand
 * up to ~1.1 cm off a flat floor). */
const LIMIT = { slide: 0.001, vertical: 0.1, horizontal: 1, across: 0.06, xcom: 0.1, sunk: 0.01, raised: 0.02 };
/** Tuned (m/s, × scale): a body this slow is still (quiet stance sways a few mm/s — read: Winter 1995, Gait Posture 3:193) */
const MOVING = 0.1;

/** Final-pose checks of the last sub-step, against the legs as they were posed then. */
export function checkLegs(person: Person, f: Frame, dev: Dev, legs: readonly Leg[]) {
  const proportions = person.proportions, time = f.time - f.dt;
  legs.forEach((leg, i) => {
    const side = SIDES[i], bone = INDEX[`${side}Foot`];
    // (each sole point against the floor under it: a swinging sole never in it; a planted one on it — the whole sole on one level — no
    // deeper than `LIMIT.sunk`, its lowest no higher than `LIMIT.raised`)
    const above = solePoints(person.proportions, f.prev, side).map((at) => at.y - person.floor(at.x, at.z));
    if (leg.swing) {
      const sink = -Math.min(...above);
      if (sink > 0.002) dev.append(time, { check: 'swing sole sink (m)', value: sink, limit: 0.002, where: `${side}Foot` });
      return;
    }
    const sunk = -Math.min(...above), raised = Math.min(...above);
    if (sunk > LIMIT.sunk) dev.append(time, { check: 'planted sole in the floor (m)', value: sunk, limit: LIMIT.sunk, where: `${side}Foot` });
    if (raised > LIMIT.raised) dev.append(time, { check: 'planted sole off the floor (m)', value: raised, limit: LIMIT.raised, where: `${side}Foot` });
    const pivots = leg.pitch > 0 ? [heelOf(proportions)] : leg.pitch < 0 ? [ballOf(proportions, side)] : [heelOf(proportions), ballOf(proportions, side)];
    for (const pivot of pivots) {
      const at = f.prev.point(bone, pivot, new Vector3());
      const slide = at.distanceTo(pivot.clone().applyQuaternion(footRotation(leg.yaw, 0)).add(leg.anchor));
      if (slide > LIMIT.slide) dev.append(time, { check: 'planted slide (m)', value: slide, limit: LIMIT.slide, where: `${side}Foot` });
      if (!leg.landed) continue;
      const was = f.prev2.point(bone, pivot, new Vector3());
      const vertical = Math.abs(at.y - was.y) / f.dt, horizontal = Math.hypot(at.x - was.x, at.z - was.z) / f.dt;
      // (landing a leap the foot comes down with the body, the knees taking up the fall after: only its horizontal speed is bounded)
      if (vertical > LIMIT.vertical && !leg.leapt) dev.append(time, { check: 'touchdown vertical speed (m/s)', value: vertical, limit: LIMIT.vertical, where: `${side}Foot` });
      if (horizontal > LIMIT.horizontal) dev.append(time, { check: 'touchdown horizontal speed (m/s)', value: horizontal, limit: LIMIT.horizontal, where: `${side}Foot` });
    }
  });
  // (the shanks never closer than their thickness: legs that cross pass through each other)
  const shank = (side: Side) => [f.prev.position(INDEX[`${side}LowerLeg`]), f.prev.position(INDEX[`${side}Foot`])];
  const [left, right] = [shank('left'), shank('right')];
  const gap = Math.min(...[0, 0.25, 0.5, 0.75, 1].flatMap((k) => [
    pointSegmentDistance(new Vector3().lerpVectors(left[0], left[1], k), right[0], right[1]),
    pointSegmentDistance(new Vector3().lerpVectors(right[0], right[1], k), left[0], left[1]),
  ]));
  if (gap < LIMIT.across * proportions.scale) dev.append(time, { check: 'legs crossed (m)', value: LIMIT.across * proportions.scale - gap, limit: 0, where: 'legs' });
}

/**
 * XCoM from the final pose; the support includes a swing's committed landing (Hof's next-step capture) — but not that of a foot lifted from
 * under a still body's weight (slower than `MOVING`, the weight on it: `bears`) till the body moves:
 * falling toward no landing, it stood on the other foot alone meanwhile. A planted sole supports as wide as its heel (`heelSides`).
 */
export function checkSupport(person: Person, f: Frame, dev: Dev, going: LegGoal | null): void {
  if (f.time <= f.dt) return;
  const com = f.prev.com(new Vector3());
  const velocity = com.clone().sub(f.prev2.com(new Vector3())).divideScalar(f.dt);
  const xcom = xcomOf(com, velocity, person.proportions.legLength, new Vector3());
  const legs = person.stepper?.legs ?? [], { proportions } = person, s = proportions.scale;
  const soles = (i: number) => {
    const side = SIDES[i], foot = INDEX[`${side}Foot`];
    const heels = heelSides(proportions).map((at) => f.prev.point(foot, at, at));
    return [...solePoints(proportions, f.prev, side), ...heels].map((at): [number, number] => [at.x, at.z]);
  };
  const moving = Math.hypot(velocity.x, velocity.z) >= MOVING * s;
  legs.forEach((leg, i) => {
    const w = leg.swing;
    if (!w || w.seen) return;
    w.seen = true;
    const planted = legs.flatMap((other, k) => other.swing ? [] : soles(k));
    if (!moving && planted.length && bears(xcom, soles(i), planted, s)) w.borne = true;
  });
  for (const leg of legs) if (leg.swing && moving) leg.swing.borne = false;
  const support = legs.flatMap((leg, i) => leg.swing ? leg.swing.borne ? [] : footprint(proportions, leg.anchor, leg.yaw) : soles(i)).concat(person.seat?.support ?? []);
  if (!support.length) return;
  const hull = hullOf(support);
  if (person.locomotion.settled && legs.every((leg) => !leg.swing) && Math.hypot(velocity.x, velocity.z) < 0.05) {
    const value = outside(hull, com);
    if (value > 0.001) dev.append(f.time - f.dt, { check: 'standing CoM outside the feet (m)', value, limit: 0.001, where: 'hips' });
  }
  const value = outside(hull, xcom);
  // (none for a run, set off or brought to a stop: the reading is an inverted pendulum's standing on a centre of pressure (read: Hof et al.
  // 2005, its assumptions: constant length, a base of support); a flight has none)
  if (value > LIMIT.xcom * s && !(person.stepper && runs(person.stepper.st, going?.speed ?? 0))) dev.append(f.time - f.dt, { check: 'XCoM outside support (m)', value, limit: LIMIT.xcom * s, where: 'hips' });
}
