import { minimumJerk, yawOf } from '../math';
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
  stride: Stride;
  previous: ReadonlyPose;
  timeTo(phase: number): number;
  at(ahead: number): Pick<Walker, 'phase' | 'stride'>;
  rootAt(ahead: number, position: Vector3, turn: Quaternion): void;
}

export class Limb {
  readonly solver: Solver;
  readonly top: number;
  readonly terminal: number;
  /** terminal at rest relative to the root, in its frame */
  readonly anchor = new Vector3();
  /** each coordinate's cycle (or none) */
  private readonly cycles: (JointCycle | null)[];
  private readonly rest: Float64Array;
  private readonly trial: Float64Array;
  private swing: Swing | null = null;
  private lifting = false;
  private ready = false;
  private held: { position: Vector3; rotation: Quaternion } | null = null;

  /** Read the previous completed pose, including later writers. */
  check(f: Frame): void {
    if (!f.dev || !this.ready) return;
    const depth = -this.lowest(f.prev);
    if (depth > 1e-4) f.dev.append(f.time - f.dt, { check: 'leg ground (m)', value: depth, limit: 1e-4, where: f.prev.skeleton.bones[this.terminal].name });
    if (!this.held) return;
    const p = f.prev;
    const where = p.skeleton.bones[this.terminal].name;
    const miss = p.position(this.terminal).distanceTo(this.held.position);
    // 0.1 mm distinguishes numerical settling from visible contact movement.
    if (miss > 1e-4) f.dev.append(f.time - f.dt, { check: 'leg contact (m)', value: miss, limit: 1e-4, where });
    const turn = new Quaternion().copy(p.rotation(this.terminal)).angleTo(this.held.rotation);
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
    const { duty, frequency, stepping } = walker.stride;
    this.refs(walker.phase - state.footfall, walker.stride);
    const targets = [0, HORIZON].map((ahead): [number, number] => [ahead, this.pitch(Math.min(1, (walker.phase + ahead * frequency - state.footfall) / duty), stepping)]);
    // Existing stance reserve: 10 µm; a new committed landing uses the tighter 1 µm stop.
    return this.reserve(p, walker, state.foothold, targets, 1e-5);
  }

