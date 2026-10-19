import { minimumJerk, wrapAngle, yawOf } from '../math';
// Stance pins the terminal; swing follows a C² sole path ending on the stance rate.
import { Euler, Quaternion, Vector3 } from 'three';
import { STEP, type Frame } from '../body';
import type { Pose, ReadonlyPose } from '../pose';
import { angleAt, cycleAt, DEG, type JointCycle } from './cycle';
import type { LegChain, LegState } from './legs';
import { loft, quintic, type Swing } from './swing';
import type { Stride } from './gait';
import { Solver, type LegTarget } from './solve';

type Timing = LegState & { footfall: number; lift: number };

/** Tuned forecast horizon: verify the next 100 ms before committing support. */
export const HORIZON = 0.1;

export interface Walker {
  phase: number;
  phaseAt?(ahead: number): number;
  heading?(ahead: number): number | undefined;
  stride: Stride;
  timeTo(phase: number): number;
  at(ahead: number): Stride;
  rootAt(ahead: number, position: Vector3, turn: Quaternion): void;
  travelAt?(ahead: number, position: Vector3, turn: Quaternion): void;
}

export class Limb {
  restPitch = 0;
  /** The last reserve could not hold contact heading: reduce turn before changing height. */
  turnLimited = false;
  readonly solver: Solver;
  readonly top: number;
  readonly terminal: number;
  /** terminal at rest relative to the root, in its frame */
  readonly anchor = new Vector3();
  /** each coordinate's cycle (or none) */
  private readonly cycles: (JointCycle | null)[];
  private readonly rest: Float64Array;
  private readonly trial: Float64Array;
  private readonly length: number;
  private swing: Swing | null = null;
  private ready = false;
  private progress = 0;
  private peak = { speed: 0, phase: 0 };
  private landed = false;
  private held: { position: Vector3; rotation: Quaternion; pivot: Vector3 } | null = null;

  /** Read the previous completed pose, including later writers. */
  check(f: Frame): void {
    if (!f.dev || !this.ready) return;
    if (this.swing) {
      const speed = _w.subVectors(f.prev.position(this.terminal), f.prev2.position(this.terminal)).setY(0).length() / f.dt;
      if (speed > this.peak.speed) this.peak = { speed, phase: this.progress };
    }
    if (this.landed && this.peak.phase < 0.35) f.dev.append(f.time - f.dt, { check: 'leg swing peak earliness before 35% (fraction)', value: 0.35 - this.peak.phase, limit: 0, where: f.prev.skeleton.bones[this.terminal].name });
    const depth = -this.lowest(f.prev);
    if (depth > 1e-4) f.dev.append(f.time - f.dt, { check: 'leg ground (m)', value: depth, limit: 1e-4, where: f.prev.skeleton.bones[this.terminal].name });
    if (!this.held) return;
    const p = f.prev;
    const where = p.skeleton.bones[this.terminal].name;
    if (this.landed) {
      const pitch = (pose: ReadonlyPose) => {
        const forward = _w.set(0, 0, 1).applyQuaternion(pose.rotation(this.terminal));
        return Math.atan2(forward.y, Math.hypot(forward.x, forward.z));
      };
      const turn = Math.abs(pitch(p) - pitch(f.prev2)) / DEG;
      // [tuned, inherited] 1.5° per tick limits visible pitch snaps; unchanged.
      if (turn > 1.5) f.dev.append(f.time - f.dt, { check: 'touchdown pitch step (°)', value: turn, limit: 1.5, where });
      // [derived, user-approved] 1 m/s horizontal, 0.1 vertical; Winter 1992 doi:10.1093/ptj/72.1.45 [read: abstract]: 0.87 horizontal, negligible vertical.
      const velocity = p.point(this.terminal, this.held.pivot, _w).sub(f.prev2.point(this.terminal, this.held.pivot, _end)).divideScalar(f.dt);
      const vertical = Math.abs(velocity.y), horizontal = velocity.setY(0).length();
      if (vertical > 0.1) f.dev.append(f.time - f.dt, { check: 'leg touchdown vertical speed (m/s)', value: vertical, limit: 0.1, where });
      if (horizontal > 1) f.dev.append(f.time - f.dt, { check: 'leg touchdown horizontal speed (m/s)', value: horizontal, limit: 1, where });
    }
    const miss = p.position(this.terminal).distanceTo(this.held.position);
    // 0.1 mm distinguishes numerical settling from visible contact movement.
    if (miss > 1e-4) f.dev.append(f.time - f.dt, { check: 'leg contact (m)', value: miss, limit: 1e-4, where });
    const turn = p.rotation(this.terminal).angleTo(this.held.rotation);
    // A tenth of a milliradian detects a later writer rotating a foot about its fixed origin.
    if (turn > 1e-4) f.dev.append(f.time - f.dt, { check: 'leg contact turn (rad)', value: turn, limit: 1e-4, where });
  }
  /** the terminal's points kept above the ground swinging (its frame): its heel, toe, and its toes' tip (as the toes are bent then: `aboveAt`) */
  private readonly above: Vector3[];
  /** the toes' joint in the terminal's frame */
  private readonly toesOffset = new Vector3();
  constructor(
    readonly leg: LegChain,
    rest: ReadonlyPose,
  ) {
    const s = rest.skeleton;
    this.solver = new Solver(s, leg.joints);
    this.trial = new Float64Array(this.solver.n);
    this.length = leg.joints.slice(1).reduce((sum, joint) => sum + s.bones[joint.bone].offset.length(), 0);
    this.top = leg.joints[0].bone;
    this.terminal = leg.joints[leg.joints.length - 1].bone;
    this.anchor.copy(rest.position(this.terminal)).sub(rest.position(0)).applyQuaternion(_q.copy(rest.rotation(0)).invert());
    this.cycles = leg.joints.flatMap(({ axes, cycle }) => [...axes].map((axis) => axis === 'x' ? cycle ?? null : null));
    this.rest = Float64Array.from(leg.joints.flatMap(({ bone, axes }) => {
      _e.setFromQuaternion(rest.local(bone), 'YZX');
      return [...axes].map((axis) => axis === 'x' ? -_e.x : axis === 'y' ? _e.y : _e.z);
    }));
    if (leg.toes) this.toesOffset.copy(s.bones[leg.toes.bone].offset);
    this.above = [leg.heel.clone(), leg.toe.clone(), ...(leg.toes ? [this.toesOffset.clone().add(leg.toes.tip)] : [])];
  }

