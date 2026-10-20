import { Quaternion, Vector3 } from 'three';
import { STEP, type Frame } from '../body';
import type { Motion, Placement, Target } from '../goal';
import type { ReadonlyPose } from '../pose';
import type { JointCycle } from './cycle';
import { checkGait, offsetAt, strideAt, speedOf, type Gait } from './gait';
import { rootPlan, type RootState } from './root';
import { HORIZON, Limb, type Walker } from './limb';
import { wrapAngle, yawOf } from '../math';
import { quintic } from './swing';

/** A leg: a connected chain of joints from its top (a hip, a shoulder) to its foot, and the foot's geometry. Ranges come from the pose's skeleton. */
export interface LegChain {
  /**
   * each joint, top first, the last the foot: the axes it turns about, of `y` (twist), `z` (sideways), `x` (fore and aft), in
   * that order (`'yzx'` a ball joint, `'x'` a hinge, `'zx'` a foot that also tilts sideways); `cycle` the reference its `x`
   * angle follows over a stride (omitted: its rest)
   */
  joints: readonly { bone: number; axes: string; cycle?: JointCycle }[];
  /** the sole's back and front, where they touch the floor, in the foot bone's frame (m) */
  heel: Vector3;
  toe: Vector3;
  /** a toes bone after the foot, and its tip in that bone's frame */
  toes?: { bone: number; tip: Vector3 };
  /** how far the foot turns out from the facing (rad) */
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
  /** Floor-plane travel frame for footholds when the body root carries independent posture. */
  travel?(time: number): Required<Placement>;
  /** Path bearing (rad) when facing is independent; undefined while stationary. Otherwise root yaw supplies curvature. */
  heading?(time: number): number | undefined;
  gait?: Gait;
}

interface LegMotion {
  speed: number;
  nextLift: number;
  walkers: Walker[];
  gait: Gait;
}

/** Stateful leg solver: write a root then `update`, or let `toward` preflight and move it. Ground is y=0. */
export class Legs {
  private readonly standingHeight: number;
  /** Pursuit root and velocity, before the caller’s pelvis/trunk overlay. */
  readonly root: RootState;
  private cycle = 0;
  get phase(): number { return this.cycle; }
  private time = 0;
  readonly legs: readonly Readonly<LegState>[];
  private readonly states: LegTiming[];
  /** Events from the last update only. No ETA or event history. */
  readonly events: ContactEvent[] = [];
  private readonly limbs: Limb[];
  private readonly posture = new Quaternion();
  private goalVelocity: Vector3 | null = null;
  private reserve: [number, number, number] = [0, 0, 0];
  private reserveGoal = 0;
  /** Heading predicted half a second ahead by the accepted root plan. */
  readonly facingAhead = new Quaternion();
  private readonly contacts = new Map<number, { phase: number; contact: ContactEvent['foothold'] }>();
  private stance: ContactEvent['foothold'][] | null = null;

  private offAnchor(i: number): boolean {
    const goal = this.stance?.[i], foot = this.states[i].foothold;
    return !!goal && (goal.position.distanceTo(foot.position) > SETTLE || Math.abs(wrapAngle(goal.yaw - foot.yaw)) > SQUARE);
  }
  private get settling(): boolean { return this.states.some((_, i) => this.offAnchor(i)); }

  get settled(): boolean { return !this.settling && this.states.every((state) => state.planted); }

  /** Standing terminal pitch (degrees), separate from the chain geometry; a hoof rests on its toe. */
  rest(pitches: readonly number[]): void {
    if (pitches.length !== this.limbs.length || !pitches.every(Number.isFinite)) throw new Error('rest needs one finite pitch per leg');
    this.limbs.forEach((limb, i) => { limb.restPitch = pitches[i]; });
  }

