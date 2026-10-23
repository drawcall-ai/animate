// A species' leg chains as the stepper's feet, and each leg posed over the foot the stepper places: its joints solved to it, each
// following its stride cycle (the carpus folding, the hock flexing) as a soft reference.
import { Euler, Quaternion, Vector3 } from 'three';
import type { Frame } from '../body';
import type { Pose, ReadonlyPose } from '../pose';
import { angleAt, type JointCycle } from './cycle';
import { offsetAt, strideAt, type Gait } from './gait';
import type { LegChain } from './legs';
import { Solver, type LegTarget } from './solve';
import { SINGULAR } from './cholesky';
import { GRAVITY, minimumJerk, wrapAngle } from '../math';
import { followRotation } from '../follow';
import { clampRotation } from '../limits';
import type { Feet, FootPose, Stepping } from './stepper';
import type { Spot } from './support';

/** A foot's turn: heading `yaw`, pitched `pitch` (rad, + toes up). */
const yawPitch = (yaw: number, pitch: number, out: Quaternion) => out.setFromEuler(_e.set(-pitch, yaw, 0, 'YXZ'));

/**
 * The stepper's feet for leg `chains` standing as in `rest` (the root at its standing height): each foot's terminal bone, its leg's top,
 * side and the leg across its girdle (the nearest on the other side), its home under it, the leg's length as it stands; planted, a foot rolls
 * about its heel or toe; its print is the sole between them.
 */
export function feetOf(chains: readonly LegChain[], rest: ReadonlyPose, depths?: readonly ((out: number, ahead: number, pitch?: number) => number)[]): Feet {
  const root = rest.position(0), turn = _q.copy(rest.rotation(0)).invert();
  const local = (bone: number) => rest.position(bone).clone().sub(root).applyQuaternion(turn);
  const legs = chains.map((chain) => {
    const top = chain.joints[0].bone, foot = chain.joints[chain.joints.length - 1].bone, at = local(top), home = local(foot);
    // (a leg reaches a little further than it stands, `STRAIGHTER`: further, it is past what its joints' ranges let it reach)
    const length = STRAIGHTER * at.distanceTo(home);
    const sign = (home.x >= 0 ? 1 : -1) as 1 | -1;
    return { sign, foot, toes: chain.toes?.bone, top, ahead: at.z, home: home.z, hip: Math.abs(at.x), up: at.y, length, out: sign * (home.x - at.x), stand: at.y - home.y };
  });
  const partnered = legs.map((leg, i) => ({ ...leg, partner: legs.reduce((best, other, j) => other.sign !== leg.sign && (best < 0 || Math.abs(other.ahead - leg.ahead) < Math.abs(legs[best].ahead - leg.ahead)) ? j : best, -1) }));
  const ankleHeight = -Math.min(chains[0].heel.y, chains[0].toe.y);
  const length = Math.min(...legs.map((leg) => leg.length));
  return {
    legs: partnered.map((leg, i) => ({ ...leg, partner: leg.partner < 0 ? undefined : leg.partner, depth: depths?.[i], stray: depths && strayOf(depths[i], leg.out, leg.home - leg.ahead, leg.stand), span: depths && ((drop: number) => spanOf(depths[i], leg.out, leg.home - leg.ahead, leg.stand - drop, Math.min(0, ...chains[i].rocker.map(([, pitch]) => pitch)) * Math.PI / 180)) })),
    hip: Math.max(...legs.map((leg) => leg.hip)), length, thigh: length / 2, shin: length / 2, ankleHeight,
    // (a hoof or paw has no knee of its own to fold under it, nor a shank to lean past an ankle's bend)
    fold: Math.PI,
    ankle(i, anchor, yaw, pitch, out) {
      // (rolled about its heel, or its toe, the contact kept where it is)
      const { heel, toe } = chains[i], pivot = pitch >= 0 ? heel : toe;
      return out.copy(pivot).applyQuaternion(yawPitch(yaw, 0, _a)).add(anchor).sub(_v.copy(pivot).applyQuaternion(yawPitch(yaw, pitch, _b)));
    },
    rotation: (yaw, pitch, out) => yawPitch(yaw, pitch, out),
    sole(i, ankle, foot) {
      const { heel, toe } = chains[i];
      return ankle.y + Math.min(_v.copy(heel).applyQuaternion(foot).y, _v.copy(toe).applyQuaternion(foot).y);
    },
    lean: () => 0,
    turnAbout(i, anchor, from, to, pitch) {
      // (about the end of the sole it stands on: its middle flat, its toe rolled over it, its heel rolled back onto it)
      const { heel, toe } = chains[i], middle = (pitch < 0 ? _v.copy(toe) : pitch > 0 ? _v.copy(heel) : _v.copy(heel).add(toe).multiplyScalar(0.5)).setY(0);
      const contact = _w.copy(middle).applyQuaternion(yawPitch(from, 0, _a)).add(anchor);
      anchor.copy(contact).sub(middle.applyQuaternion(yawPitch(to, 0, _b)));
    },
    print(i, anchor, yaw): Spot[] {
      const { heel, toe } = chains[i], half = 0.4 * Math.abs(toe.z - heel.z), turn = yawPitch(yaw, 0, _a);
      return [heel, toe].flatMap((end) => [-half, half].map((x): Spot => {
        const at = _v.set(end.x + x, 0, end.z).applyQuaternion(turn).add(anchor);
        return [at.x, at.z];
      }));
    },
  };
}

