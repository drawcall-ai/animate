import { minimumJerk, yawOf } from '../math';
// Stance pins the terminal; swing follows a quintic joint plan plus the reference cycle's shape.
// The free terminal follows those references while its sole clears the ground.
import { Euler, Quaternion, Vector3 } from 'three';
import { STEP, type Frame } from '../body';
import type { Pose, ReadonlyPose } from '../pose';
import { angleAt, DEG, valueAt, type JointCycle } from './cycle';
import type { LegChain, LegTiming } from './legs';
import { boundSwing, quintic, type Swing } from './swing';
import type { Stride } from './gait';
import { Solver, type Target } from './solve';

export interface Motion {
  phase: number;
  stride: Stride;
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
  supports(p: Pose, state: LegTiming, walker: Motion): boolean {
    const { duty, frequency, stepping } = walker.stride;
    this.refs(walker.phase - state.footfall, duty, stepping);
    for (const ahead of [0, 0.1]) {
      this.baseAt(p, walker, ahead, _turn, _top);
      const pitch = this.pitch(Math.min(1, (walker.phase + ahead * frequency - state.footfall) / duty), stepping);
      const target = this.planted(state.foothold, pitch, _target);
      if (this.solver.reach(_turn, _top, target, this.trial) >= 1e-5) return false;
    }
    return true;
  }

