// A leg posed over the foot the stepper places: its joints solved to it, each following its stride cycle (the carpus folding, the hock flexing) as a soft reference.
import { Euler, Quaternion, Vector3 } from 'three';
import { STRAIGHTER, yawPitch } from './feet';
import type { Frame } from '../kernel/frame';
import type { ReadonlyBonePose } from '../kernel/bone-pose';
import { angleAt, type JointCycle } from '../species/cycle';
import { strideAt, type Gait } from '../species/gait';
import type { LegChain } from '../species/leg-chain';
import { SINGULAR, Solver, type LegTarget } from './solve';
import { minimumJerk, wrapAngle } from '../kernel/math';
import { followRotation } from '../kernel/follow';
import { clampRotation } from '../kernel/limits';
import type { Floor } from '../step/floor';
import type { FootPose } from '../step/types';

/** Tuned: the share of a swing over which the stride's references take over from the leg as it lifted */
const TAKING = 0.3;
/**
 * A leg posed over its foot: its joints solved to the foot's place and turn (rigid planted, compliant swinging, the sole kept above
 * the floor), each following its stride cycle at the leg's phase as far as the body is walking, its rest pose standing.
 */
export class ChainLeg {
  readonly solver: Solver;
  private readonly cycles: (JointCycle | null)[];
  private readonly rest: Float64Array;
  private readonly twist: number;
  /** how far (rad) its planted foot stands turned from the body at most, the rest pivoting on the floor */
  get turn() { return TWISTING * this.twist; }
  private readonly sole: Vector3[];
  /** where and how the foot was held planted last sub-step, if it was; whether it had just landed */
  private held: { position: Vector3; rotation: Quaternion } | null = null; private landed = false;
  /** where its planted foot's heel, contact and toe were last sub-step, while it stands, and how far it has slipped since it landed */
  private put: [Vector3, Vector3][] | null = null; private slipped = 0;
  /** its contact with the floor, in the foot's terms: under the middle of its sole */
  private readonly contact: Vector3;
  private posed = false;

  /**
   * Development checks of the last final pose (`f.prev`): a planted foot kept as it is held (`CONTACT`: pivoting about its contact,
   * which slides no further than `CONTACT.slide` from where it was put), landing no faster than
   * `TOUCHDOWN` (m/s, down and along), the sole never below the floor.
   */
  check(f: Frame) {
    const dev = f.dev, terminal = this.solver.bones[this.solver.bones.length - 1], where = f.prev.skeleton.bones[terminal].name, time = f.time - f.dt;
    if (!dev || !this.posed) return;
    const sunk = Math.max(...this.sole.map((point) => this.below(f.prev.point(terminal, point, _v))));
    if (sunk > CONTACT.distance) dev.append(time, { check: 'leg ground (m)', value: sunk, limit: CONTACT.distance, where });
    if (!this.held) return;
    const miss = f.prev.position(terminal).distanceTo(this.held.position), turn = f.prev.rotation(terminal).angleTo(this.held.rotation);
    if (miss > CONTACT.distance) dev.append(time, { check: 'leg contact (m)', value: miss, limit: CONTACT.distance, where });
    if (turn > CONTACT.turn) dev.append(time, { check: 'leg contact turn (rad)', value: turn, limit: CONTACT.turn, where });
    // (the contact it pivots or rolls about stays put — its heel, the middle of its sole or its toe, whichever moves least each sub-step —
    // its slips over the stance together)
    if (this.put) {
      this.slipped += Math.min(...this.put.map(([point, at]) => f.prev.point(terminal, point, _v).distanceTo(at)));
      for (const [point, at] of this.put) f.prev.point(terminal, point, at);
    }
    if (this.slipped > CONTACT.slide) dev.append(time, { check: 'leg contact slide (m)', value: this.slipped, limit: CONTACT.slide, where });
    if (!this.landed) return;
    const velocity = _v.subVectors(f.prev.position(terminal), f.prev2.position(terminal)).divideScalar(f.dt), along = Math.hypot(velocity.x, velocity.z);
    if (Math.abs(velocity.y) > TOUCHDOWN.down) dev.append(time, { check: 'leg touchdown vertical speed (m/s)', value: Math.abs(velocity.y), limit: TOUCHDOWN.down, where });
    if (along > TOUCHDOWN.along) dev.append(time, { check: 'leg touchdown horizontal speed (m/s)', value: along, limit: TOUCHDOWN.along, where });
  }

  /** the joints as the foot lifted, while it swings */
  private lifting: Float64Array | null = null;
  private readonly target: LegTarget = { swing: null, position: new Vector3(), rotation: new Quaternion(), above: [] };

