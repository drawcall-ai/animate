import { Quaternion, Vector3 } from 'three';
import { STEP, type Frame } from '../body';
import type { Placement } from '../goal';
import type { ReadonlyPose } from '../pose';
import type { JointCycle } from './cycle';
import { checkGait, offsetAt, strideAt, speedOf, type LegGait } from './gait';
import { Limb, type Motion } from './limb';
import { yawOf } from '../math';

/** Terminal pitch keys `[stance fraction, degrees]`, minimum-jerk between keys, without wrapping. */
export interface Rocker {
  keys: readonly (readonly [number, number])[];
}

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
  rocker: Rocker;
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

  constructor(pose: ReadonlyPose, private readonly chains: readonly LegChain[], private gait: LegGait) {
    checkGait(gait, chains.length);
    const bones = chains.flatMap((leg) => [...leg.joints.map((j) => j.bone), ...(leg.toes ? [leg.toes.bone] : [])]);
    if (new Set(bones).size !== bones.length) throw new Error('leg chains must not share bones');
    this.limbs = chains.map((leg) => new Limb(leg, pose));
    if (!chains.length) throw new Error('legs needs at least one chain');
    this.states = this.limbs.map((limb, i) => ({ planted: true, phase: 0, foothold: limb.standing(pose), footfall: before(offsetAt(gait, 0, i), 0), lift: 0 }));
    this.legs = this.states;
  }

  update(f: Frame, step: LegStep): void {
    if (step.gait && step.gait !== this.gait) {
      checkGait(step.gait, this.chains.length);
      this.gait = step.gait;
    }
    this.limbs.forEach((limb) => limb.check(f));
    this.time = f.time;
    this.events.length = 0;
    const { speed, walkers } = this.motion(f, step);
    this.phase = walkers[0].phase;
    this.states.forEach((state, i) => {
      const walker = walkers[i];
      const { duty } = walker.stride;
      const offset = offsetAt(this.gait, speed, i);
      if (!state.planted && this.phase >= state.footfall) {
        state.planted = true;
        this.event(i, 'land');
      } else if (state.planted && (this.phase - state.footfall >= duty || !this.limbs[i].supports(f.current, state, walker))) {
        const next = before(offset, this.phase) + 1;
        const { landing, contact } = this.landing(walker, state, next, i);
        const limb = this.limbs[i];
        const { position: to, yaw } = contact;
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

  /**
   * Preflight the next update's landing reserve without posing or advancing the engine.
   * Call after earlier body writers, before update, with the same frame and root/speed forecast.
   * False: revise the forecast (e.g. lower its root height) and retry. At most ten reach
   * solves per leg, with no foothold search. True guarantees the proposed-stance check;
   * it does not certify existing contacts, swing clearance or balance.
   */
  supports(f: Frame, step: LegStep): boolean {
    const { speed, walkers, gait } = this.motion(f, step);
    return this.states.every((state, i) => {
      if (!state.planted) return true;
      const walker = walkers[i];
      if (walker.phase - state.footfall < walker.stride.duty && this.limbs[i].supports(f.current, state, walker)) return true;
      const next = before(offsetAt(gait, speed, i), walker.phase) + 1;
      const { landing, contact } = this.landing(walker, state, next, i);
      if (this.limbs[i].landingSupported(f.current, walker, landing, contact)) return true;
      contact.position.copy(this.limbs[i].standingAt(walker, landing, contact.position.y));
      return this.limbs[i].landingSupported(f.current, walker, landing, contact);
    });
  }

  private motion(f: Frame, step: LegStep) {
    const gait = step.gait ?? this.gait;
    checkGait(gait, this.chains.length);
    const input = step.speed;
    const speedAt = (t: number) => speedOf(typeof input === 'number' ? input : input(t));
    const speed = speedAt(f.time);
    const strides = this.chains.map((_, i) => strideAt(gait, speed, i));
    const phase = this.phase + strides[0].frequency * f.dt;
    // Include the landing tick's phase overshoot, exactly as update does.
    const phases = [0];
    const seconds = (cycles: number) => {
      while (phases[phases.length - 1] < cycles - 1e-9) {
        const t = f.time + phases.length * STEP;
        phases.push(phases[phases.length - 1] + strideAt(gait, speedAt(t), 0).frequency * STEP);
      }
      return phases.findIndex((value) => value >= cycles - 1e-9) * STEP;
    };
    const walkers: Motion[] = strides.map((stride) => ({
      phase, stride,
      rootAt: (ahead, position, turn) => {
        const root = step.root(f.time + seconds(ahead * stride.frequency));
        position.copy(root.position);
        turn.copy(root.quaternion);
      },
    }));
    return { speed, walkers, gait };
  }

  private landing(walker: Motion, state: LegTiming, next: number, i: number) {
    const { frequency, duty, stepping } = walker.stride;
    const limb = this.limbs[i];
    const position = new Vector3();
    const turn = new Quaternion();
    walker.rootAt((next + duty / 2 - walker.phase) / frequency, position, turn);
    const anchor = limb.anchor.clone();
    if (limb.leg.width !== undefined) anchor.x += (limb.leg.width - anchor.x) * stepping;
    const to = anchor.applyQuaternion(turn).add(position).setY(state.foothold.position.y);
    return { landing: (next - walker.phase) / frequency, contact: { position: to, yaw: yawOf(turn) + limb.leg.toeOut } };
  }

  private event(leg: number, type: ContactEvent['type']): void {
    const { position, yaw } = this.states[leg].foothold;
    this.events.push({ leg, type, time: this.time, foothold: { position: position.clone(), yaw } });
  }
}

const before = (offset: number, phase: number) => offset + Math.floor(phase - offset + 1e-9);