/**
 * How far a planted foot may stray across from where it stands under its top (m) while its leg still holds the top at its standing
 * height (`stand` below it), its joints' ranges as they allow (`depth`): of the two ways, the nearer, `STRAYING` of it.
 */
function strayOf(depth: (out: number, ahead: number, pitch?: number) => number, out: number, ahead: number, stand: number): number {
  const step = 0.005, most = 0.5;
  const reach = (way: number) => { let d = 0; while (d < most && depth(out + way * (d + step), ahead) >= stand) d += step; return d; };
  return STRAYING * Math.min(reach(1), reach(-1));
}

/** How far fore and aft together a planted foot reaches from under its top (m) while its leg holds the top `stand` above it, behind rolled as far as `ball` (rad). */
function spanOf(depth: (out: number, ahead: number, pitch?: number) => number, out: number, ahead: number, stand: number, ball: number): number {
  const step = 0.005, most = 2;
  const reach = (way: number, pitch: number) => { let d = 0; while (d < most && depth(out, ahead + way * (d + step), pitch) >= stand) d += step; return d; };
  // (behind, rolled over its toe as far as it breaks over)
  return reach(1, 0) + Math.max(reach(-1, 0), reach(-1, ball));
}

/**
 * A four-legged species' stepping, from its gait and feet: the gait's offsets, cadence and duty; a stance travelling at most
 * `SPANNING` of how far its legs reach fore and aft (else `TRAVEL` of the leg's length) let down on them as the gait has it (`drop`) —
 * running (the gait's `run`), let down further and reaching as far as they reach so; feet landing a little ahead (`LEAD` of the stance), as wide apart as they stand; a swing lifting
 * `LIFT` × the gait's clearance at its height; the legs reaching `REACH` of their length; a foot landing turned from the body no
 * further than `twist` (rad: as far as its legs stand turned, `ChainLeg.turn`, else `TWIST`), the body turning on over a planted one
 * as its foot pivots; behind, rolling over its toe as far as `ball` (rad, − toes down: its rocker's breakover) as the leg needs. No heel
 * strike or crouch: a hoof or paw lands flat.
 */