  /** where the leg stands in `pose`: its terminal's origin (at its standing height) and heading */
  standing(pose: ReadonlyPose): { position: Vector3; yaw: number } {
    return { position: pose.position(this.terminal).clone().setY(-Math.min(this.leg.heel.y, this.leg.toe.y)), yaw: yawOf(pose.rotation(this.terminal)) };
  }

  /** Reach must outlast the next few ticks, before extension makes the stance singular. */
  supports(p: Pose, state: Timing, walker: Walker): boolean {
    const { frequency } = walker.stride;
    this.refs(walker.phase - state.footfall, walker.stride);
    const times = [0, HORIZON];
    if (walker.phaseAt) {
      let until = 0;
      while (walker.phaseAt(until) - state.footfall < walker.at(until).duty) until += STEP;
      times[1] = Math.min(HORIZON, until);
      if (until > times[1]) times.push(until);
    }
    const targets = times.map((ahead): [number, number] => {
      const at = walker.phaseAt ? walker.at(ahead) : walker.stride;
      const phase = walker.phaseAt?.(ahead) ?? walker.phase + ahead * frequency;
      return [ahead, this.pitch(Math.min(1, (phase - state.footfall) / at.duty), at.stepping)];
    });
    // Existing stance reserve: 10 µm; a new committed landing uses the tighter 1 µm stop.
    return this.reserve(p, walker, state.foothold, targets, 1e-5, state.footfall) && (!walker.phaseAt || this.reserve(p, walker, state.foothold, [this.extension(p, walker, state.foothold, state.footfall, 0, Math.max(...times))], 1e-5, state.footfall));
  }

