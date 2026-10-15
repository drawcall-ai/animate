import type { Vector3 } from 'three';
import type { Frame } from '../body';
import type { Placement } from '../goal';
import type { ReadonlyPose } from '../pose';
import type { Cycle } from './cycle';
import { offsetAt, strideAt, type LegGait, type Stride } from './gait';
import { headingOf, Limb } from './limb';

/** A connected chain with joint coordinates (ordered y, z, −x rotations) and foot geometry. Ranges come from the pose's skeleton. */
export interface Leg {
  bones: readonly number[];
  axes: readonly string[];
  heel: Vector3;
  toe: Vector3;
  toes?: { bone: number; tip: Vector3 };
  toeOut: number;
  /** Maximum multiplier of the reference swing shape. Default 1 (unamplified). */
  swingScale?: number;
  /** Lateral foothold offset in the root frame (m). Omitted: rest offset. */
  width?: number;
  cycles: ReadonlyMap<number, Cycle>;
  /** Terminal pitch through stance, degrees, positive toes up. */
  rocker: Cycle;
}

export interface LegState {
  planted: boolean;
  /** Local cycle phase, 0 at landing. */
  phase: number;
  /** Committed at lift-off: flat terminal origin and heading in world space. */
  foothold: { position: Vector3; yaw: number };
  /** Unwrapped scheduled landing and lift-off phases. */
  footfall: number;
  lift: number;
}

export interface ContactEvent {
  leg: number;
  type: 'lift' | 'land';
  time: number;
  foothold: { position: Vector3; yaw: number };
}

export interface LegStep {
  /** Absolute world root placement at a time in seconds. Used only for prediction; the caller writes the root. */
  root(time: number): Required<Placement>;
  speed: number | ((time: number) => number);
  gait?: LegGait;
}

/** Stateful leg solver, like IK: write the root first, then update. Never writes the root or plans balance. Ground is y=0. */
export class Legs {
  phase = 0;
  time = 0;
  readonly legs: LegState[];
  /** Events from the last update only. No ETA or event history. */
  readonly events: ContactEvent[] = [];
  readonly limbs: Limb[];
  private readonly strides: Stride[];

  constructor(pose: ReadonlyPose, readonly chains: readonly Leg[], public gait: LegGait) {
    if (!(gait.height > 0 && gait.slowest > 0) || gait.contacts.length !== chains.length || gait.clearance.length !== chains.length) throw new Error('gait and chains do not match');
    const bones = chains.flatMap((leg) => [...leg.bones, ...(leg.toes ? [leg.toes.bone] : [])]);
    if (new Set(bones).size !== bones.length) throw new Error('leg chains must not share bones');
    this.limbs = chains.map((leg) => new Limb(leg, pose));
    this.strides = chains.map((_, i) => strideAt(gait, 0, i));
    if (!this.strides.length) throw new Error('legs needs at least one chain');
    this.legs = this.limbs.map((limb, i) => ({ planted: true, phase: 0, foothold: limb.standing(pose), footfall: before(offsetAt(gait, 0, i), 0), lift: 0 }));
  }

  update(f: Frame, step: LegStep): void {
    const inputSpeed = step.speed;
    const speedAt = typeof inputSpeed === 'number' ? () => inputSpeed : inputSpeed;
    const speed = speedAt(f.time);
    if (!(speed >= 0 && Number.isFinite(speed))) throw new Error('leg speed must be finite and nonnegative');
    if (step.gait) this.gait = step.gait;
    if (this.gait.contacts.length !== this.legs.length || this.gait.clearance.length !== this.legs.length) throw new Error('gait and chains do not match');
    this.limbs.forEach((limb) => limb.check(f));
    this.time = f.time;
    this.events.length = 0;
    this.legs.forEach((_, i) => {
      const now = strideAt(this.gait, speed, i);
      const soon = speedAt(f.time + 0.5 / now.frequency);
      this.strides[i] = strideAt(this.gait, Math.max(speed, soon), i);
    });
    this.phase += this.strides[0].frequency * f.dt;
    this.legs.forEach((state, i) => {
      const stride = this.strides[i];
      const { frequency, duty, stepping } = stride;
      const offset = offsetAt(this.gait, speed, i);
      if (!state.planted && this.phase >= state.footfall) {
        state.planted = true;
        this.event(i, 'land');
      } else if (state.planted && this.phase - state.footfall >= duty) {
        const next = before(offset, this.phase) + 1;
        const ahead = (next + duty / 2 - this.phase) / frequency;
        const root = step.root(f.time + ahead);
        const limb = this.limbs[i];
        const anchor = limb.anchor.clone();
        if (limb.leg.width !== undefined) anchor.x += (limb.leg.width - anchor.x) * stepping;
        const to = anchor.applyQuaternion(root.quaternion).add(root.position).setY(state.foothold.position.y);
        const yaw = headingOf(root.quaternion) + limb.leg.toeOut;
        // Numerical identity only: a stopped root takes no new steps.
        if (to.distanceTo(state.foothold.position) > 1e-6 || Math.abs(yaw - state.foothold.yaw) > 1e-6) {
          state.planted = false;
          state.lift = this.phase;
          state.footfall = next;
          state.foothold.position.copy(to);
          state.foothold.yaw = yaw;
          limb.lift();
          this.event(i, 'lift');
        } else state.footfall = before(offset, this.phase);
      }
      state.phase = this.phase - state.footfall + (state.planted ? 0 : 1);
      this.limbs[i].pose(f, { phase: this.phase, stride, rootAt: (ahead, position, turn) => {
        const root = step.root(f.time + ahead);
        position.copy(root.position);
        turn.copy(root.quaternion);
      } }, state, this.gait.clearance[i]);
    });
  }

  private event(leg: number, type: ContactEvent['type']): void {
    const { position, yaw } = this.legs[leg].foothold;
    this.events.push({ leg, type, time: this.time, foothold: { position: position.clone(), yaw } });
  }
}

const before = (offset: number, phase: number) => offset + Math.floor(phase - offset + 1e-9);