  /** Shorten a proposed step until its landing is reachable, before committing the foothold. */
  foothold(p: Pose, walker: Motion, ahead: number, contact: LegTiming['foothold']): void {
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

  standingAt(walker: Motion, ahead: number, height: number): Vector3 {
    walker.rootAt(ahead, _root, _rootTurn);
    return this.anchor.clone().applyQuaternion(_rootTurn).add(_root).setY(height);
  }

  /** The same reserve used by preflight and the foothold search. */
  landingSupported(p: Pose, walker: Motion, ahead: number, contact: LegTiming['foothold']): boolean {
    this.refs(0, walker.stride.duty, walker.stride.stepping);
    for (const time of [ahead, ahead + 0.1]) {
      this.baseAt(p, walker, time, _turn, _top);
      for (const pitch of [0, this.pitch((time - ahead) * walker.stride.frequency / walker.stride.duty, walker.stride.stepping)]) {
        const target = this.planted(contact, pitch, _target);
        if (this.solver.reach(_turn, _top, target, this.trial) >= 1e-6) return false;
      }
    }
    return true;
  }

  /** the swing starts: it is taken from where the terminal is as it poses next */
  lift() {
    this.lifting = true;
  }

  /** the leg posed for `state` at the walker's phase, its swing clearing the ground by `clearance` (m) */
  pose(f: Frame<unknown>, walker: Motion, state: LegTiming, clearance: number) {
    const { leg, solver } = this;
    const { duty, stepping } = walker.stride;
    const p = f.current;
    this.ready = true;
    this.held = null;
    if (!state.planted) return this.swung(f, walker, state, clearance);
    this.swing = null;
    const u = walker.phase - state.footfall;
    this.refs(u, duty, stepping);
    const pitch = this.pitch(Math.min(1, u / duty), stepping);
    const target = this.planted(state.foothold, pitch, _target);
    this.held = { position: target.position.clone(), rotation: target.rotation.clone() };
    solver.solve(p, target);
    if (leg.toes) p.setLocal(leg.toes.bone, sagittal(-Math.min(0, pitch), _q));
  }

  /** each joint's reference: its cycle at leg phase `u`, the rest at standing */
  private refs(u: number, duty: number, stepping: number) {
    for (let j = 0; j < this.solver.n; j++) {
      const c = this.cycles[j];
      this.solver.setRef(j, (c ? angleAt(c, u, duty) * stepping : 0) + this.rest[j] * (1 - stepping));
    }
  }

  /** the swing this tick: its plan stepped toward the landing as now seen, its shape over it, the ground kept */
  private swung(f: Frame<unknown>, walker: Motion, state: LegTiming, clearance: number) {
    const { leg, solver } = this;
    const { frequency } = walker.stride;
    const p = f.current;
    const span = (state.footfall - state.lift) / frequency;
    const left = Math.max(0, (state.footfall - walker.phase) / frequency);
    const s = 1 - left / span;
    if (this.lifting || !this.swing) this.swing = this.lifted(p, walker);
    const swing = this.swing;
    this.landing(p, walker, state, left);
    for (let j = 0; j < solver.n; j++) boundSwing(swing, j, left + f.dt, solver.lo[j], solver.hi[j]);
    for (let j = 0; j < solver.n; j++) [swing.x[j], swing.v[j], swing.a[j]] = quintic(swing.x[j], swing.v[j], swing.a[j], swing.land[j], left + f.dt, f.dt);
    this.lifting = false;
    for (let j = 0; j < solver.n; j++) solver.setRef(j, swing.x[j] + this.shape(j, s, walker.stride.duty));
    _swingTarget.above = this.aboveAt(s);
    // C² at both contacts, with the full sole clearance at mid-swing.
    _swingTarget.floor = clearance * 64 * s ** 3 * (1 - s) ** 3;
    solver.solve(p, _swingTarget);
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

  /** the swing setting off from how the joints have gone these three ticks */
  private lifted(p: Pose, walker: Motion): Swing {
    const { q, q1 } = this.solver;
    const dt = STEP;
    const stepping = walker.stride.stepping;
    return {
      x: Float64Array.from(q),
      v: Float64Array.from(q, (x, j) => (x - q1[j]) / dt),
      a: new Float64Array(q.length),
      land: Float64Array.from(q),
      stepping,
      toes: this.leg.toes ? p.local(this.leg.toes.bone).clone() : new Quaternion(),
    };
  }

  /**
   * coordinate `j`'s swing shape `s` (0 … 1) through it: its reference cycle's swing over the
   * chord between its ends (the knee's bump, the carpus's fold), eased in and out (16 s²(1 − s)²:
   * none of it at either end, nor its rate or acceleration, the plan's own there)
   */
  private shape(j: number, s: number, duty: number): number {
    const c = this.cycles[j];
    const swing = this.swing;
    if (!c || !swing) return 0;
    const [a, b] = [swingOf(c, 0), swingOf(c, 1)];
    // For a folded limb, shortening is proportional to angle² near extension. Scale its
    // flexion by sqrt(travel), preserving clearance as horizontal steps become shorter.
    return (swingOf(c, s) - a - (b - a) * s) * (c.amplitude?.(duty) ?? 1) * Math.sqrt(swing.stepping) * 16 * s * s * (1 - s) * (1 - s);
  }

  /** the landing solved ahead: the joints that stand on the contact `left` s from now, the root where it is planned then (from the last tick's) */
  private landing(p: Pose, walker: Motion, state: LegTiming, left: number) {
    const swing = this.swing;
    if (!swing) throw new Error('a landing without a swing');
    const { duty, stepping } = walker.stride;
    this.refs(0, duty, stepping);
    this.baseAt(p, walker, left, _turn, _top);
    const target = this.planted(state.foothold, this.pitch(0, stepping), _target);
    this.solver.reach(_turn, _top, target, swing.land);
  }

  /** the top joint's parent's turn and the top joint's position `ahead` s from now: off the root as now, the root where it is planned then */
  private baseAt(p: Pose, walker: Motion, ahead: number, turn: Quaternion, top: Vector3) {
    const parent = p.skeleton.bones[this.top].parent;
    walker.rootAt(ahead, _root, _rootTurn);
    const inverse = _a.copy(p.rotation(0)).invert();
    turn.copy(_rootTurn).multiply(_b.copy(inverse).multiply(p.rotation(parent)));
    top.copy(p.position(this.top)).sub(p.position(0)).applyQuaternion(inverse).applyQuaternion(_rootTurn).add(_root);
  }

  /** the rocker's pitch of the terminal `us` (0 … 1) through its stance (rad, + toes up), as far as it steps: minimum-jerk between its keys (a spline's overshoot would lift a flat hoof's toe) */
  private pitch(us: number, stepping: number): number {
    const keys = this.leg.rocker.keys;
    let k = 0;
    while (k < keys.length - 2 && us >= keys[k + 1][0]) k++;
    const [[u0, a], [u1, b]] = [keys[k], keys[k + 1]];
    return (a + (b - a) * minimumJerk((us - u0) / (u1 - u0))) * DEG * stepping;
  }

  /** Roll about the heel or toe while keeping that contact fixed in world space. */
  private planted(contact: { position: Vector3; yaw: number }, pitch: number, out: Target): Target {
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

/** a cycle's swing `s` (0 … 1) through it (rad): from its toe-off to its end */
const swingOf = (c: JointCycle, s: number) => valueAt(c.keys, c.duty + s * (1 - c.duty)) * DEG;

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
const _target: Target = { held: true, position: new Vector3(), rotation: new Quaternion(), above: [] };
const _swingTarget: Target = { held: false, position: new Vector3(), rotation: new Quaternion(), above: [] };
const _turn = new Quaternion();
const _top = new Vector3();
const _root = new Vector3();
const _rootTurn = new Quaternion();