  /** Shorten a proposed step until its landing is reachable, before committing the foothold. */
  foothold(p: Pose, walker: Walker, ahead: number, contact: Timing['foothold']): void {
    const standing = this.standingAt(walker, ahead, contact.position.y);
    const desired = contact.position.clone();
    const reaches = (t: number) => {
      contact.position.lerpVectors(standing, desired, t);
      return this.landingSupported(p, walker, ahead, contact);
    };
    if (reaches(1)) return;
    if (!reaches(0)) throw new Error('root does not support the proposed stance');
    let lo = 0;
    let hi = 1;
    // Eight bisections retain a verified reachable endpoint, within 1/256 of the step.
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      if (reaches(mid)) lo = mid;
      else hi = mid;
    }
    contact.position.lerpVectors(standing, desired, lo);
  }

  standingAt(walker: Walker, ahead: number, height: number): Vector3 {
    walker.rootAt(ahead, _root, _rootTurn);
    return this.anchor.clone().applyQuaternion(_rootTurn).add(_root).setY(height);
  }

  /** The same reserve used by preflight and the foothold search. */
  landingSupported(p: Pose, walker: Walker, ahead: number, contact: Timing['foothold']): boolean {
    this.refs(0, walker.stride);
    const targets = [ahead, ahead + HORIZON].flatMap((time): [number, number][] => [
      [time, 0], [time, this.pitch((time - ahead) * walker.stride.frequency / walker.stride.duty, walker.stride.stepping)],
    ]);
    return this.reserve(p, walker, contact, targets, 1e-6);
  }

  /** Identical bases and pitches have identical reserve solves; stationary forecasts repeat them. */
  private reserve(p: Pose, walker: Walker, contact: Timing['foothold'], targets: readonly (readonly [number, number])[], limit: number): boolean {
    const top = new Vector3();
    const turn = new Quaternion();
    let lastPitch = NaN;
    for (const [time, pitch] of targets) {
      this.baseAt(p, walker, time, _turn, _top);
      if (pitch === lastPitch && top.equals(_top) && turn.equals(_turn)) continue;
      const target = this.planted(contact, pitch, _target);
      if (this.solver.reach(_turn, _top, target, this.trial) >= limit) return false;
      top.copy(_top);
      turn.copy(_turn);
      lastPitch = pitch;
    }
    return true;
  }

  /** the swing starts: it is taken from where the terminal is as it poses next */
  lift() {
    this.lifting = true;
  }

  /** the leg posed for `state` at the walker's phase, its swing clearing the ground by `clearance` (m) */
  pose(f: Frame<unknown>, walker: Walker, state: Timing, clearance: number) {
    const { leg, solver } = this;
    const { duty, stepping } = walker.stride;
    const p = f.current;
    this.ready = true;
    this.held = null;
    if (!state.planted) return this.swung(f, walker, state, clearance);
    this.swing = null;
    const u = walker.phase - state.footfall;
    this.refs(u, walker.stride);
    const pitch = this.pitch(Math.min(1, u / duty), stepping);
    const target = this.planted(state.foothold, pitch, _target);
    this.held = { position: target.position.clone(), rotation: target.rotation.clone() };
    solver.solve(p, target);
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
    if (this.lifting || !this.swing) this.swing = this.lifted(f, walker);
    const swing = this.swing;
    this.landing(p, walker, state, left);
    const reach = _top.distanceTo(_target.position);
    const target = this.planted(state.foothold, this.pitch(0, walker.stride.stepping), _swingTarget);
    const local = (time: number, at: Vector3) => {
      walker.rootAt(time, _root, _rootTurn);
      return at.sub(_root).applyQuaternion(yawPitch(yawOf(_rootTurn), 0, _rootTurn).invert());
    };
    const end = local(left, target.position.clone());
    const rate = local(left + STEP, target.position.clone()).sub(end).divideScalar(STEP);
    end.y = state.foothold.position.y + Math.min(this.leg.heel.y, this.leg.toe.y);
    rate.y = 0;
    for (let j = 0; j < 3; j++) {
      [swing.x[j], swing.v[j], swing.a[j]] = quintic(swing.x[j], swing.v[j], swing.a[j], end.getComponent(j), rate.getComponent(j), left + f.dt, f.dt);
    }
    target.position.set(swing.x[0], 0, swing.x[2]).applyQuaternion(yawPitch(yawOf(p.rotation(0)), 0, _a)).add(p.position(0)).setY(swing.x[1]);
    target.position.y += clearance * loft(s);
    target.rotation.slerp(swing.turn, 1 - minimumJerk(s));
    const free = minimumJerk(4 * s) * (1 - minimumJerk(4 * s - 3));
    this.lifting = false;
    for (let j = 0; j < solver.n; j++) this.setRef(j, swing.from[j] + (swing.land[j] - swing.from[j]) * minimumJerk(s) + swing.fold[j] * loft(s), walker.stride);
    _swingTarget.swing = s;
    _swingTarget.above = this.aboveAt(s);
    _swingTarget.floor = clearance * loft(s);
    target.position.y -= Math.min(..._swingTarget.above.map((point) => _w.copy(point).applyQuaternion(target.rotation).y));
    // Keep the landing's reach through mid-swing; return it with zero end acceleration.
    const hip = p.position(this.top), span = _w.subVectors(target.position, hip);
    if (span.length() > reach) target.position.lerp(span.setLength(reach).add(hip), free);
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

  /** Start from the last two completed sole poses in the root's horizontal frame. */
  private lifted(f: Frame<unknown>, walker: Walker): Swing {
    const at = f.prev.position(this.terminal).clone().sub(f.prev.position(0)).applyQuaternion(yawPitch(yawOf(f.prev.rotation(0)), 0, _a).invert()).setY(Math.max(0, this.lowest(f.prev)));
    const previous = f.prev2.position(this.terminal).clone().sub(f.prev2.position(0)).applyQuaternion(yawPitch(yawOf(f.prev2.rotation(0)), 0, _a).invert()).setY(Math.max(0, this.lowest(f.prev2)));
    const blend = walker.stride.referenceBlend ?? 0;
    const sample = (c: JointCycle, s: number) => cycleAt(c, c.duty + s * (1 - c.duty), blend);
    return {
      fold: Float64Array.from(this.cycles, (c) => c ? (sample(c, 0.5) - (sample(c, 0) + sample(c, 1)) / 2) * Math.sqrt(walker.stride.stepping) : 0),
      x: Float64Array.from(at.toArray()),
      v: Float64Array.from(at.clone().sub(previous).divideScalar(STEP).toArray()),
      a: new Float64Array(3),
      land: Float64Array.from(this.solver.q),
      from: Float64Array.from(this.solver.q),
      turn: f.prev.rotation(this.terminal).clone(),
      toes: this.leg.toes ? f.prev.local(this.leg.toes.bone).clone() : new Quaternion(),
    };
  }

  private landing(p: Pose, walker: Walker, state: Timing, left: number) {
    if (!this.swing) throw new Error('a landing without a swing');
    const { stride } = walker.at(left);
    this.refs(0, stride);
    this.baseAt(p, walker, left, _turn, _top);
    const target = this.planted(state.foothold, this.pitch(0, stride.stepping), _target);
    // Commit the joint branch at lift-off; changing forecast branches mid-swing produces snaps.
    if (this.lifting) this.solver.reach(_turn, _top, target, this.swing.land);
  }

  /** the top joint's parent's turn and the top joint's position `ahead` s from now: off the root as now, the root where it is planned then */
  private baseAt(p: Pose, walker: Walker, ahead: number, turn: Quaternion, top: Vector3) {
    const parent = p.skeleton.bones[this.top].parent;
    walker.rootAt(ahead, _root, _rootTurn);
    const inverse = _a.copy(p.rotation(0)).invert();
    const relative = _b.copy(inverse).multiply(p.rotation(parent));
    const previous = new Quaternion().copy(walker.previous.rotation(0)).invert().multiply(walker.previous.rotation(parent));
    // Continue the parent body's rotation as well as the planned root (e.g. a walking pelvis).
    turn.copy(_rootTurn).multiply(previous.slerp(relative, 1 + ahead / STEP));
    top.copy(p.position(parent)).sub(p.position(0)).applyQuaternion(inverse).applyQuaternion(_rootTurn).add(_root)
      .add(_w.copy(p.skeleton.bones[this.top].offset).applyQuaternion(turn));
  }

  /** the rocker's pitch of the terminal `us` (0 … 1) through its stance (rad, + toes up), as far as it steps: minimum-jerk between its keys (a spline's overshoot would lift a flat hoof's toe) */
  private pitch(us: number, stepping: number): number {
    const keys = this.leg.rocker;
    let k = 0;
    while (k < keys.length - 2 && us >= keys[k + 1][0]) k++;
    const [[u0, a], [u1, b]] = [keys[k], keys[k + 1]];
    return (a + (b - a) * minimumJerk((us - u0) / (u1 - u0))) * DEG * stepping;
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
const _root = new Vector3();
const _rootTurn = new Quaternion();
