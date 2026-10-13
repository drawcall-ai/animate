import { Vector3 } from 'three';
import type { Merged } from './board';
import { brakeAtLimit, fit } from './fit';
import { inertia, positionBlock } from './jacobian';
import { accelerationOf, capJoint, type Joint } from './joints';
import { project, weighted } from './projection';
import { dof, type Skeleton } from './skeleton';
import { BodyState } from './state';
import type { Point } from './types';

/**
 * Advances a body's state by one sub-step under merged proposals:
 * 1. impulses change the velocity;
 * 2. the soft solve (`fit`) gives the velocity toward the pose the targets and contacts ask,
 *    within the limits and braking in time for the caps, at the closest pose and at the limits;
 * 3. the hard projection (`project`) meets the winning contacts as closely as they can be met,
 *    the joints at their caps heavier and the root the last resort;
 * 4. velocities are the actual change over the step, each joint's acceleration clamped to its
 *    cap (the projection repositions joints; it does not set them spinning).
 * There is no gravity: support and balance are the behaviours'.
 */
export class Solver {
  /** the pose after the soft solve, before the projection (what the body could do on its own) */
  readonly soft: BodyState;
  private readonly start: BodyState;
  private readonly trial: BodyState;
  private readonly joints: Joint[];

  constructor(readonly skeleton: Skeleton) {
    this.soft = new BodyState(skeleton);
    this.start = new BodyState(skeleton);
    this.trial = new BodyState(skeleton);
    this.joints = [{ d: 0, cap: Infinity }, ...skeleton.bones.map((_, bone) => ({ d: dof(bone), cap: Infinity, bone }))];
  }

  step(state: BodyState, merged: Merged, dt: number): void {
    const n = this.skeleton.dofs;
    state.loads = merged.loads;
    state.forward();
    this.start.copyPose(state);
    this.joints.forEach((j) => (j.cap = j.bone === undefined ? merged.translationCap : merged.caps[j.bone]));

    const v0 = state.readRates(new Float64Array(n));
    for (const i of merged.impulses) addImpulse(state, i.point, i.velocity, v0);

    const next = fit(merged, this.start, this.joints, v0, dt, this.trial);
    for (const j of this.joints) {
      brakeAtLimit(j, next, merged, this.start, dt);
      capJoint(j, next, v0, dt);
    }
    state.move(next, dt);
    this.soft.copyPose(state);

    // the root's position may end within its cap of where its velocity carries it
    const reach = new Vector3(v0[0], v0[1], v0[2]).multiplyScalar(dt).add(this.start.position);
    const stuck = this.joints.filter((j) => j.cap < Infinity && accelerationOf(j, next, v0, dt) >= j.cap * (1 - 1e-9));
    project(state, this.trial, merged, stuck, { center: reach, radius: merged.translationCap * dt * dt });

    // the velocities are the actual change, but no joint gains more from the projection than
    // its cap allows (a contact may move a joint, not set it spinning)
    const rates = state.since(this.start, new Float64Array(n)).map((x) => x / dt);
    if (!rates.every(Number.isFinite)) throw new Error('the solve diverged: a coordinate is not finite');
    for (const j of this.joints) capJoint(j, rates, v0, dt);
    state.writeRates(rates);
    state.derive();
  }
}

/** adds to `rates` the velocity change `velocity` at `point`, mass-weighted over the coordinates */
function addImpulse(state: BodyState, point: Point, velocity: Vector3, rates: Float64Array): void {
  const M = inertia(state, new Float64Array(rates.length));
  weighted(positionBlock(state, point), M, velocity.toArray(), 1e-12).forEach((x, d) => (rates[d] += x));
}