export function steppingOf(gait: Gait, feet: Feet, twist = TWIST, ball = 0): Stepping {
  const scale = 1, width = feet.hip, length = feet.length, clearance = Math.max(...gait.clearance);
  const run = gait.run, lowered = (gait.drop ?? 0) * length, drop = lowered + (run?.drop ?? 0) * length, speedAt = (froude: number) => Math.sqrt(froude * GRAVITY * gait.height);
  const spans = feet.legs.map((leg) => leg.span), travelAt = (drop: number) => spans.every((span) => span !== undefined) ? SPANNING * Math.min(...spans.map((span) => span?.(drop) ?? Infinity)) : TRAVEL * length;
  const travel = travelAt(lowered);
  return {
    scale, offsets: gait.contacts.map((_, i) => offsetAt(gait, 0, i)), toeOut: 0, cadence: { base: 1, perSpeed: 0 }, duty: { walk: 0.6, side: 0.6, run: 0.6 },
    run: run ? [speedAt(run.froude[0]), speedAt(run.froude[1])] : [NEVER, 2 * NEVER], travel: { forward: travel, run: run ? travelAt(drop) : travel, back: travel / 2, side: travel / 3 },
    lead: { share: LEAD, side: LEAD, most: length, run: length }, width: { stand: width, walk: width, run: width, narrowest: width },
    bob: 0, drop: { walk: lowered, side: lowered, run: drop }, lift: { walk: LIFT * clearance, run: LIFT * clearance, jump: LIFT * clearance }, arc: ARC,
    strike: { walk: 0, run: 0, ahead: 1 }, pitch: { heel: 0, ball }, dorsiflexion: Math.PI,
    crouch: { depth: 0, wider: 0, ahead: 0, travel: 0, lift: 0 }, reach: REACH, swingReach: SWING_REACH, clearance, gait, twist,
  };
}

