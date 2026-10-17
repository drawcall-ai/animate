import { Quaternion, Vector3 } from 'three';
import { STEP, type Frame } from '../body';
import type { Motion, Placement, Target } from '../goal';
import type { ReadonlyPose } from '../pose';
import type { JointCycle } from './cycle';
import { checkGait, offsetAt, strideAt, speedOf, type LegGait } from './gait';
import { rootPlan } from './root';
import { HORIZON, Limb, type Walker } from './limb';
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
  rocker: readonly (readonly [number, number])[];
}

export interface LegState {
  planted: boolean;
  /** Local cycle phase, 0 at landing. */
  phase: number;
  /** Committed at lift-off: flat terminal origin and heading in world space. */
  foothold: { position: Vector3; yaw: number };
}

/** Engine scheduling state; public legs expose only phase, contact and foothold. */
interface LegTiming extends LegState {
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

interface LegMotion {
  speed: number;
  walkers: Walker[];
  gait: LegGait;
}

/** Stateful leg solver: write a root then `update`, or let `toward` preflight and move it. Ground is y=0. */
export class Legs {
  private readonly standingHeight: number;
  private phase = 0;
  private time = 0;
  readonly legs: readonly Readonly<LegState>[];
  private readonly states: LegTiming[];
  /** Events from the last update only. No ETA or event history. */
  readonly events: ContactEvent[] = [];
  private readonly limbs: Limb[];

  constructor(pose: ReadonlyPose, private readonly chains: readonly LegChain[], private gait: LegGait) {
    if (!chains.length) throw new Error('legs needs at least one chain');
    this.standingHeight = pose.position(0).y;
    checkGait(gait, chains.length);
    const bones = chains.flatMap((leg) => [...leg.joints.map((j) => j.bone), ...(leg.toes ? [leg.toes.bone] : [])]);
    if (new Set(bones).size !== bones.length) throw new Error('leg chains must not share bones');
    this.limbs = chains.map((leg) => new Limb(leg, pose));
    this.states = this.limbs.map((limb, i) => ({ planted: true, phase: 0, foothold: limb.standing(pose), footfall: before(offsetAt(gait, 0, i), 0), lift: 0 }));
    this.legs = this.states;
  }

