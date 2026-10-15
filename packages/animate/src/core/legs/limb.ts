// A leg posed by one solver each tick (solve.ts): planted, its terminal held on its contact (rolling
// over it as the gait's rocker has it); swinging, its joints on a minimum-jerk plan in joint space
// from how they lifted (angle, rate, acceleration) to rest at the landing's joints (solved ahead
// each tick, at the root's planned pose then), the reference cycle's swing shape over it, scaled
// to clear the ground at mid-swing; the ground itself a one-sided correction, the joints nearest
// their plan that keep the foot above it.
import { Euler, Quaternion, Vector3 } from 'three';
import { STEP, type Frame } from '../body';
import type { Pose, ReadonlyPose } from '../pose';
import { angleAt, DEG, valueAt, type Cycle } from './cycle';
import type { Leg, LegState } from './legs';
import { boundSwing, minimumJerk, quintic, type Swing } from './swing';
import type { Stride } from './gait';
import { Solver, type Target } from './solve';

interface Motion {
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
  private readonly cycles: (Cycle | null)[];
  private swing: Swing | null = null;
  private lifting = false;
  private held: { position: Vector3; rotation: Quaternion } | null = null;

  /** Read the previous completed pose, including later writers. */
  check(f: Frame): void {
    if (!f.dev || !this.held) return;
    const p = f.prev;
    const where = p.skeleton.bones[this.terminal].name;
    const miss = p.position(this.terminal).distanceTo(this.held.position);
    // 0.1 mm distinguishes numerical settling from visible contact movement.
    if (miss > 1e-4) f.dev.append(f.time - f.dt, { check: 'leg contact (m)', value: miss, limit: 1e-4, where });
    const turn = new Quaternion().copy(p.rotation(this.terminal)).angleTo(this.held.rotation);
    // A tenth of a milliradian detects a later writer rotating a foot about its fixed origin.
    if (turn > 1e-4) f.dev.append(f.time - f.dt, { check: 'leg contact turn (rad)', value: turn, limit: 1e-4, where });
    const depth = -this.lowest(p);
    if (depth > 1e-4) f.dev.append(f.time - f.dt, { check: 'leg ground (m)', value: depth, limit: 1e-4, where });
  }
  /** the terminal's points kept above the ground swinging (its frame): its heel, toe, and its toes' tip (as the toes are bent then: `aboveAt`) */
  private readonly above: Vector3[];
  /** the toes' joint in the terminal's frame */
  private readonly toesOffset = new Vector3();
  /**
   * what it did: the terminal off its contact (m), off the landing solved ahead (m), the most the
   * ground corrected a swing's joints (rad), the ticks a swing went into the ground anyway, its
   * shapes' scales (least, most)
   */
  readonly report = { contact: 0, landing: 0, ground: 0, lifted: 0, scale: [Infinity, 0] };

  constructor(
    readonly leg: Leg,
    rest: ReadonlyPose,
  ) {
    const s = rest.skeleton;
    if (!(Number.isFinite(leg.swingScale ?? 1) && (leg.swingScale ?? 1) >= 0)) throw new Error('swingScale must be finite and nonnegative');
    this.solver = new Solver(s, leg.bones, leg.axes);
    this.top = leg.bones[0];
    this.terminal = leg.bones[leg.bones.length - 1];
    this.anchor.copy(rest.position(this.terminal)).sub(rest.position(0)).applyQuaternion(_q.copy(rest.rotation(0)).invert());
    this.cycles = Array.from({ length: this.solver.n }, (_, j) => {
      const k = leg.bones.findIndex((_, i) => this.solver.coordinate(i, 'x') === j);
      return k < 0 ? null : (leg.cycles.get(leg.bones[k]) ?? null);
    });
    // (a hinge whose range passes straight is held to the side its reference keeps to: straight, it is a saddle the solver would stick on past it)
    this.cycles.forEach((c, j) => {
      const k = this.solver.boneOf(j);
      if (!c || k + 1 >= leg.bones.length) return;
      const straight = straightOf(s.bones[leg.bones[k]].offset, s.bones[leg.bones[k + 1]].offset, this.solver.lo[j], this.solver.hi[j]);
      if (straight === null) return;
      const values = c.keys.map(([, v]) => v * DEG);
      if (Math.max(...values) <= straight) this.solver.hi[j] = Math.min(straight - bendMargin(values, straight), this.solver.hi[j]);
      else if (Math.min(...values) >= straight) this.solver.lo[j] = Math.max(straight + bendMargin(values, straight), this.solver.lo[j]);
    });
    if (leg.toes) this.toesOffset.copy(s.bones[leg.toes.bone].offset);
    this.above = [leg.heel.clone(), leg.toe.clone(), ...(leg.toes ? [this.toesOffset.clone().add(leg.toes.tip)] : [])];
  }