  /** Shorten a proposed step; if straight shortening cannot support it, try nearby lateral anchors. */
  foothold(p: Pose, walker: Walker, ahead: number, contact: Timing['foothold'], phase?: number): boolean {
    const standing = this.standingAt(walker, ahead, contact.position.y);
    const desired = contact.position.clone();
    const reaches = (t: number) => {
      contact.position.lerpVectors(standing, desired, t);
      return phase === undefined ? this.landingSupported(p, walker, ahead, contact) : this.stanceSupported(p, walker, ahead, contact, phase);
    };
    if (reaches(1)) return true;
    let lo = 0, hi = 1;
    if (phase !== undefined) {
      const direction = desired.clone().sub(standing), a = direction.lengthSq();
      if (a === 0) return false;
      let end = ahead;
      const phaseAt = (time: number) => walker.phaseAt?.(time) ?? walker.phase + time * walker.stride.frequency;
      while (phaseAt(end) - phase < walker.at(end).duty) end += STEP;
      // Intersect each planned pose's reach sphere with the foothold segment.
      for (let time = ahead - 2 * STEP; time <= end + 1e-9; time += STEP) {
        const stride = walker.at(time), u = Math.min(1, Math.max(0, (phaseAt(time) - phase) / stride.duty));
        this.baseAt(p, walker, time, _turn, _top);
        contact.position.copy(standing);
        const delta = this.planted(contact, this.pitch(u, stride.stepping), _target).position.sub(_top);
        const b = delta.dot(direction), discriminant = b * b - a * (delta.lengthSq() - this.length ** 2);
        if (discriminant < 0) return false;
        lo = Math.max(lo, (-b - Math.sqrt(discriminant)) / a); hi = Math.min(hi, (-b + Math.sqrt(discriminant)) / a);
        if (lo > hi) return false;
      }
      return reaches((lo + hi) / 2);
    } else if (!reaches(0)) {
      const center = standing.clone();
      for (const offset of [0.01, -0.01, 0.02, -0.02, 0.04, -0.04, 0.08, -0.08]) {
        standing.copy(center).addScaledVector(_w.set(1, 0, 0).applyQuaternion(yawPitch(contact.yaw, 0, _a)), offset);
        if (reaches(0)) break;
      }
      if (!reaches(0)) throw new Error('root does not support the proposed stance');
    }
    // Eight bisections retain a verified reachable endpoint, within 1/256 of the step.
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      if (reaches(mid)) lo = mid;
      else hi = mid;
    }
    contact.position.lerpVectors(standing, desired, lo);
    return true;
  }

  standingAt(walker: Walker, ahead: number, height: number): Vector3 {
    (walker.travelAt ?? walker.rootAt)(ahead, _root, _rootTurn);
    return this.anchor.clone().applyQuaternion(_rootTurn).add(_root).setY(height);
  }

  /** The same reserve used by preflight and the foothold search. */
  landingSupported(p: Pose, walker: Walker, ahead: number, contact: Timing['foothold']): boolean {
    if (walker.phaseAt) return this.contactSupported(p, walker, ahead, contact);
    this.refs(0, walker.stride);
    const targets = [ahead - 2 * STEP, ahead, ahead + HORIZON].flatMap((time): [number, number][] => [
      [time, 0], [time, this.pitch((time - ahead) * walker.stride.frequency / walker.stride.duty, walker.stride.stepping)],
    ]);
    return this.reserve(p, walker, contact, targets, 1e-6);
  }

  /** [D] Forecast the commanded rocker poses; foot-flat belongs at its key, not at heel strike. */
  private contactSupported(p: Pose, walker: Walker, ahead: number, contact: Timing['foothold']): boolean {
    const stride = walker.at(ahead), duration = stride.duty / stride.frequency;
    this.refs(0, stride);
    const times = [ahead - 2 * STEP, ahead, ahead + HORIZON];
    const flat = this.leg.rocker.find(([, pitch]) => pitch === 0);
    if (flat) times.push(ahead + flat[0] * duration);
    const targets = times.map((time): [number, number] => [time, this.pitch((time - ahead) / duration, stride.stepping)]);
    targets.push([ahead, this.pitch(STEP / duration, stride.stepping)]);
    return this.reserve(p, walker, contact, targets, 1e-6, walker.phaseAt?.(ahead));
  }

  /** A committed step must also carry the body until its next scheduled lift. */
  stanceSupported(p: Pose, walker: Walker, ahead: number, contact: Timing['foothold'], phase: number): boolean {
    if (!this.landingSupported(p, walker, ahead, contact)) return false;
    let end = ahead;
    while ((walker.phaseAt?.(end) ?? phase + (end - ahead) * walker.stride.frequency) - phase < walker.at(end).duty) end += STEP;
    return this.reserve(p, walker, contact, [[end, this.pitch(1, walker.at(end).stepping)]], 1e-6, phase) && this.reserve(p, walker, contact, [this.extension(p, walker, contact, phase, ahead, end)], 1e-6, phase);
  }

  /** The bob can peak between endpoint checks: verify the most extended planned stance pose too. */
  private extension(p: Pose, walker: Walker, contact: Timing['foothold'], footfall: number, from: number, to: number): [number, number] {
    let longest = -Infinity, result: [number, number] = [from, 0];
    for (let time = from; time <= to + 1e-9; time += STEP) {
      const stride = walker.at(time), phase = (walker.phaseAt?.(time) ?? walker.phase + time * stride.frequency) - footfall;
      const pitch = this.pitch(Math.min(1, Math.max(0, phase / stride.duty)), stride.stepping);
      this.baseAt(p, walker, time, _turn, _top);
      const distance = this.planted(contact, pitch, _target).position.distanceToSquared(_top);
      if (distance > longest) { longest = distance; result = [time, pitch]; }
    }
    return result;
  }

  /** Identical bases and pitches have identical reserve solves; stationary forecasts repeat them. */
  private reserve(p: Pose, walker: Walker, contact: Timing['foothold'], targets: readonly (readonly [number, number])[], limit: number, footfall?: number): boolean {
    this.turnLimited = false;
    const top = new Vector3();
    const turn = new Quaternion();
    let lastPitch = NaN;
    for (const [time, pitch] of targets) {
      if (walker.phaseAt && footfall !== undefined) this.refs(walker.phaseAt(time) - footfall, walker.at(time));
      this.baseAt(p, walker, time, _turn, _top);
      if (pitch === lastPitch && top.equals(_top) && turn.equals(_turn)) continue;
      const target = this.planted(contact, pitch, _target);
      if (walker.phaseAt && _top.distanceTo(target.position) > this.length + limit) return false;
      const miss = this.solver.reach(_turn, _top, target, this.trial, walker.phaseAt ? this.solver.q : this.solver.ref);
      const rotationLimited = this.solver.headingError > 1e-4 || (!!walker.travelAt && Math.abs(time) <= HORIZON && this.solver.rotationError > 1e-4);
      if (miss >= limit || rotationLimited) {
        this.turnLimited = this.solver.headingError > 1e-4;
        return false;
      }
      top.copy(_top);
      turn.copy(_turn);
      lastPitch = pitch;
    }
    return true;
  }

  /** the leg posed for `state` at the walker's phase, its swing clearing the ground by `clearance` (m) */
  pose(f: Frame<unknown>, walker: Walker, state: Timing, clearance: number) {
    const { leg, solver } = this;
    const { duty, stepping } = walker.stride;
    const p = f.current;
    this.ready = true;
    this.held = null;
    this.landed = state.planted && this.swing !== null;
    if (!state.planted) return this.swung(f, walker, state, clearance);
    this.swing = null;
    const u = walker.phase - state.footfall;
    this.refs(u, walker.stride);
    const pitch = this.pitch(Math.min(1, u / duty), stepping);
    const target = this.planted(state.foothold, pitch, _target);
    this.held = { position: target.position.clone(), rotation: target.rotation.clone(), pivot: pitch >= 0 ? leg.heel : leg.toe };
    solver.solve(p, target, walker.phaseAt ? solver.q : solver.ref);
    if (leg.toes) p.setLocal(leg.toes.bone, sagittal(-Math.min(0, pitch), _q));
  }

  /** each joint's reference: its cycle at leg phase `u`, the rest at standing */
  private refs(u: number, stride: Stride) {
    const { duty, stepping, referenceBlend: blend = 0 } = stride;
    for (let j = 0; j < this.solver.n; j++) {
      const c = this.cycles[j];
      this.setRef(j, (c ? angleAt(c, u, duty, blend) * stepping : 0) + this.rest[j] * (1 - stepping), stride);
    }
  }

  private setRef(j: number, value: number, { referenceBlend: blend = 0 }: Stride) {
    this.solver.setRef(j, value, 1 + ((this.cycles[j]?.alternateWeight ?? 1) - 1) * blend);
  }

  /** the swing this tick: its plan stepped toward the landing as now seen, its shape over it, the ground kept */
  private swung(f: Frame<unknown>, walker: Walker, state: Timing, clearance: number) {
    const { leg, solver } = this;
    const p = f.current;
    const left = walker.timeTo(state.footfall);
    const s = (walker.phase - state.lift) / (state.footfall - state.lift);
    const stride = walker.at(left);
    this.baseAt(p, walker, left, _turn, _top);
    const landing = this.planted(state.foothold, this.pitch(0, stride.stepping), _target);
    if (!this.swing) {
      this.swing = this.lifted(f, walker);
      this.peak = { speed: 0, phase: 0 };
      this.refs(0, stride);
      solver.reach(_turn, _top, landing, this.swing.land);
      // [D from C] Fold at loft's recalled 30% apex; endpoints already include their stance bend.
      if (walker.phaseAt) for (const [j, c] of this.cycles.entries()) if (c) this.swing.fold[j] =
        (cycleAt(c, c.duty + 0.3 * (1 - c.duty), stride.referenceBlend ?? 0) - (this.swing.from[j] + this.swing.land[j]) / 2) * Math.sqrt(stride.stepping);
    }
    const swing = this.swing;
    this.progress = s;
    const target = this.planted(state.foothold, this.pitch(0, stride.stepping), _swingTarget);
    // [D] World-space swing keeps touchdown rates independent of root acceleration; the sagitta follows curved travel.
    const end = _end.copy(target.position);
    end.y = state.foothold.position.y + Math.min(this.leg.heel.y, this.leg.toe.y);
    for (let j = 0; j < 3; j++) {
      [swing.x[j], swing.v[j], swing.a[j]] = quintic(swing.x[j], swing.v[j], swing.a[j], end.getComponent(j), 0, left + (walker.phaseAt ? 0 : f.dt), f.dt);
    }
    target.position.fromArray(swing.x);
    const bend = 2 * minimumJerk(s) * Math.tan(wrapAngle((walker.heading ? walker.heading(left) ?? swing.turn.yaw : yawOf(_rootTurn)) - swing.turn.yaw) / 4);
    _w.subVectors(end, target.position); target.position.addScaledVector(_w.set(-_w.z, 0, _w.x), bend);
    target.position.y += clearance * loft(s);
    target.rotation.slerp(swing.turn.foot, 1 - minimumJerk(s));
    for (let j = 0; j < solver.n; j++) this.setRef(j, swing.from[j] + (swing.land[j] - swing.from[j]) * minimumJerk(s) + swing.fold[j] * loft(s), walker.stride);
    _swingTarget.swing = s;
    _swingTarget.above = this.aboveAt(s);
    _swingTarget.floor = clearance * loft(s);
    let low = Infinity;
    for (const point of _swingTarget.above) low = Math.min(low, _w.copy(point).applyQuaternion(target.rotation).y);
    target.position.y -= low;
    if (walker.phaseAt) {
      // [D] Retain the reference bend at the actual fore/aft reach; C2 handovers preserve contact rates.
      target.position.y += Math.max(0, solver.referenceFloor(p, target.position) - target.position.y) * minimumJerk(2 * Math.min(s, 1 - s));
    }
    solver.solve(p, _swingTarget, solver.q);
    if (leg.toes) p.setLocal(leg.toes.bone, this.toesAt(s, _a));
  }

  /** the toes' turn `s` through the swing: from how they lifted to straight */
  private toesAt(s: number, out: Quaternion): Quaternion {
    if (!this.swing) throw new Error('toes without a swing');
    return out.copy(this.swing.toes).slerp(_b.identity(), minimumJerk(s));
  }

  /** the points kept above the ground `s` through the swing (the terminal's frame) */
  private aboveAt(s: number): Vector3[] {
    const { toes } = this.leg;
    if (!toes) return this.above;
    this.above[2].copy(toes.tip).applyQuaternion(this.toesAt(s, _a)).add(this.toesOffset);
    return this.above;
  }

  /** Start from the last two completed sole poses in world space. */
  private lifted(f: Frame<unknown>, walker: Walker): Swing {
    const at = f.prev.position(this.terminal).clone().setY(Math.max(0, this.lowest(f.prev)));
    const previous = f.prev2.position(this.terminal).clone().setY(Math.max(0, this.lowest(f.prev2)));
    const blend = walker.stride.referenceBlend ?? 0;
    const sample = (c: JointCycle, s: number) => cycleAt(c, c.duty + s * (1 - c.duty), blend);
    return {
      fold: Float64Array.from(this.cycles, (c) => c ? (sample(c, 0.5) - (sample(c, 0) + sample(c, 1)) / 2) * Math.sqrt(walker.stride.stepping) : 0),
      x: Float64Array.from(at.toArray()),
      v: Float64Array.from(at.clone().sub(previous).divideScalar(STEP).toArray()),
      a: new Float64Array(3),
      land: Float64Array.from(this.solver.q),
      from: Float64Array.from(this.solver.q),
      turn: { foot: f.prev.rotation(this.terminal).clone(), yaw: walker.heading ? walker.heading(0) ?? 0 : yawOf(f.prev.rotation(0)) },
      toes: this.leg.toes ? f.prev.local(this.leg.toes.bone).clone() : new Quaternion(),
    };
  }

  /** the top joint's parent's turn and the top joint's position `ahead` s from now: off the root as now, the root where it is planned then */
  private baseAt(p: Pose, walker: Walker, ahead: number, turn: Quaternion, top: Vector3) {
    const parent = p.skeleton.bones[this.top].parent;
    walker.rootAt(ahead, _root, _rootTurn);
    const inverse = _a.copy(p.rotation(0)).invert();
    const relative = _b.copy(inverse).multiply(p.rotation(parent));
    // Only the root is planned: hold the current parent offset instead of extrapolating an oscillation.
    turn.copy(_rootTurn).multiply(relative);
    top.copy(p.position(parent)).sub(p.position(0)).applyQuaternion(inverse).applyQuaternion(_rootTurn).add(_root)
      .add(_w.copy(p.skeleton.bones[this.top].offset).applyQuaternion(turn));
  }

  /** the rocker's pitch of the terminal `us` (0 … 1) through its stance (rad, + toes up), as far as it steps: minimum-jerk between its keys (a spline's overshoot would lift a flat hoof's toe) */
  private pitch(us: number, stepping: number): number {
    const keys = this.leg.rocker;
    let k = 0;
    while (k < keys.length - 2 && us >= keys[k + 1][0]) k++;
    const [[u0, a], [u1, b]] = [keys[k], keys[k + 1]];
    return (a + (b - a) * minimumJerk((us - u0) / (u1 - u0))) * DEG * stepping + this.restPitch * DEG * (1 - stepping);
  }

  /** Roll about the heel or toe while keeping that contact fixed in world space. */
  private planted(contact: { position: Vector3; yaw: number }, pitch: number, out: LegTarget): LegTarget {
    const pivot = pitch >= 0 ? this.leg.heel : this.leg.toe;
    yawPitch(contact.yaw, pitch, out.rotation);
    out.position.copy(pivot).applyQuaternion(yawPitch(contact.yaw, 0, _a)).add(contact.position)
      .sub(_w.copy(pivot).applyQuaternion(out.rotation));
    return out;
  }

  /** the lowest the terminal's heel or toe (or its toes' tip) is (m, above the ground) */
  private lowest(p: ReadonlyPose): number {
    const { leg } = this;
    const low = Math.min(p.point(this.terminal, leg.heel, _w).y, p.point(this.terminal, leg.toe, _w).y);
    return leg.toes ? Math.min(low, p.point(leg.toes.bone, leg.toes.tip, _w).y) : low;
  }

}

/** a rotation by `angle` (rad) in a bone's sagittal plane: its far end forward (about −X) */
const sagittal = (angle: number, out: Quaternion) => out.setFromAxisAngle(X, -angle);

/** a heading `yaw` pitched `pitch` (+ toes up), as a world rotation */
const yawPitch = (yaw: number, pitch: number, out: Quaternion) => out.setFromEuler(_e.set(-pitch, yaw, 0, 'YXZ'));

const X = new Vector3(1, 0, 0);
const _e = new Euler();
const _w = new Vector3();
const _q = new Quaternion();
const _a = new Quaternion();
const _b = new Quaternion();
const _target: LegTarget = { swing: null, position: new Vector3(), rotation: new Quaternion(), above: [] };
const _swingTarget: LegTarget = { swing: 0, position: new Vector3(), rotation: new Quaternion(), above: [] };
const _turn = new Quaternion();
const _top = new Vector3();
const _end = new Vector3();
const _root = new Vector3();
const _rootTurn = new Quaternion();