  private readonly sign: number; private readonly length: number;

  /** `floor`: what its foot stands on */
  constructor(private readonly chain: LegChain, private readonly start: ReadonlyBonePose, private readonly floor: Floor) {
    const top = chain.joints[0].bone, terminal = chain.joints[chain.joints.length - 1].bone;
    this.sign = start.position(terminal).x - start.position(0).x >= 0 ? 1 : -1;
    this.length = start.position(top).distanceTo(start.position(terminal));
    this.solver = new Solver(start.skeleton, chain.joints);
    this.cycles = chain.joints.flatMap(({ axes, cycle }) => [...axes].map((axis) => axis === 'x' ? cycle ?? null : null));
    this.rest = Float64Array.from(chain.joints.flatMap(({ bone, axes }) => {
      _e.setFromQuaternion(start.local(bone), 'YZX');
      return [...axes].map((axis) => axis === 'x' ? -_e.x : axis === 'y' ? _e.y : _e.z);
    }));
    this.solver.q.set(this.rest);
    // (how far the leg twists about its length, all its turning joints together)
    this.twist = chain.joints.reduce((sum, { bone, axes }) => {
      const limit = start.skeleton.limits[bone];
      return sum + (axes.includes('y') ? limit ? Math.min(-limit.twist[0], limit.twist[1]) : Math.PI : 0);
    }, 0);
    this.sole = [chain.heel.clone(), chain.toe.clone()];
    this.contact = chain.heel.clone().add(chain.toe).multiplyScalar(0.5);
    this.ball = Math.min(0, ...chain.rocker.map(([, pitch]) => pitch)) * Math.PI / 180;
  }
  /** how far `point` is below the floor under it (m; − above it) */
  private below(point: Readonly<Vector3>): number {
    return this.floor(point.x, point.z) - point.y;
  }

  /** the furthest its foot rolls over its toe (rad, − toes down): its rocker's breakover */
  readonly ball: number;

  /**
   * How far below its top the leg reaches its foot (its terminal joint) heading the body's way (m), at an offset `out` from the body
   * and `ahead` (m), the foot flat or `pitch` (rad) rolled over its toe toward its `ball`, as its joints' ranges allow: sampled once on
   * a grid (`DEPTH`) flat and rolled, read between its points and between the two; past it, nowhere.
   */
  readonly depth = (out: number, ahead: number, pitch = 0): number => {
    const share = this.ball < 0 ? Math.max(0, Math.min(1, pitch / this.ball)) : 0;
    if (share === 0) return this.read(this.flat ??= this.tableAt(0), out, ahead);
    const rolled = this.read(this.rolled ??= this.tableAt(this.ball), out, ahead);
    if (share === 1) return rolled;
    const flat = this.read(this.flat ??= this.tableAt(0), out, ahead);
    return flat > -Infinity && rolled > -Infinity ? flat + (rolled - flat) * share : share < 0.5 ? flat : rolled;
  };
  private flat: Table | null = null; private rolled: Table | null = null;

  /** its table at `pitch`: sampled once for every leg of its bones, ranges and standing, whatever body or species made it */
  private tableAt(pitch: number): Table {
    const { bones, limits } = this.start.skeleton;
    const joints = this.chain.joints.map(({ bone, axes }) => `${axes}:${bones[bone].offset.toArray()}:${JSON.stringify(limits[bone])}`);
    const key = `${joints.join(';')}|${pitch}|${this.sign}|${this.length}|${Array.from(this.rest)}`;
    let table = TABLES.get(key);
    if (!table) TABLES.set(key, table = this.sample(pitch));
    return table;
  }

  private read(t: Table, out: number, ahead: number): number {
    const { across, along } = t;
    const x = (out - across[0]) / (across[1] - across[0]), z = (ahead - along[0]) / (along[1] - along[0]);
    const i = Math.floor(x), k = Math.floor(z);
    // (further across than the grid, nowhere; ahead or behind it, as a sphere of its length a little past standing: there only a long
    // stride's foot lands)
    if (i < 0 || i >= DEPTH.across - 1) return -Infinity;
    if (k < 0 || k >= DEPTH.along - 1) return Math.sqrt(Math.max(0, (STRAIGHTER * this.length) ** 2 - out * out - ahead * ahead));
    const u = x - i, w = z - k;
    if (!(t.at(i, k) > -Infinity && t.at(i, k + 1) > -Infinity && t.at(i + 1, k) > -Infinity && t.at(i + 1, k + 1) > -Infinity)) return -Infinity;
    // (kept `SPARE` short of it: a leg at the very edge of its ranges has no give for the rest of the body's motion)
    return (t.at(i, k) * (1 - w) + t.at(i, k + 1) * w) * (1 - u) + (t.at(i + 1, k) * (1 - w) + t.at(i + 1, k + 1) * w) * u - SPARE * this.length;
  }