  /** where the leg stands in `pose`: its terminal's origin (at its standing height) and heading */
  standing(pose: ReadonlyPose): { position: Vector3; yaw: number } {
    return { position: pose.position(this.terminal).clone().setY(-Math.min(this.leg.heel.y, this.leg.toe.y)), yaw: headingOf(pose.rotation(this.terminal)) };
  }

  /** the swing starts: it is taken from where the terminal is as it poses next */
  lift() {
    this.lifting = true;
  }

  /** the leg posed for `state` at the walker's phase, its swing clearing the ground by `clearance` (m) */
  pose(f: Frame<unknown>, walker: Motion, state: LegState, clearance: number) {
    const { leg, solver } = this;
    const { duty, stepping } = walker.stride;
    const p = f.current;
    this.held = null;
    if (!state.planted) return this.swung(f, walker, state, clearance);
    this.swing = null;
    const u = walker.phase - state.footfall;
    this.refs(u, duty, stepping);
    const pitch = this.pitch(Math.min(1, u / duty), stepping);
    const target = this.planted(state.foothold, pitch, _target);
    this.held = { position: target.position.clone(), rotation: target.rotation.clone() };
    this.report.contact = Math.max(this.report.contact, solver.solve(p, target));
    if (leg.toes) p.setLocal(leg.toes.bone, sagittal(-Math.min(0, pitch), _q));
  }

  /** each joint's reference: its cycle at leg phase `u`, the rest at standing */
  private refs(u: number, duty: number, stepping: number) {
    for (let j = 0; j < this.solver.n; j++) {
      const c = this.cycles[j];
      this.solver.setRef(j, c ? angleAt(c, u, duty) * stepping : 0);
    }
  }