  constructor(pose: ReadonlyPose, private readonly chains: readonly LegChain[], private gait: Gait) {
    if (!chains.length) throw new Error('legs needs at least one chain');
    this.standingHeight = pose.position(0).y;
    this.root = { position: pose.position(0).clone(), quaternion: new Quaternion().setFromAxisAngle(UP, yawOf(pose.rotation(0))), velocity: new Vector3(), angular: 0 };
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
   * `carry` forecasts the body pose over the locomotion root, for both preflight and posing.
   * With a facing, turn toward goals outside the forward cone before travelling. Otherwise brake and wait. Throws only if no supported forecast exists.
   */
  toward(f: Frame, goal: Pick<Target, 'position' | 'velocity' | 'quaternion'>, motion: Motion, carry?: (root: RootState, phase: number, time: number) => Required<Placement>): void {
    if (!(motion.accel > 0 && Number.isFinite(motion.accel)) || (motion.speed !== undefined && !(motion.speed >= 0 && Number.isFinite(motion.speed)))) throw new Error('root motion needs finite positive acceleration and nonnegative speed');
    if (![goal.position.x, goal.position.y, goal.position.z, ...(goal.velocity?.toArray() ?? []), ...(goal.quaternion?.toArray() ?? [])].every(Number.isFinite)) throw new Error('root goal must be finite');
    if ([motion.turnAccel, motion.turnSpeed].some((value) => value !== undefined && !(value >= 0 && Number.isFinite(value)))) throw new Error('root turn motion must be finite and nonnegative');
    const fullStance = !!(carry || goal.quaternion);
    const from = carry ? this.root : { position: f.prev.position(0).clone(), quaternion: f.prev.rotation(0).clone(),
      velocity: f.prev.position(0).clone().sub(f.prev2.position(0)).setY(0).divideScalar(f.dt),
      angular: wrapAngle(yawOf(f.prev.rotation(0)) - yawOf(f.prev2.rotation(0))) / f.dt };
    this.stance = fullStance && from.velocity.lengthSq() === 0
      ? this.limbs.map((limb, i) => ({ position: limb.anchor.clone().applyQuaternion(from.quaternion).add(from.position).setY(this.states[i].foothold.position.y), yaw: yawOf(from.quaternion) + this.chains[i].toeOut })) : null;
    const yaw = yawOf(from.quaternion);
    const stanceYaw = yaw + this.states.reduce((sum, state, i) => sum + wrapAngle(state.foothold.yaw - this.chains[i].toeOut - yaw), 0) / this.states.length;
    const velocity = goal.velocity ?? new Vector3();
    const goalSpeed = velocity.length();
    const acceleration = carry && this.goalVelocity && goalSpeed > 1e-6
      ? Math.max(-motion.accel, Math.min(motion.accel, velocity.clone().sub(this.goalVelocity).dot(velocity) / (goalSpeed * f.dt))) : 0;
    const goalTurn = carry && this.goalVelocity && goalSpeed > 1e-6 && this.goalVelocity.lengthSq() > 1e-12
      ? wrapAngle(Math.atan2(velocity.x, velocity.z) - Math.atan2(this.goalVelocity.x, this.goalVelocity.z)) / f.dt : 0;
    (this.goalVelocity ??= new Vector3()).copy(velocity);
    const radius = Math.max(...this.limbs.map((limb) => Math.hypot(limb.anchor.x, limb.anchor.z)));
    const height = f.current.position(0).y;
    const reserve = this.reserve;
    const posture = this.posture.setFromAxisAngle(UP, -yawOf(f.current.rotation(0))).multiply(f.current.rotation(0));
    // Restore standing height by at most 2 mm per tick; preflight supplies the reserve.
    const rise = Math.max(-0.002, Math.min(0.002, this.standingHeight - height));
    let offset = 0;
    let share = 1, turnShare = 1, turning = false;
    let step: LegStep | undefined;
    let travel: LegStep | undefined;
    let first = 0, turnLimited = false;
    const supported = (plan: LegStep) => {
      turnLimited = false;
      this.contacts.clear();
      const predicted = this.motion(f, plan);
      for (let k = 0; k < this.states.length; k++) {
        const i = (first + k) % this.states.length, state = this.states[i];
        const walker = predicted.walkers[i];
        const left = walker.timeTo(state.footfall);
        const supported = fullStance ? this.carriesLeg(f, predicted, i) : this.supportsLeg(f, predicted, i);
        if (supported && (state.planted || (!fullStance && left > HORIZON) || (fullStance ? this.limbs[i].stanceSupported(f.current, walker, left, state.foothold, state.footfall) : this.limbs[i].landingSupported(f.current, walker, left, state.foothold)))) continue;
        // The failed constraint is most likely to reject the next nearby height too.
        first = i;
        turnLimited = this.limbs[i].turnLimited;
        return false;
      }
      return true;
    };
    // Inherited search: ±12 cm in 2 mm increments; 24 travel shares reach
    // ~0.0013, then try waiting with the same height reserve.
    // Every candidate meets the same support checks.
    let found = false;
    for (let retry = 0; retry <= (turning ? 48 : 24) && !found; retry++) {
      // Height does not change pursuit or speed: integrate once for this travel share.
      const plan = rootPlan(f, goal.position, velocity, motion, this.gait, radius, fullStance && share > 0 ? 1 : share, from, acceleration, goal.quaternion, turnShare, goalTurn, fullStance ? share : 1, stanceYaw);
      if (retry === 0) turning = fullStance && (Math.abs(plan.root(f.time).angular) > 1e-9 || Math.abs(plan.root(f.time + 0.5).angular) > 1e-9);
      travel = plan;
      const position = new Vector3(), adjustment = share === 0 || fullStance ? 0 : rise;
      const swinging = this.states.some((state) => !state.planted) || this.settling;
      const advance = (time: number) => {
        const speed = typeof plan.speed === 'number' ? plan.speed : plan.speed(time);
        return strideAt(this.gait, speed, 0).frequency * STEP;
      };
      const nowSpeed = typeof plan.speed === 'number' ? plan.speed : plan.speed(f.time);
      const phases = [this.cycle + (nowSpeed > 0 || swinging ? advance(f.time) : 0)];
      const poses: Required<Placement>[] = [];
      step = { speed: plan.speed, heading: plan.heading, travel: fullStance ? plan.root : undefined, root: (time) => {
        const at = plan.root(time);
        if (!carry) return { position: position.copy(at.position).setY(height + adjustment + (fullStance ? quintic(reserve[0], reserve[1], reserve[2], offset, 0, HORIZON, time - f.time + f.dt)[0] - reserve[0] : offset)), quaternion: at.quaternion.clone().multiply(posture) };
        const tick = Math.max(0, Math.round((time - f.time) / STEP));
        while (phases.length <= tick) phases.push(phases[phases.length - 1] + advance(f.time + phases.length * STEP));
        while (poses.length <= tick) {
          const k = poses.length, time = f.time + k * STEP;
          poses.push(carry(plan.root(time), phases[k], time));
        }
        const posed = poses[tick];
        return { position: position.copy(posed.position).addScaledVector(UP, adjustment + quintic(reserve[0], reserve[1], reserve[2], offset, 0, HORIZON, time - f.time + f.dt)[0]), quaternion: posed.quaternion };
      } };
      // Recover height when the contacts no longer need the lower reserve.
      const transition = this.events.length > 0 || this.states.some((state, i) => phases[0] - state.footfall >= (state.planted ? strideAt(this.gait, nowSpeed, i).duty : 0));
      const start = fullStance && !transition ? Math.round(this.reserveGoal / 0.002) : 0;
      heights: for (let k = 0; k <= (fullStance ? 120 : 60) && !found; k++) {
        for (const direction of [1, -1]) {
          const index = start + direction * k;
          if (Math.abs(index) > 60) continue;
          offset = index * 0.002;
          if (!supported(step)) {
            // A contact turned past its limit is no nearer at another pelvis height: less turn, or less travel, instead.
            if (turnLimited) break heights;
            continue;
          }
          found = true;
          break;
        }
      }
      if (!found) {
        // A committed travelling step may still fit with less turn, before shortening travel.
        if (turning && retry < 24) turnShare = retry === 23 ? 0 : turnShare * 0.75;
        else share = retry === (turning ? 47 : 23) ? 0 : share * 0.75;
      }
    }
    if (!found || !step || !travel) throw new Error('legs cannot support root follower');
    if (fullStance) { this.reserve = quintic(reserve[0], reserve[1], reserve[2], offset, 0, HORIZON, f.dt); this.reserveGoal = offset; }
    this.facingAhead.copy(travel.root(f.time + 0.5).quaternion);
    const motor = travel.root(f.time);
    this.root.velocity.subVectors(motor.position, from.position).setY(0).divideScalar(f.dt);
    this.root.angular = wrapAngle(yawOf(motor.quaternion) - yawOf(from.quaternion)) / f.dt;
    this.root.position.copy(motor.position);
    this.root.quaternion.copy(motor.quaternion);
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
    const { speed, walkers, nextLift } = this.motion(f, step);
    this.cycle = walkers[0].phase;
    this.states.forEach((state, i) => {
      const walker = walkers[i];
      const { duty } = walker.stride;
      const offset = offsetAt(this.gait, speed, i);
      if (!state.planted && this.cycle >= state.footfall) {
        state.planted = true;
        this.event(i, 'land');
      } else if (state.planted && (this.cycle - state.footfall >= duty || (i === nextLift && this.offAnchor(i)) || ((!step.travel || i === nextLift) && !this.limbs[i].supports(f.current, state, walker)))) {
        const next = this.next(walker, offset);
        // A truncated startup swing cannot arrive at stance speed.
        if (next - this.cycle < (1 - duty) / 2) state.footfall = next;
        else {
          const { landing, contact } = this.landing(walker, state, next, i);
          const limb = this.limbs[i], planned = this.contacts.get(i);
          if (planned?.phase === next) { contact.position.copy(planned.contact.position); contact.yaw = planned.contact.yaw; }
          else if (!limb.foothold(f.current, walker, landing, contact, step.travel ? next : undefined)) throw new Error('root does not support the proposed stance');
          const { position: to, yaw } = contact;
          if (to.distanceTo(state.foothold.position) > (this.stance ? SETTLE : 1e-6) || Math.abs(wrapAngle(yaw - state.foothold.yaw)) > (this.stance ? SQUARE : 1e-6)) {
            state.planted = false;
            state.lift = this.cycle;
            state.footfall = next;
            state.foothold.position.copy(to);
            state.foothold.yaw = yaw;
            this.event(i, 'lift');
          } else state.footfall = before(offset, this.cycle);
        }
      }
      state.phase = this.cycle - state.footfall + (state.planted ? 0 : 1);
      this.limbs[i].pose(f, walker, state, this.gait.clearance[i]);
    });
    this.contacts.clear();
  }

  /**
   * Preflight the next update's landing reserve without posing or advancing the engine.
   * Call after earlier body writers, before update, with the same frame and root/speed forecast.
   * False: revise the forecast (e.g. adjust the root's height or slow down) and retry. At most fourteen reach
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
    const next = this.next(walker, offsetAt(gait, speed, i));
    const { landing, contact } = this.landing(walker, state, next, i);
    if (limb.landingSupported(f.current, walker, landing, contact)) return true;
    contact.position.copy(limb.standingAt(walker, landing, contact.position.y));
    return limb.landingSupported(f.current, walker, landing, contact);
  }

  private carriesLeg(f: Frame, { speed, walkers, gait, nextLift }: LegMotion, i: number): boolean {
    const state = this.states[i];
    if (!state.planted) return true;
    const walker = walkers[i], limb = this.limbs[i];
    if (walker.phase - state.footfall < walker.stride.duty && !(nextLift === i && this.offAnchor(i))) {
      if (limb.supports(f.current, state, walker)) return true;
      if (nextLift !== i) return false;
    }
    const next = this.next(walker, offsetAt(gait, speed, i));
    const { landing, contact } = this.landing(walker, state, next, i);
    this.contacts.set(i, { phase: next, contact });
    return limb.foothold(f.current, walker, landing, contact, next);
  }

  private motion(f: Frame, step: LegStep): LegMotion {
    const gait = step.gait ?? this.gait;
    if (gait !== this.gait) checkGait(gait, this.chains.length);
    const input = step.speed;
    const speedAt = (t: number) => speedOf(typeof input === 'number' ? input : input(t));
    const speed = speedAt(f.time);
    const travel = step.travel;
    const strideAtTime = (time: number, i: number) => {
      const speed = speedAt(time), at = strideAt(gait, speed, i);
      if (!travel) return at;
      const from = travel(time).position.clone(), to = travel(time + STEP).position;
      const linear = Math.hypot(to.x - from.x, to.z - from.z) / STEP;
      // Turning advances the foot clock, but fore/aft rockers follow translation only.
      if (linear + 1e-9 < speed) at.stepping = Math.min(1, linear / (gait.referenceSpeed ?? gait.slowest));
      return at;
    };
    const strides = this.chains.map((_, i) => strideAtTime(f.time, i));
    const phase = this.cycle + (speed > 0 || this.settling || this.states.some((state) => !state.planted) ? strides[0].frequency * f.dt : 0);
    const phases = [phase];
    const advance = () => phases.push(phases[phases.length - 1] + strideAt(gait, speedAt(f.time + phases.length * STEP), 0).frequency * STEP);
    const timeTo = (landing: number) => {
      while (phases[phases.length - 1] < landing - 1e-9) advance();
      return Math.max(0, phases.findIndex((value) => value >= landing - 1e-9)) * STEP;
    };
    const heading = step.heading;
    const walkers: Walker[] = strides.map((stride, i) => ({
      phase, stride, timeTo,
      heading: heading && ((ahead) => heading(f.time + ahead)),
      at: (ahead) => {
        const ticks = Math.max(0, Math.ceil(ahead / STEP - 1e-9));
        return strideAtTime(f.time + ticks * STEP, i);
      },
      phaseAt: travel && ((ahead) => {
        const tick = Math.max(0, Math.ceil(ahead / STEP - 1e-9));
        while (phases.length <= tick) advance();
        return phases[tick];
      }),
      travelAt: travel && ((ahead, position, turn) => {
        const at = travel(f.time + Math.max(0, Math.ceil(ahead / STEP - 1e-9)) * STEP);
        position.copy(at.position); turn.copy(at.quaternion);
      }),
      rootAt: (ahead, position, turn) => {
        const root = step.root(f.time + Math.max(0, Math.ceil(ahead / STEP - 1e-9)) * STEP);
        position.copy(root.position);
        turn.copy(root.quaternion);
      },
    }));
    // One early lift at a time; the other contacts must carry the forecast until the next landing.
    const nextLift = this.states.every((state) => state.planted)
      ? this.states.reduce((best, state, i) => {
        if (this.offAnchor(i) !== this.offAnchor(best)) return this.offAnchor(i) ? i : best;
        return state.footfall + strides[i].duty < this.states[best].footfall + strides[best].duty ? i : best;
      }, 0) : -1;
    return { speed, walkers, gait, nextLift };
  }

  private next(walker: Walker, offset: number): number {
    const next = before(offset, walker.phase) + 1, swing = walker.phase + 1 - walker.stride.duty;
    if (!walker.phaseAt) return next;
    return this.stance || walker.at(walker.timeTo(swing)).stepping === 0 ? swing : Math.max(next, (walker.phase + swing) / 2 + STEP * walker.stride.frequency);
  }

  private landing(walker: Walker, state: LegTiming, next: number, i: number) {
    const { duty, stepping } = walker.stride;
    const limb = this.limbs[i];
    const position = new Vector3();
    const turn = new Quaternion();
    (walker.travelAt ?? walker.rootAt)(walker.timeTo(next + (walker.stride.stanceCenter ?? duty / 2)), position, turn);
    // [D] Footholds follow floor-plane travel; pelvis list must not turn leg height into step width.
    const anchor = limb.anchor.clone();
    if (limb.leg.width !== undefined) anchor.x += (limb.leg.width - anchor.x) * (walker.phaseAt ? Math.min(stepping, walker.at(walker.timeTo(next)).stepping) : stepping);
    const to = anchor.applyQuaternion(turn).add(position).setY(state.foothold.position.y);
    return { landing: walker.timeTo(next), contact: { position: to, yaw: yawOf(turn) + limb.leg.toeOut } };
  }

  private event(leg: number, type: ContactEvent['type']): void {
    const { position, yaw } = this.states[leg].foothold;
    this.events.push({ leg, type, time: this.time, foothold: { position: position.clone(), yaw } });
  }
}

const before = (offset: number, phase: number) => offset + Math.floor(phase - offset + 1e-9);
const UP = new Vector3(0, 1, 0);

/** Stopped feet need another step only outside these anchor tolerances (m, rad). */
const SETTLE = 0.02, SQUARE = 0.05;