  /** its table at `pitch`, each point solved the first time it is read (its own solver: the leg's posing one keeps its references) */
  private sample(pitch: number): Table {
    const length = this.length, target: LegTarget = { swing: null, position: new Vector3(), rotation: new Quaternion(), above: [] };
    const solver = new Solver(this.start.skeleton, this.chain.joints);
    solver.q.set(this.rest);
    for (let j = 0; j < solver.n; j++) solver.setRef(j, this.rest[j]);
    const across = Array.from({ length: DEPTH.across }, (_, i) => length * (DEPTH.out[0] + (DEPTH.out[1] - DEPTH.out[0]) * i / (DEPTH.across - 1)));
    const along = Array.from({ length: DEPTH.along }, (_, k) => length * DEPTH.ahead * (2 * k / (DEPTH.along - 1) - 1));
    const values = new Float64Array(DEPTH.across * DEPTH.along).fill(NaN);
    yawPitch(0, pitch, target.rotation);
    // (no further than its bones laid end to end: there it is not worth solving)
    const most = this.chain.joints.reduce((sum, { bone }, j, joints) => j ? sum + this.start.position(bone).distanceTo(this.start.position(joints[j - 1].bone)) : 0, 0);
    const sign = this.sign, kept = Float64Array.from(this.rest);
    const reaches = (out: number, ahead: number, down: number) => {
      if (Math.hypot(out, down, ahead) > most) return false;
      target.position.set(sign * out, -down, ahead);
      // (a leg pulled straight is singular: there it reaches no further)
      try { return solver.reach(target, DEPTH.iterations) < DEPTH.miss && solver.rotationError < DEPTH.turn; } catch (cause) {
        if (!(cause instanceof Error && cause.message === SINGULAR)) throw cause;
        solver.q.set(kept);
        return false;
      }
    };
    const at = (i: number, k: number): number => {
      const index = i * DEPTH.along + k;
      if (!Number.isNaN(values[index])) return values[index];
      const out = across[i], ahead = along[k];
      // (the lowest it reaches down there: the first of `DOWN` it reaches from the furthest, then halved toward the one before it)
      const j = DOWN.findIndex((down) => reaches(out, ahead, down * length));
      if (j < 0) return values[index] = -Infinity;
      let [lo, hi] = [DOWN[j] * length, (DOWN[j - 1] ?? DOWN[0] + 0.1) * length];
      for (let n = 0; n < DEPTH.steps; n++) { const mid = (lo + hi) / 2; if (reaches(out, ahead, mid)) lo = mid; else hi = mid; }
      return values[index] = lo;
    };
    return { across, along, at };
  }

