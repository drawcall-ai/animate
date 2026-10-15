import type { Quaternion, Vector3 } from 'three';
import { STEP, type Frame } from '../body';
import type { Placement } from '../goal';
import type { ReadonlyPose } from '../pose';
import type { JointCycle } from './cycle';
import { checkGait, offsetAt, strideAt, type LegGait, type Stride } from './gait';
import { Limb } from './limb';
import { yawOf } from '../math';

/** A connected chain with joint coordinates (ordered y, z, −x rotations) and foot geometry. Ranges come from the pose's skeleton. */
export interface LegChain {
  joints: readonly { bone: number; axes: string; cycle?: JointCycle }[];
  heel: Vector3;
  toe: Vector3;
  toes?: { bone: number; tip: Vector3 };
  toeOut: number;
  /** Lateral foothold offset in the root frame (m). Omitted: rest offset. */
  width?: number;
  /** Terminal pitch through stance, degrees, positive toes up. */
  rocker: JointCycle;
}

export interface LegState {
  planted: boolean;
  /** Local cycle phase, 0 at landing. */
  phase: number;
  /** Committed at lift-off: flat terminal origin and heading in world space. */
  foothold: { position: Vector3; yaw: number };
}

/** Engine scheduling state; public legs expose only phase, contact and foothold. */
export interface LegTiming extends LegState {
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
  private phase = 0;
  private time = 0;
  readonly legs: readonly Readonly<LegState>[];
  private readonly states: LegTiming[];
  /** Events from the last update only. No ETA or event history. */
  readonly events: ContactEvent[] = [];
  private readonly limbs: Limb[];
  private readonly strides: Stride[];

  constructor(pose: ReadonlyPose, private readonly chains: readonly LegChain[], private gait: LegGait) {
    checkGait(gait, chains.length);
    const bones = chains.flatMap((leg) => [...leg.joints.map((j) => j.bone), ...(leg.toes ? [leg.toes.bone] : [])]);
    if (new Set(bones).size !== bones.length) throw new Error('leg chains must not share bones');
    this.limbs = chains.map((leg) => new Limb(leg, pose));
    this.strides = chains.map((_, i) => strideAt(gait, 0, i));
    if (!this.strides.length) throw new Error('legs needs at least one chain');
    this.states = this.limbs.map((limb, i) => ({ planted: true, phase: 0, foothold: limb.standing(pose), footfall: before(offsetAt(gait, 0, i), 0), lift: 0 }));
    this.legs = this.states;
  }

  update(f: Frame, step: LegStep): void {
    const inputSpeed = step.speed;
    const speedAt = typeof inputSpeed === 'number' ? () => inputSpeed : inputSpeed;
    const speed = speedAt(f.time);
    if (step.gait && step.gait !== this.gait) {
      checkGait(step.gait, this.chains.length);
      this.gait = step.gait;
    }
    this.limbs.forEach((limb) => limb.check(f));
    this.time = f.time;
    this.events.length = 0;
    this.states.forEach((_, i) => { this.strides[i] = strideAt(this.gait, speed, i); });
    // Predict with the same fixed ticks as update, including the landing tick's phase overshoot.
    const phases = [0];
    const seconds = (cycles: number) => {
      while (phases[phases.length - 1] < cycles - 1e-9) {
        const t = f.time + phases.length * STEP;
        phases.push(phases[phases.length - 1] + strideAt(this.gait, speedAt(t), 0).frequency * STEP);
      }
      return phases.findIndex((phase) => phase >= cycles - 1e-9) * STEP;
    };
    this.phase += this.strides[0].frequency * f.dt;
    this.states.forEach((state, i) => {
      const stride = this.strides[i];
      const { frequency, duty, stepping } = stride;
      const walker = { phase: this.phase, stride, rootAt: (ahead: number, position: Vector3, turn: Quaternion) => {
        const root = step.root(f.time + seconds(ahead * frequency));
        position.copy(root.position);
        turn.copy(root.quaternion);
      } };
      const offset = offsetAt(this.gait, speed, i);
      if (!state.planted && this.phase >= state.footfall) {
        state.planted = true;
        this.event(i, 'land');
      } else if (state.planted && (this.phase - state.footfall >= duty || !this.limbs[i].supports(f.current, state, walker))) {
        const next = before(offset, this.phase) + 1;
        const ahead = (next + duty / 2 - this.phase) / frequency;
        const root = step.root(f.time + seconds(ahead * frequency));
        const limb = this.limbs[i];
        const anchor = limb.anchor.clone();
        if (limb.leg.width !== undefined) anchor.x += (limb.leg.width - anchor.x) * stepping;
        const to = anchor.applyQuaternion(root.quaternion).add(root.position).setY(state.foothold.position.y);
        const landing = (next - this.phase) / frequency;
        const yaw = yawOf(root.quaternion) + limb.leg.toeOut;
        limb.foothold(f.current, walker, landing, { position: to, yaw });
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
      this.limbs[i].pose(f, walker, state, this.gait.clearance[i]);
    });
  }

  private event(leg: number, type: ContactEvent['type']): void {
    const { position, yaw } = this.states[leg].foothold;
    this.events.push({ leg, type, time: this.time, foothold: { position: position.clone(), yaw } });
  }
}

const before = (offset: number, phase: number) => offset + Math.floor(phase - offset + 1e-9);