/** Tuned: a stance travels at most this share of the leg's length; a foot lands this share of a stance ahead; a swing lifts this × the clearance; a leg reaches this share of its length */
const TRAVEL = 0.5, LEAD = 0.55, LIFT = 2.5, REACH = 0.99;
/** Tuned: a stance travels at most this share of how far its legs reach fore and aft, walking: the rest is the landing's spare */
const SPANNING = 0.65;
/** Tuned: a planted foot strays across at most this share of how far its leg reaches either way at its standing height */
const STRAYING = 0.6;
/** [D from recalled] a hoof or paw lifts early, peaking ~30% into its swing, and comes down long: u^ARC (1 − u)³ */
const ARC = 1.3;
/** Tuned: a swinging foot is not drawn in toward its top short of this share of its leg (its joints bound it) */
const SWING_REACH = 1.2;
/** Tuned: a leg reaches this much further than it stands */
const STRAIGHTER = 1.04;
/** Tuned: the share of a swing over which the stride's references take over from the leg as it lifted */
const TAKING = 0.3;
/** Tuned: a four-legged body turns at most this far (rad) from a planted foot, the foot pivoting on the floor for what its leg does not twist */
const TWIST = 0.5;
/** a speed (m/s) no creature runs at: it never runs as a person does (its gait has its own) */
const NEVER = 1e3;

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
  private held: { position: Vector3; rotation: Quaternion } | null = null;
  private landed = false;
  /** where its planted foot's heel, contact and toe were last sub-step, while it stands, and how far it has slipped since it landed */
  private put: [Vector3, Vector3][] | null = null;
  private slipped = 0;
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
    const low = Math.min(...this.sole.map((point) => f.prev.point(terminal, point, _v).y));
    if (low < -CONTACT.distance) dev.append(time, { check: 'leg ground (m)', value: -low, limit: CONTACT.distance, where });
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
    const slide = this.slipped;
    if (slide > CONTACT.slide) dev.append(time, { check: 'leg contact slide (m)', value: slide, limit: CONTACT.slide, where });
    if (!this.landed) return;
    const velocity = _v.subVectors(f.prev.position(terminal), f.prev2.position(terminal)).divideScalar(f.dt);
    if (Math.abs(velocity.y) > TOUCHDOWN.down) dev.append(time, { check: 'leg touchdown vertical speed (m/s)', value: Math.abs(velocity.y), limit: TOUCHDOWN.down, where });
    if (Math.hypot(velocity.x, velocity.z) > TOUCHDOWN.along) dev.append(time, { check: 'leg touchdown horizontal speed (m/s)', value: Math.hypot(velocity.x, velocity.z), limit: TOUCHDOWN.along, where });
  }

  /** the joints as the foot lifted, while it swings */
  private lifting: Float64Array | null = null;
  private readonly target: LegTarget = { swing: null, position: new Vector3(), rotation: new Quaternion(), above: [] };

  private readonly sign: number;
  private readonly length: number;
  private readonly skeleton: object;
  private readonly restPose: ReadonlyPose;

  constructor(private readonly chain: LegChain, start: ReadonlyPose) {
    const top = chain.joints[0].bone, terminal = chain.joints[chain.joints.length - 1].bone;
    this.sign = start.position(terminal).x - start.position(0).x >= 0 ? 1 : -1;
    this.length = start.position(top).distanceTo(start.position(terminal));
    this.skeleton = start.skeleton;
    this.restPose = start;
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
  private flat: Table | null = null;
  private rolled: Table | null = null;

  /** its table at `pitch`: sampled once for every body of its skeleton standing as it does */
  private tableAt(pitch: number): Table {
    const skeleton = this.skeleton, tables = TABLES.get(skeleton) ?? new Map<string, Table>();
    TABLES.set(skeleton, tables);
    const key = `${this.solver.bones.join(',')}|${pitch}|${Array.from(this.rest).join(',')}`;
    let table = tables.get(key);
    if (!table) tables.set(key, table = this.sample(pitch));
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
    const [u, w] = [x - i, z - k], at = (a: number, b: number) => t.at(a, b);
    if (!(at(i, k) > -Infinity && at(i, k + 1) > -Infinity && at(i + 1, k) > -Infinity && at(i + 1, k + 1) > -Infinity)) return -Infinity;
    // (kept `SPARE` short of it: a leg at the very edge of its ranges has no give for the rest of the body's motion)
    return (at(i, k) * (1 - w) + at(i, k + 1) * w) * (1 - u) + (at(i + 1, k) * (1 - w) + at(i + 1, k + 1) * w) * u - SPARE * this.length;
  }

  /** its table at `pitch`, each point solved the first time it is read (its own solver: the leg's posing one keeps its references) */
  private sample(pitch: number): Table {
    const length = this.length, target: LegTarget = { swing: null, position: new Vector3(), rotation: new Quaternion(), above: [] };
    const solver = new Solver(this.restPose.skeleton, this.chain.joints);
    solver.q.set(this.rest);
    for (let j = 0; j < solver.n; j++) solver.setRef(j, this.rest[j]);
    const across = Array.from({ length: DEPTH.across }, (_, i) => length * (DEPTH.out[0] + (DEPTH.out[1] - DEPTH.out[0]) * i / (DEPTH.across - 1)));
    const along = Array.from({ length: DEPTH.along }, (_, k) => length * DEPTH.ahead * (2 * k / (DEPTH.along - 1) - 1));
    const q = new Float64Array(solver.n), values = new Float64Array(DEPTH.across * DEPTH.along).fill(NaN);
    yawPitch(0, pitch, target.rotation);
    // (no further than its bones laid end to end: there it is not worth solving)
    const most = this.chain.joints.reduce((sum, { bone }, j, joints) => j ? sum + this.restPose.position(bone).distanceTo(this.restPose.position(joints[j - 1].bone)) : 0, 0);
    const sign = this.sign, kept = Float64Array.from(this.rest);
    const reaches = (out: number, ahead: number, down: number) => {
      if (Math.hypot(out, down, ahead) > most) return false;
      target.position.set(sign * out, -down, ahead);
      // (a leg pulled straight is singular: there it reaches no further)
      try { return solver.reach(IDENTITY, ZERO, target, q, undefined, DEPTH.iterations) < DEPTH.miss && solver.rotationError < DEPTH.turn; } catch (cause) {
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
    if (swing !== null && this.lifting === null) {
      this.lifting = Float64Array.from(solver.q);
    }
    if (swing === null) this.lifting = null;
    const taken = swing === null ? 1 : minimumJerk(swing / TAKING);
    for (let j = 0; j < solver.n; j++) {
      const c = cycles[j], ref = (c ? angleAt(c, u, stride.duty, blend) * stepping : 0) + rest[j] * (1 - stepping);
      solver.setRef(j, this.lifting ? this.lifting[j] + (ref - this.lifting[j]) * taken : ref, 1 + ((c?.alternateWeight ?? 1) - 1) * blend);
    }
    target.swing = swing;
    target.above = this.sole;
    target.position.copy(foot.ankle);
    // (a planted foot pivots on the floor about its contact as the body turns over it, heading the body's way — where its leg's reach
    // is known — and never slides: its contact stays where it is put)
    // (about the end of the sole it stands on: its middle flat, its toe rolled over it, its heel rolled back onto it)
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
    const missed = solver.solve(f.current, target, solver.q, false);
    if (missed > CONTACT.distance && swing === null) solver.solve(f.current, target, solver.q, true);
    this.landed = this.held === null && swing === null && this.posed;
    this.posed = true;
    this.held = swing === null ? { position: target.position.clone(), rotation: target.rotation.clone() } : null;
    this.put = swing === null ? this.put ?? [this.chain.heel, this.contact, this.chain.toe].map((point) => [point, point.clone().applyQuaternion(target.rotation).add(target.position)] as [Vector3, Vector3]) : null;
    if (!this.put) this.slipped = 0;
    // (swinging, each joint moves on from its history within the rig's own bounds on a joint's speed and acceleration: a foot in the
    // air never snaps to a solution the joints cannot reach in time)
    if (swing !== null) {
      const solved = solver.bones.map((b) => f.current.local(b).clone()), handed = minimumJerk((swing - BRAKING) / (1 - BRAKING));
      for (const [k, b] of solver.bones.entries()) {
        const snap = f.current.skeleton.bones[b].snap;
        if (!snap) continue;
        const braked = followRotation(f.prev2.local(b), f.prev.local(b), f.current.local(b), { accel: BRAKE * snap.accel * DEG, speed: BRAKE * snap.speed * DEG }, f.dt, _q), limit = f.current.skeleton.limits[b];
        if (limit) clampRotation(braked, limit);
        // (landing, handed over to the solution over the swing's last stretch: the foot comes down where it is put)
        f.current.setLocal(b, braked.slerp(solved[k], handed));
      }
      // (but never into the floor: there the solution stands)
      if (Math.min(...this.sole.map((point) => f.current.point(terminal, point, _v).y)) < 0) solver.bones.forEach((b, k) => f.current.setLocal(b, solved[k]));
    }

  }
}

/** Tuned: a planted foot's miss (m) and turn (rad) from how it is held; its contact's slide (m) from where it was put — pivoting in place
 * only, as the user decided (2026-10-20); [derived] the legs' touchdown speeds (m/s), as the old legs bounded them */
const CONTACT = { distance: 1e-4, turn: 1e-4, slide: 0.01 }, TOUCHDOWN = { down: 0.1, along: 1 };
/** Tuned: a planted foot is turned from the body no further than this share of how far its leg twists, the rest pivoting on the floor */
const TWISTING = 0.8;
/** Tuned: a swinging leg's joints move within this share of the rig's bounds on their speed and acceleration */
const BRAKE = 0.8;
const DEG = Math.PI / 180;
/** Tuned: how far through its swing the braked joints start handing over to the solution, by its landing */
const BRAKING = 0.6;
type Table = { across: number[]; along: number[]; at(i: number, k: number): number };
/** a pure cache: each skeleton's legs' reach tables, by chain, pitch and standing — worked out once from its rest pose and ranges, never
 * changed, shared by every body of that skeleton */
const TABLES = new WeakMap<object, Map<string, Table>>();
const UP = new Vector3(0, 1, 0), ZERO = new Vector3(), IDENTITY = new Quaternion();
/**
 * Tuned: a leg's reach is sampled at `across` × `along` points, out from the body `out` × its standing length and ahead and behind
 * `ahead` × it; at each, how far down it reaches, between `down` × it, to within `steps` halvings; a foot reached within `miss` (m) and
 * `turn` (rad) of flat
 */
/** Tuned: a leg is held this share of its length short of what its joints reach */
const SPARE = 0.04;
const DEPTH = { across: 37, along: 13, out: [-0.4, 0.5], ahead: 0.6, steps: 7, miss: 1e-3, turn: 0.02, iterations: 6 };
/** Tuned: the depths (× its standing length) a leg's reach is first looked for at, from the furthest */
const DOWN = [1.1, 1, 0.9, 0.75, 0.6, 0.4];
const _e = new Euler(), _q = new Quaternion(), _a = new Quaternion(), _b = new Quaternion(), _v = new Vector3(), _p = new Vector3(), _w = new Vector3();