  /** Move and face a floor-plane goal, shortening the forecast until the legs support it.
   * Braking speed follows v² = 2ad; heading turns no faster than a/v (lateral acceleration).
   * Target velocity predicts continuing travel until touchdown.
   * Motion values belong to the caller; this controller has no species-specific gains.
   * Goals outside the forward cone brake and wait until they move ahead. Throws only if no supported forecast exists.
   */
  toward(f: Frame, goal: Pick<Target, 'position' | 'velocity'>, motion: Motion): void {
    if (!(motion.accel > 0 && Number.isFinite(motion.accel)) || (motion.speed !== undefined && !(motion.speed >= 0 && Number.isFinite(motion.speed)))) throw new Error('root motion needs finite positive acceleration and nonnegative speed');
    if (![goal.position.x, goal.position.y, goal.position.z, ...(goal.velocity?.toArray() ?? [])].every(Number.isFinite)) throw new Error('root goal must be finite');
    if ([motion.turnAccel, motion.turnSpeed].some((value) => value !== undefined && !(value >= 0 && Number.isFinite(value)))) throw new Error('root turn motion must be finite and nonnegative');
    const radius = Math.max(...this.limbs.map((limb) => Math.hypot(limb.anchor.x, limb.anchor.z)));
    const height = f.prev.position(0).y;
    // Restore standing height by at most 2 mm per tick; preflight supplies the reserve.
    const rise = Math.max(-0.002, Math.min(0.002, this.standingHeight - height));
    let offset = 0;
    let share = 1;
    let step: LegStep | undefined;
    let first = 0;
    const supported = (plan: LegStep) => {
      const predicted = this.motion(f, plan);
      for (let k = 0; k < this.states.length; k++) {
        const i = (first + k) % this.states.length, state = this.states[i];
        const walker = predicted.walkers[i];
        const left = walker.timeTo(state.footfall);
        if (this.supportsLeg(f, predicted, i) && (state.planted || left > HORIZON || this.limbs[i].landingSupported(f.current, walker, Math.max(0, left), state.foothold))) continue;
        // The failed constraint is most likely to reject the next nearby height too.
        first = i;
        return false;
      }
      return true;
    };
    // Inherited search: ±12 cm in 2 mm increments; 24 travel shares reach
    // ~0.0013, then try waiting with the same height reserve.
    // Every candidate meets the same support checks.
    let found = false;
    for (let retry = 0; retry <= 24 && !found; retry++) {
      // Height does not change pursuit or speed: integrate once for this travel share.
      const plan = rootPlan(f, goal.position, goal.velocity ?? new Vector3(), motion, this.gait, radius, share);
      const position = new Vector3(), adjustment = share === 0 ? 0 : rise;
      step = { speed: plan.speed, root: (time) => {
        const at = plan.root(time);
        return { position: position.copy(at.position).setY(height + (adjustment + offset)), quaternion: at.quaternion };
      } };
      for (let k = 0; k <= 60 && !found; k++) {
        for (const direction of [1, -1]) {
          offset = direction * k * 0.002;
          if (!supported(step)) continue;
          found = true;
          break;
        }
      }
      if (!found) share = retry === 23 ? 0 : share * 0.75;
    }
    if (!found || !step) throw new Error('legs cannot support root follower');
    const at = step.root(f.time);
    f.current.setRoot(at.position);
    f.current.setLocal(0, at.quaternion);
    this.update(f, step);
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
   * False: revise the forecast (e.g. adjust the root's height or slow down) and retry. At most ten reach
   * solves per leg, with no foothold search. True guarantees the proposed-stance check;
   * it does not certify existing contacts, swing clearance or balance.
   */
  supports(f: Frame, step: LegStep): boolean {
    const predicted = this.motion(f, step);
    return this.states.every((_, i) => this.supportsLeg(f, predicted, i));
  }

  private supportsLeg(f: Frame, { speed, walkers, gait }: LegMotion, i: number): boolean {
    const state = this.states[i];
    if (!state.planted) return true;
    const walker = walkers[i], limb = this.limbs[i];
    if (walker.phase - state.footfall < walker.stride.duty && limb.supports(f.current, state, walker)) return true;
    const next = before(offsetAt(gait, speed, i), walker.phase) + 1;
    const { landing, contact } = this.landing(walker, state, next, i);
    if (limb.landingSupported(f.current, walker, landing, contact)) return true;
    contact.position.copy(limb.standingAt(walker, landing, contact.position.y));
    return limb.landingSupported(f.current, walker, landing, contact);
  }

  private motion(f: Frame, step: LegStep): LegMotion {
    const gait = step.gait ?? this.gait;
    if (gait !== this.gait) checkGait(gait, this.chains.length);
    const input = step.speed;
    const speedAt = (t: number) => speedOf(typeof input === 'number' ? input : input(t));
    const speed = speedAt(f.time);
    const strides = this.chains.map((_, i) => strideAt(gait, speed, i));
    const phase = this.phase + (speed > 0 || this.states.some((state) => !state.planted) ? strides[0].frequency * f.dt : 0);
    const phases = [phase];
    const advance = () => phases.push(phases[phases.length - 1] + strideAt(gait, speedAt(f.time + phases.length * STEP), 0).frequency * STEP);
    const timeTo = (landing: number) => {
      while (phases[phases.length - 1] < landing - 1e-9) advance();
      return Math.max(0, phases.findIndex((value) => value >= landing - 1e-9)) * STEP;
    };
    const walkers: Walker[] = strides.map((stride, i) => ({
      phase, stride, timeTo, previous: f.prev,
      at: (ahead) => {
        const ticks = Math.max(0, Math.ceil(ahead / STEP - 1e-9));
        while (phases.length <= ticks) advance();
        return { phase: phases[ticks], stride: strideAt(gait, speedAt(f.time + ticks * STEP), i) };
      },
      rootAt: (ahead, position, turn) => {
        const root = step.root(f.time + Math.max(0, Math.ceil(ahead / STEP - 1e-9)) * STEP);
        position.copy(root.position);
        turn.copy(root.quaternion);
      },
    }));
    return { speed, walkers, gait };
  }

  private landing(walker: Walker, state: LegTiming, next: number, i: number) {
    const { duty, stepping } = walker.stride;
    const limb = this.limbs[i];
    const position = new Vector3();
    const turn = new Quaternion();
    walker.rootAt(walker.timeTo(next + (walker.stride.stanceCenter ?? duty / 2)), position, turn);
    const anchor = limb.anchor.clone();
    if (limb.leg.width !== undefined) anchor.x += (limb.leg.width - anchor.x) * stepping;
    const to = anchor.applyQuaternion(turn).add(position).setY(state.foothold.position.y);
    return { landing: walker.timeTo(next), contact: { position: to, yaw: yawOf(turn) + limb.leg.toeOut } };
  }

  private event(leg: number, type: ContactEvent['type']): void {
    const { position, yaw } = this.states[leg].foothold;
    this.events.push({ leg, type, time: this.time, foothold: { position: position.clone(), yaw } });
  }
}

const before = (offset: number, phase: number) => offset + Math.floor(phase - offset + 1e-9);