  /**
   * The leg posed on `f.current` for `foot` (`u`: its phase through the stride, 0 at landing; `swing`: how far through its swing, or
   * null planted), its references the gait's cycles there (for its `leg` of the gait) as far as it walks (`stepping`, 0 … 1).
   */
  pose(f: Frame, foot: FootPose, u: number, swing: number | null, gait: Gait, speed: number, stepping: number, facing: number, leg = 0) {
    const { solver, target, cycles, rest } = this, stride = strideAt(gait, speed, leg), blend = stride.referenceBlend ?? 0;
    // (lifted, the references take over from the leg as it stood over the first `TAKING` of the swing: it does not snap to them)
    const terminal = solver.bones[solver.bones.length - 1];
    if (swing === null) this.lifting = null;
    else this.lifting ??= Float64Array.from(solver.q);
    const taken = swing === null ? 1 : minimumJerk(swing / TAKING);
    for (let j = 0; j < solver.n; j++) {
      const c = cycles[j], ref = (c ? angleAt(c, u, stride.duty, blend) * stepping : 0) + rest[j] * (1 - stepping);
      solver.setRef(j, this.lifting ? this.lifting[j] + (ref - this.lifting[j]) * taken : ref, 1 + ((c?.alternateWeight ?? 1) - 1) * blend);
    }
    target.swing = swing;
    target.above = this.sole;
    target.position.copy(foot.ankle);
    // (a planted foot pivots on the floor about its contact as the body turns over it, heading the body's way — where its leg's reach
    // is known — and never slides: its contact stays where it is put — about the end of the sole it stands on, the lowest)
    const off = wrapAngle(foot.yaw - facing), lowest = (point: Vector3) => _v.copy(point).applyQuaternion(foot.foot).y;
    const pivot = [this.chain.heel, this.contact, this.chain.toe].reduce((best, point) => lowest(point) < lowest(best) - 1e-6 ? point : best, this.contact);
    const contact = _p.copy(pivot).applyQuaternion(foot.foot).add(foot.ankle);
    target.rotation.copy(foot.foot);
    if (off !== 0) {
      target.rotation.premultiply(_a.setFromAxisAngle(UP, -off));
      target.position.copy(pivot).applyQuaternion(target.rotation).negate().add(contact);
    }
    // (planted, a contact missed by more than `CONTACT` is solved again from the references: the leg does not keep to a bend that cannot
    // hold it; a near miss it keeps, its joints not leaping)
    const missed = solver.solve(f.current, target, false);
    if (missed > CONTACT.distance && swing === null) solver.solve(f.current, target, true);
    this.landed = this.held === null && swing === null && this.posed;
    this.posed = true;
    this.held = swing === null ? { position: target.position.clone(), rotation: target.rotation.clone() } : null;
    const putAt = (point: Vector3) => [point, point.clone().applyQuaternion(target.rotation).add(target.position)] as [Vector3, Vector3];
    this.put = swing === null ? this.put ?? [this.chain.heel, this.contact, this.chain.toe].map(putAt) : null;
    if (!this.put) this.slipped = 0;
    // (swinging, each joint moves on from its history within the rig's own bounds on a joint's speed and acceleration: a foot in the
    // air never snaps to a solution the joints cannot reach in time)
    if (swing !== null) {
      const solved = solver.bones.map((b) => f.current.local(b).clone()), handed = minimumJerk((swing - BRAKING) / (1 - BRAKING));
      for (const [k, b] of solver.bones.entries()) {
        const snap = f.current.skeleton.bones[b].snap;
        if (!snap) continue;
        const bounds = { accel: BRAKE * snap.accel * DEG, speed: BRAKE * snap.speed * DEG };
        const braked = followRotation(f.prev2.local(b), f.prev.local(b), f.current.local(b), bounds, f.dt, _q);
        const limit = f.current.skeleton.limits[b];
        if (limit) clampRotation(braked, limit);
        // (landing, handed over to the solution over the swing's last stretch: the foot comes down where it is put)
        f.current.setLocal(b, braked.slerp(solved[k], handed));
      }
      // (but never into the floor: there the solution stands)
      if (this.sole.some((point) => this.below(f.current.point(terminal, point, _v)) > 0)) solver.bones.forEach((b, k) => f.current.setLocal(b, solved[k]));
    }
  }
}
/** Tuned: a planted foot's miss (m) and turn (rad) from how it is held; its contact's slide (m) from where it was put — pivoting in place
 * only, as the user decided (2026-10-20); the legs' touchdown speeds (m/s) */
const CONTACT = { distance: 1e-4, turn: 1e-4, slide: 0.01 }, TOUCHDOWN = { down: 0.1, along: 1 };
/** Tuned: a planted foot is turned from the body no further than this share of how far its leg twists, the rest pivoting on the floor */
const TWISTING = 0.8;
/** Tuned: a swinging leg's joints move within this share of the rig's bounds on their speed and acceleration */
const BRAKE = 0.8;
const DEG = Math.PI / 180;
/** Tuned: how far through its swing the braked joints start handing over to the solution, by its landing */
const BRAKING = 0.6;
type Table = { across: number[]; along: number[]; at(i: number, k: number): number };
/** a pure cache: the legs' reach tables, by their bones, ranges, pitch and standing — worked out once, never changed, shared by every
 * leg built so (each `horse(skeleton)` builds its own skeleton, so a table keyed by it would be sampled again for every body) */
const TABLES = new Map<string, Table>();
const UP = new Vector3(0, 1, 0);
/** Tuned: a leg is held this share of its length short of what its joints reach */
const SPARE = 0.04;
/**
 * Tuned: a leg's reach is sampled at `across` × `along` points, out from the body `out` × its standing length and ahead and behind
 * `ahead` × it; at each, how far down it reaches, to within `steps` halvings; a foot reached within `miss` (m) and `turn` (rad) of flat,
 * in at most `iterations` solver steps
 */
const DEPTH = { across: 37, along: 13, out: [-0.4, 0.5], ahead: 0.6, steps: 7, miss: 1e-3, turn: 0.02, iterations: 6 };
/** Tuned: the depths (× its standing length) a leg's reach is first looked for at, from the furthest */
const DOWN = [1.1, 1, 0.9, 0.75, 0.6, 0.4];
const _e = new Euler(), _q = new Quaternion(), _a = new Quaternion(), _v = new Vector3(), _p = new Vector3();