  /** the swing this tick: its plan stepped toward the landing as now seen, its shape over it, the ground kept */
  private swung(f: Frame<unknown>, walker: Motion, state: LegState, clearance: number) {
    const { leg, solver } = this;
    const { frequency } = walker.stride;
    const p = f.current;
    const span = (state.footfall - state.lift) / frequency;
    const left = Math.max(0, (state.footfall - walker.phase) / frequency);
    const s = 1 - left / span;
    if (this.lifting || !this.swing) this.swing = this.lifted(p, walker, span);
    const swing = this.swing;
    this.landing(p, walker, state, left);
    for (let j = 0; j < solver.n; j++) boundSwing(swing, j, left + f.dt, solver.lo[j], solver.hi[j]);
    for (let j = 0; j < solver.n; j++) [swing.x[j], swing.v[j], swing.a[j]] = quintic(swing.x[j], swing.v[j], swing.a[j], swing.land[j], left + f.dt, f.dt);
    if (this.lifting) this.fit(p, walker, state, clearance);
    this.lifting = false;
    for (let j = 0; j < solver.n; j++) solver.setRef(j, swing.x[j] + swing.scale * this.shape(j, s));
    _swingTarget.above = this.aboveAt(s);
    solver.solve(p, _swingTarget, true);
    for (let j = 0; j < solver.n; j++) this.report.ground = Math.max(this.report.ground, Math.abs(solver.q[j] - solver.ref[j]));
    if (leg.toes) p.setLocal(leg.toes.bone, this.toesAt(s, _a));
    if (this.lowest(p) < -1e-3) this.report.lifted++;
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
  private lifted(p: Pose, walker: Motion, span: number): Swing {
    const { q, q1 } = this.solver;
    const dt = STEP;
    const stepping = walker.stride.stepping;
    return {
      x: Float64Array.from(q),
      // Quintic Bezier controls P1=x+vT/5, P2=x+2vT/5+aT²/20.
      // Keep both inside ROM; convexity then bounds the entire base curve.
      v: Float64Array.from(q, (x, j) => Math.min(2.5 * (this.solver.hi[j] - x) / span, Math.max(2.5 * (this.solver.lo[j] - x) / span, (x - q1[j]) / dt))),
      // Acceleration at a fast breakover is noisy; zero keeps P2's bound exact.
      a: new Float64Array(q.length),
      land: Float64Array.from(q),
      stepping,
      scale: 1,
      toes: this.leg.toes ? p.local(this.leg.toes.bone).clone() : new Quaternion(),
    };
  }

  /**
   * coordinate `j`'s swing shape `s` (0 … 1) through it: its reference cycle's swing over the
   * chord between its ends (the knee's bump, the carpus's fold), eased in and out (16 s²(1 − s)²:
   * none of it at either end, nor its rate or acceleration, the plan's own there)
   */
  private shape(j: number, s: number): number {
    const c = this.cycles[j];
    const swing = this.swing;
    if (!c || !swing) return 0;
    const [a, b] = [swingOf(c, 0), swingOf(c, 1)];
    return (swingOf(c, s) - a - (b - a) * s) * swing.stepping * 16 * s * s * (1 - s) * (1 - s);
  }

  /** the landing solved ahead: the joints that stand on the contact `left` s from now, the root where it is planned then (from the last tick's) */
  private landing(p: Pose, walker: Motion, state: LegState, left: number) {
    const swing = this.swing;
    if (!swing) throw new Error('a landing without a swing');
    const { duty, stepping } = walker.stride;
    this.refs(0, duty, stepping);
    this.baseAt(p, walker, left, _turn, _top);
    const target = this.planted(state.foothold, this.pitch(0, stepping), _target);
    this.report.landing = Math.max(this.report.landing, this.solver.reach(_turn, _top, target, swing.land));
  }

  /** the top joint's parent's turn and the top joint's position `ahead` s from now: off the root as now, the root where it is planned then */
  private baseAt(p: Pose, walker: Motion, ahead: number, turn: Quaternion, top: Vector3) {
    const parent = p.skeleton.bones[this.top].parent;
    walker.rootAt(ahead, _root, _rootTurn);
    const inverse = _a.copy(p.rotation(0)).invert();
    turn.copy(_rootTurn).multiply(_b.copy(inverse).multiply(p.rotation(parent)));
    top.copy(p.position(this.top)).sub(p.position(0)).applyQuaternion(inverse).applyQuaternion(_rootTurn).add(_root);
  }

  /**
   * The swing's shape scaled to clear the ground by `clearance` (m) at mid-swing, as planned at
   * lift-off (the root where it is planned then, the landing as now seen): the least scale that
   * does, at most the data's swingScale (bisected: the lowest point rises with the scale)
   */
  private fit(p: Pose, walker: Motion, state: LegState, clearance: number) {
    const swing = this.swing;
    if (!swing) throw new Error('a fit without a swing');
    const { solver } = this;
    const { frequency } = walker.stride;
    const left = Math.max(0, (state.footfall - walker.phase) / frequency);
    const ahead = Math.max(0, (state.lift + (state.footfall - state.lift) / 2 - walker.phase) / frequency);
    this.baseAt(p, walker, ahead, _turn, _top);
    const plan = Float64Array.from(swing.x, (x, j) => quintic(x, swing.v[j], swing.a[j], swing.land[j], left, ahead)[0]);
    const q = new Float64Array(solver.n);
    const clears = (scale: number) => {
      for (let j = 0; j < solver.n; j++) q[j] = plan[j] + scale * this.shape(j, 0.5);
      return solver.lowest(_turn, _top, q, this.aboveAt(0.5)) >= clearance;
    };
    let [lo, hi] = [0, this.leg.swingScale ?? 1];
    if (clears(lo)) hi = lo;
    else if (!clears(hi)) lo = hi;
    while (hi - lo > 1e-3) {
      const mid = (lo + hi) / 2;
      if (clears(mid)) hi = mid;
      else lo = mid;
    }
    swing.scale = hi;
    this.report.scale = [Math.min(this.report.scale[0], hi), Math.max(this.report.scale[1], hi)];
  }

  /** the rocker's pitch of the terminal `us` (0 … 1) through its stance (rad, + toes up), as far as it steps: minimum-jerk between its keys (a spline's overshoot would lift a flat hoof's toe) */
  private pitch(us: number, stepping: number): number {
    const keys = this.leg.rocker.keys;
    let k = 0;
    while (k < keys.length - 2 && us >= keys[k + 1][0]) k++;
    const [[u0, a], [u1, b]] = [keys[k], keys[k + 1]];
    return (a + (b - a) * minimumJerk((us - u0) / (u1 - u0))) * DEG * stepping;
  }

  /** the terminal planted on `contact` pitched `pitch` about its heel (+, toes up) or toe (−): its origin and world turn, as a held target into `out` */
  private planted(contact: { position: Vector3; yaw: number }, pitch: number, out: Target): Target {
    this.place(contact, pitch, out.position, out.rotation);
    out.held = true;
    out.above = [];
    return out;
  }

  /** the terminal planted on `contact` pitched `pitch`: its origin and world turn */
  private place(contact: { position: Vector3; yaw: number }, pitch: number, tipOut: Vector3, turnOut: Quaternion): Vector3 {
    const pivot = pitch >= 0 ? this.leg.heel : this.leg.toe;
    yawPitch(contact.yaw, pitch, turnOut);
    return tipOut
      .copy(pivot)
      .applyQuaternion(yawPitch(contact.yaw, 0, _a))
      .add(contact.position)
      .sub(_w.copy(pivot).applyQuaternion(turnOut));
  }

  /** the lowest the terminal's heel or toe (or its toes' tip) is (m, above the ground) */
  private lowest(p: ReadonlyPose): number {
    const { leg } = this;
    const low = Math.min(p.point(this.terminal, leg.heel, _w).y, p.point(this.terminal, leg.toe, _w).y);
    return leg.toes ? Math.min(low, p.point(leg.toes.bone, leg.toes.tip, _w).y) : low;
  }

}

/** where in `lo`…`hi` (rad) a hinge bending about −x lays `child` (its child's offset) along `bone` (its own, off its parent), within 2° (null: nowhere) */
function straightOf(bone: Vector3, child: Vector3, lo: number, hi: number): number | null {
  let best: number | null = null;
  let least = 2 * DEG;
  for (let q = lo; q <= hi; q += DEG / 10) {
    const v = _w.copy(child).applyAxisAngle(AXIS_X, q);
    const angle = v.angleTo(bone);
    if (angle < least) [least, best] = [angle, q];
  }
  return best;
}
const AXIS_X = new Vector3(-1, 0, 0);

/** a cycle's swing `s` (0 … 1) through it (rad): from its toe-off to its end */
const swingOf = (c: Cycle, s: number) => valueAt(c.keys, c.duty + s * (1 - c.duty)) * DEG;

/** a rotation by `angle` (rad) in a bone's sagittal plane: its far end forward (about −X) */
const sagittal = (angle: number, out: Quaternion) => out.setFromAxisAngle(X, -angle);

/** a heading `yaw` pitched `pitch` (+ toes up), as a world rotation */
const yawPitch = (yaw: number, pitch: number, out: Quaternion) => out.setFromEuler(_e.set(-pitch, yaw, 0, 'YXZ'));

/** the heading of a rotation: where it turns +Z, about +Y */
export function headingOf(q: Readonly<Quaternion>): number {
  const f = _h.set(0, 0, 1).applyQuaternion(q);
  return Math.atan2(f.x, f.z);
}

const X = new Vector3(1, 0, 0);
const _e = new Euler();
const _h = new Vector3();
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

/** Leave the reference's smallest bend, capped at 2° to retain reach near extension. */
function bendMargin(values: number[], straight: number): number {
  return Math.min(2 * DEG, ...values.map((v) => Math.abs(v - straight)));
}
