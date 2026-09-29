import { Quaternion, Vector3 } from 'three';
import type { BodyDimensions } from './body';
import { LevenbergMarquardt } from './lm';
import { clamp, forwardOf, leftOf, lerp, quatYXZ, wrapAngle, yawOf } from './math';

/**
 * Torso posture parameters. The same vector is used by the "planner" (where
 * should I stand?) and the "posture" solve (how do I hold my trunk given
 * where I stand?).
 */
export const P = {
  X: 0, // support centre (between the feet), world x
  Z: 1, // support centre, world z
  YAW: 2, // facing yaw
  DROP: 3, // pelvis drop below standing hip height (m) → knee/hip flexion
  SHIFT: 4, // pelvis fore/aft shift relative to the support centre (m)
  HIP: 5, // trunk flexion at the hip joints (rad, + forward)
  SPINE: 6, // additional lumbar/thoracic flexion (rad)
  ROLL: 7, // lateral trunk bend (rad, + raises left side)
  TWIST: 8, // axial trunk rotation, chest vs pelvis (rad, + = chest turns left)
  SIDE: 9, // pelvis lateral shift (m, + = left)
} as const;
export const NP = 10;

export interface Stance {
  /** half distance between the ankles, sideways (m) */
  width: number;
  /** left foot forward (+) / back (−) relative to the right foot (m) */
  stagger: number;
  /** preferred pelvis drop (m) — bent-knee ready stance */
  crouch: number;
  /** pelvis/feet yaw relative to facing direction (rad), e.g. bladed fighting stance */
  turn: number;
  /** toe-out per foot (rad) */
  toeOut: number;
  /** keep idle hands up in a guard near the chin */
  guard: boolean;
}

export const defaultStance = (d: BodyDimensions): Stance => ({
  width: 0.058 * d.height,
  stagger: 0,
  crouch: 0,
  turn: 0,
  toeOut: 0.12,
  guard: false,
});

export interface Task {
  pos: Vector3;
  weight: number;
}
/** axis-aligned floor rectangle to keep the feet out of; with a `height` below ~0.4 m it can be stepped over */
export interface Obstacle {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height?: number;
}

/** a volume the trunk and head must stay clear of (a held box, a table edge, another body) */
export interface AvoidSphere {
  center: Vector3;
  radius: number;
}

export interface OrientedTask {
  pos: Vector3 | null;
  rot: Quaternion | null;
  weight: number;
}

export interface PostureTasks {
  hands: [Task | null, Task | null]; // [left, right]
  head: Task | null;
  torso: OrientedTask | null;
  pelvis: OrientedTask | null;
  /** kicking / lifted feet [left, right] */
  feet: [Task | null, Task | null];
  /** gaze target: people turn to face what they attend to */
  look: Vector3 | null;
  /** requested head yaw; the body follows once it exceeds comfortable neck rotation */
  headYaw: number | null;
  /** keep-out areas on the floor (the planner won't stand inside them) */
  obstacles: Obstacle[];
  /** preferred standing spot (x, z of the support centre) and optional facing */
  stand: (Task & { yaw: number | null }) | null;
  /** requested head orientation (VR); used to place the head consistently with the final neck */
  headRot: Quaternion | null;
  /** volumes the trunk/head stay out of */
  avoid: AvoidSphere[];
  /** where the hip joints rest when seated; `weight` = how far down (0 standing, 1 seated) */
  seat: Task | null;
}

export interface TorsoFrame {
  pelvis: Vector3;
  qPelvis: Quaternion;
  spine: Vector3;
  qSpine: Quaternion;
  chest: Vector3;
  qChest: Quaternion;
  neck: Vector3;
  shoulders: [Vector3, Vector3];
  hips: [Vector3, Vector3];
  headCenter: Vector3;
  com: Vector3;
}

export const createTorsoFrame = (): TorsoFrame => ({
  pelvis: new Vector3(),
  qPelvis: new Quaternion(),
  spine: new Vector3(),
  qSpine: new Quaternion(),
  chest: new Vector3(),
  qChest: new Quaternion(),
  neck: new Vector3(),
  shoulders: [new Vector3(), new Vector3()],
  hips: [new Vector3(), new Vector3()],
  headCenter: new Vector3(),
  com: new Vector3(),
});

/** Extra, non-optimised offsets layered on top (gait oscillations). */
export interface TorsoOverlay {
  pelvisYaw: number;
  pelvisRoll: number;
  chestYaw: number;
  /** vertical pelvis offset (bob, walking height) */
  lift: number;
  /** lateral pelvis sway (m, + = left) */
  side: number;
  /** extra trunk flexion (walking / acceleration lean) */
  lean: number;
  /** extra lateral trunk bend (inertia, impacts) */
  chestRoll: number;
}
export const zeroOverlay = (): TorsoOverlay => ({ pelvisYaw: 0, pelvisRoll: 0, chestYaw: 0, lift: 0, side: 0, lean: 0, chestRoll: 0 });

const _q = new Quaternion();
const _v = new Vector3();
const _f = new Vector3();
const _l = new Vector3();
const _c = new Vector3();
const ZERO_OVERLAY = zeroOverlay();

const _hq = new Quaternion();
const _hv = new Vector3();
/**
 * Neck/head chain shared by the optimiser and the final pose: the lower neck
 * takes ~40% of the head's rotation relative to the chest.
 */
export function headFrom(
  d: BodyDimensions,
  neck: Vector3,
  qChest: Quaternion,
  qHead: Quaternion,
  outBase: Vector3,
  outCenter: Vector3,
) {
  const rel = _hq.copy(qChest).invert().multiply(qHead);
  const f = _hv.set(0, 0, 1).applyQuaternion(rel);
  const yaw = Math.atan2(f.x, f.z);
  const pitch = Math.atan2(-f.y, Math.hypot(f.x, f.z));
  quatYXZ(yaw * 0.4, pitch * 0.4, 0, _hq).premultiply(qChest);
  outBase.set(0, d.neckToHeadBase, 0).applyQuaternion(_hq).add(neck);
  outCenter.set(...d.head.center).applyQuaternion(qHead).add(outBase);
}

export function torsoFK(
  p: Float64Array,
  d: BodyDimensions,
  stance: Stance,
  out: TorsoFrame,
  ov = ZERO_OVERLAY,
  qHead: Quaternion | null = null,
) {
  const yaw = p[P.YAW] + stance.turn;
  forwardOf(yaw, _f);
  leftOf(yaw, _l);
  out.pelvis
    .set(p[P.X], d.hipHeight - p[P.DROP] + ov.lift, p[P.Z])
    .addScaledVector(_f, p[P.SHIFT])
    .addScaledVector(_l, p[P.SIDE] + ov.side);

  const hip = p[P.HIP] + ov.lean;
  const spine = p[P.SPINE];
  const roll = p[P.ROLL];
  const twist = p[P.TWIST];

  quatYXZ(yaw + ov.pelvisYaw, hip, roll * 0.25 + ov.pelvisRoll, out.qPelvis);
  // hip joints lie on the flexion axis, so pitch does not move them
  quatYXZ(yaw + ov.pelvisYaw, 0, roll * 0.25 + ov.pelvisRoll, _q);
  for (let s = 0; s < 2; s++) {
    const side = s === 0 ? 1 : -1;
    out.hips[s].set(side * d.hipHalfWidth, 0, 0).applyQuaternion(_q).add(out.pelvis);
  }

  quatYXZ(twist * 0.4 - ov.chestYaw * 0.3, spine * 0.45, roll * 0.35, _q);
  out.qSpine.copy(out.qPelvis).multiply(_q);
  out.spine.set(0, d.pelvisToSpine, -0.005 * d.height).applyQuaternion(out.qPelvis).add(out.pelvis);

  quatYXZ(twist * 0.6 - ov.chestYaw * 0.7, spine * 0.55, roll * 0.4 + ov.chestRoll, _q);
  out.qChest.copy(out.qSpine).multiply(_q);
  out.chest.set(0, d.spineToChest, 0).applyQuaternion(out.qSpine).add(out.spine);
  out.neck.set(0, d.chestToNeck, 0.004 * d.height).applyQuaternion(out.qChest).add(out.chest);

  for (let s = 0; s < 2; s++) {
    const side = s === 0 ? 1 : -1;
    out.shoulders[s].set(side * d.shoulderHalfWidth, -d.shoulderDrop, -0.008 * d.height).applyQuaternion(out.qChest).add(out.neck);
  }
  headFrom(d, out.neck, out.qChest, qHead ?? out.qChest, _v, out.headCenter);
}

/** Home ankle positions (flat foot) for a support centre + facing. */
export function stanceFeet(
  x: number,
  z: number,
  yaw: number,
  d: BodyDimensions,
  stance: Stance,
  out: [Vector3, Vector3],
) {
  forwardOf(yaw, _f);
  leftOf(yaw, _l);
  for (let s = 0; s < 2; s++) {
    const side = s === 0 ? 1 : -1;
    out[s]
      .set(x, d.ankleHeight, z)
      .addScaledVector(_l, side * stance.width)
      .addScaledVector(_f, side * stance.stagger * 0.5);
  }
}

export interface SolveEnv {
  mode: 'planner' | 'posture';
  /** planner only: evaluate standing where we are (support position + facing fixed) */
  fixRoot?: boolean;
  /** gait oscillations the posture must live with (tracked targets compensate for them) */
  overlay?: TorsoOverlay;
  /** current root (support centre + facing) */
  root: { x: number; z: number; yaw: number };
  /** actual feet ankles used as support in posture mode */
  support: [Vector3 | null, Vector3 | null];
  /** where the feet are (or are landing) right now, always given in posture mode */
  footholds?: [Vector3, Vector3];
  /** 0 when standing, 1 when walking at speed (balance is dynamic then) */
  moving: number;
  /** a step is under way (or about to be): no bending or leaning mid-stride */
  stepping?: boolean;
  /** how strongly hands want to be reached (per side) */
  tasks: PostureTasks;
  stance: Stance;
}

const LOWER = new Float64Array(NP);
const UPPER = new Float64Array(NP);

export class PostureSolver {
  private lm = new LevenbergMarquardt(NP);
  private fk = createTorsoFrame();
  private feet: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  private active = new Uint8Array(NP);
  private env!: SolveEnv;

  constructor(private d: BodyDimensions) {}

  solve(p: Float64Array, env: SolveEnv, iterations = 8): number {
    const d = this.d;
    const t = env.tasks;
    this.env = env;
    LOWER.set([-1e9, -1e9, -1e9, -0.04 * d.height, -0.3, -0.35, -0.45, -0.5, -0.9, -0.1]);
    UPPER.set([1e9, 1e9, 1e9, 0.62 * d.hipHeight, 0.1, 1.75, 0.8, 0.5, 0.9, 0.1]);
    this.active.fill(1);
    if (env.mode === 'posture') {
      this.active[P.X] = 0;
      this.active[P.Z] = 0;
      p[P.X] = env.root.x;
      p[P.Z] = env.root.z;
      // tiptoe only when standing still; no deep squats or dives mid-stride
      LOWER[P.DROP] *= 1 - smoothstep01(env.moving / 0.2);
      // a tracked head stays level: the body may cancel its own gait bob
      if (t.head && env.overlay) LOWER[P.DROP] = Math.min(LOWER[P.DROP], env.overlay.lift);
      // (a tracked head/torso/pelvis overrides: the body must go where it's measured)
      const tracked = t.head || t.torso || t.pelvis || t.seat;
      const walking = tracked ? 0 : Math.max(env.stepping ? 1 : 0, smoothstep01((env.moving - 0.02) / 0.15));
      UPPER[P.DROP] = lerp(UPPER[P.DROP], 0.035 * d.height, walking);
      UPPER[P.HIP] = lerp(UPPER[P.HIP], 0.18, walking);
      UPPER[P.SPINE] = lerp(UPPER[P.SPINE], 0.08, walking);
      LOWER[P.ROLL] = lerp(LOWER[P.ROLL], -0.12, walking);
      UPPER[P.ROLL] = lerp(UPPER[P.ROLL], 0.12, walking);
      LOWER[P.TWIST] = lerp(LOWER[P.TWIST], -0.6, walking);
      UPPER[P.TWIST] = lerp(UPPER[P.TWIST], 0.6, walking);
      // the pelvis can only rotate so far over planted feet; the chest twists the rest
      LOWER[P.YAW] = env.root.yaw - 0.4;
      UPPER[P.YAW] = env.root.yaw + 0.4;
      // while walking the pelvis stays over the moving support (unless tracked)
      const k = 1 - (t.head || t.pelvis || t.torso ? 0.2 : 0.8) * env.moving;
      LOWER[P.SHIFT] *= k;
      UPPER[P.SHIFT] *= k;
      LOWER[P.SIDE] *= k;
      UPPER[P.SIDE] *= k;
      // seated, the pelvis rests well behind the feet
      if (t.seat) LOWER[P.SHIFT] = lerp(LOWER[P.SHIFT], -0.5 * (d.height / 1.75), t.seat.weight);
    } else {
      if (env.fixRoot) {
        this.active[P.X] = this.active[P.Z] = this.active[P.YAW] = 0;
        p[P.X] = env.root.x;
        p[P.Z] = env.root.z;
        p[P.YAW] = env.root.yaw;
      }
      // the planner decides where the feet go; pelvis offsets are the posture solve's job
      this.active[P.SHIFT] = 0;
      this.active[P.SIDE] = 0;
      p[P.SHIFT] = 0;
      p[P.SIDE] = 0;
    }
    p[P.YAW] = env.root.yaw + wrapAngle(p[P.YAW] - env.root.yaw);
    for (let i = 0; i < NP; i++) p[i] = clamp(p[i], LOWER[i], UPPER[i]);
    return this.lm.solve(p, this.residuals, { iterations, lower: LOWER, upper: UPPER, active: this.active });
  }

  private residuals = (p: Float64Array, r: Float64Array): number => {
    const { d, env, fk, feet } = this;
    const planner = env.mode === 'planner';
    const t = env.tasks;
    torsoFK(p, d, env.stance, fk, env.overlay, t.headRot);
    let n = 0;

    // ---- support feet
    stanceFeet(p[P.X], p[P.Z], p[P.YAW], d, env.stance, feet);
    const sup: (Vector3 | null)[] = [feet[0], feet[1]];
    if (!planner) {
      for (let s = 0; s < 2; s++) if (env.support[s]) sup[s] = env.support[s];
    }
    for (let s = 0; s < 2; s++) if (t.feet[s] && t.feet[s]!.weight > 0.5) sup[s] = null;

    // ---- hands
    const L = d.armLength;
    const fwd = forwardOf(p[P.YAW], _f);
    let midX = 0,
      midZ = 0,
      midW = 0;
    for (let s = 0; s < 2; s++) {
      const h = t.hands[s];
      if (!h || h.weight <= 0) continue;
      const dist = h.pos.distanceTo(fk.shoulders[s]);
      r[n++] = 14 * h.weight * Math.max(0, dist - 0.96 * L);
      // reach with the body (trunk turn / lean) rather than a locked arm
      const overhead = smoothstep01((h.pos.y - fk.shoulders[s].y - 0.1) / 0.25);
      r[n++] = (planner ? 4 : 2.6 * (1 - 0.8 * overhead)) * h.weight * Math.max(0, dist - 0.72 * L);
      // hands work in front of the body, not inside it
      _v.subVectors(h.pos, fk.chest);
      const ahead = _v.dot(fwd);
      const lateral = Math.abs(_v.dot(leftOf(p[P.YAW] + env.stance.turn, _l)));
      const inTrunkBand = h.pos.y > fk.pelvis.y - 0.15 && h.pos.y < fk.neck.y + 0.1;
      if (inTrunkBand && lateral < d.shoulderHalfWidth * 1.3) r[n++] = 6 * h.weight * Math.max(0, 0.16 - ahead);
      if (planner) {
        // objects are handled in front of the feet; low ones further out (room for the knees)
        const fromFeet = (h.pos.x - p[P.X]) * fwd.x + (h.pos.z - p[P.Z]) * fwd.z;
        const low = 1 - smoothstep01((h.pos.y - 0.3 * d.height) / (0.3 * d.height));
        r[n++] = 5 * h.weight * Math.max(0, 0.2 + 0.22 * low - fromFeet);
      }
      // extended reaches turn the chest toward the target (punches rotate the trunk)
      // (only for reaches well out in front: not overhead, not close to the body)
      if (!planner) {
        const dx = h.pos.x - fk.chest.x;
        const dz = h.pos.z - fk.chest.z;
        const out = smoothstep01((Math.hypot(dx, dz) - 0.35) / 0.25);
        const up = smoothstep01((h.pos.y - fk.shoulders[s].y - 0.1) / 0.25);
        const ext = smoothstep01((dist / L - 0.65) / 0.3) * out * (1 - up);
        if (ext > 0) {
          const chestYaw = p[P.YAW] + env.stance.turn + p[P.TWIST];
          r[n++] = 3 * h.weight * ext * wrapAngle(chestYaw - yawOf(dx, dz));
        }
      }
      midX += h.pos.x * h.weight;
      midZ += h.pos.z * h.weight;
      midW += h.weight;
    }
    if (planner && midW > 0) {
      const dx = midX / midW - p[P.X];
      const dz = midZ / midW - p[P.Z];
      const hd = Math.hypot(dx, dz);
      // (a tracked head decides facing; hands only nudge it)
      if (hd > 0.25) r[n++] = (t.headYaw !== null ? 0.5 : 1.5) * Math.min(1, midW) * smoothRamp(hd, 0.25, 0.5) * wrapAngle(p[P.YAW] - yawOf(dx, dz));
    }

    if (planner && t.look) {
      const dx = t.look.x - p[P.X];
      const dz = t.look.z - p[P.Z];
      if (Math.hypot(dx, dz) > 0.5) r[n++] = 2 * wrapAngle(p[P.YAW] - yawOf(dx, dz));
    }

    if (t.headYaw !== null) {
      const e = wrapAngle(p[P.YAW] + p[P.TWIST] * 0.8 - t.headYaw);
      const dead = planner ? 0.7 : 0.5;
      r[n++] = (planner ? 3 : 2.5) * Math.sign(e) * Math.max(0, Math.abs(e) - dead);
    }

    // ---- head / torso / pelvis targets
    if (t.head && t.head.weight > 0) {
      const w = 25 * t.head.weight;
      r[n++] = w * (fk.headCenter.x - t.head.pos.x);
      r[n++] = w * (fk.headCenter.y - t.head.pos.y);
      r[n++] = w * (fk.headCenter.z - t.head.pos.z);
    }
    n = orientedResiduals(t.torso, fk.chest, fk.qChest, r, n);
    n = orientedResiduals(t.pelvis, fk.pelvis, fk.qPelvis, r, n);
    // seat: the chair carries the pelvis, so balance and leg effort fade out as it takes
    // the weight — sitting down leans the trunk forward over the feet on the way, by itself
    const sit = !planner && t.seat ? t.seat.weight : 0;
    if (sit > 0) {
      const w = 30 * sit;
      r[n++] = w * (fk.pelvis.x - t.seat!.pos.x);
      r[n++] = w * (fk.pelvis.y - t.seat!.pos.y);
      r[n++] = w * (fk.pelvis.z - t.seat!.pos.z);
    }

    // ---- lifted / kicking feet: reachable, and the trunk leans away to balance the leg
    let kick = 0;
    for (let s = 0; s < 2; s++) {
      const ft = t.feet[s];
      if (!ft || ft.weight <= 0) continue;
      const dist = ft.pos.distanceTo(fk.hips[s]);
      r[n++] = 10 * ft.weight * Math.max(0, dist - 0.97 * d.legLength);
      const dx = ft.pos.x - fk.hips[s].x;
      const dz = ft.pos.z - fk.hips[s].z;
      const hl = Math.hypot(dx, dz);
      const raise = smoothstep01((ft.pos.y - 0.3 * d.height) / (0.25 * d.height));
      if (hl > 0.05 && raise > 0) {
        const fx = forwardOf(p[P.YAW] + env.stance.turn, _c);
        const along = (dx * fx.x + dz * fx.z) / hl;
        const lat = (dx * fx.z - dz * fx.x) / hl; // + = toward the character's left
        const w = ft.weight * raise;
        r[n++] = 7 * w * (p[P.HIP] + p[P.SPINE] * 0.5 + 0.4 * along);
        // roll + tilts the trunk to the right: lean away from the kicking side
        r[n++] = 7 * w * (p[P.ROLL] - 0.8 * lat);
        kick = Math.max(kick, w);
      }
    }

    // ---- comfort (effort) terms; the planner prefers stepping over leaning
    // leaning is costlier while walking: you don't dive toward things mid-stride
    const lean = planner ? 2.2 : 1 + (t.head ? 0.3 : 2.5) * env.moving;
    r[n++] = 1.1 * lean * p[P.HIP];
    r[n++] = 1.5 * lean * p[P.SPINE];
    r[n++] = 2.5 * p[P.ROLL];
    r[n++] = (planner ? 3 : 1.3) * p[P.TWIST];
    r[n++] = 0.8 * (1 - 0.9 * sit) * (p[P.DROP] - env.stance.crouch);
    // rising onto the toes is effortful (only for out-of-reach overhead targets)
    r[n++] = 6 * Math.min(0, p[P.DROP]);
    r[n++] = 4 * (1 - sit) * p[P.SHIFT];
    r[n++] = 6 * p[P.SIDE];
    // extending the trunk backward is effortful and rare
    r[n++] = 6 * (1 - kick) * Math.min(0, p[P.HIP] + 0.08);
    r[n++] = 6 * Math.min(0, p[P.SPINE] + 0.05);
    // back load grows steeply past ~45° of trunk flexion: bend the knees instead
    r[n++] = 8 * Math.max(0, p[P.HIP] + 0.6 * p[P.SPINE] - 0.62);
    // lumbar flexion follows hip flexion (lumbo-pelvic rhythm)
    r[n++] = 0.8 * (p[P.SPINE] - 0.45 * p[P.HIP]);

    // ---- balance: centre of mass above the support
    let cx = 0,
      cz = 0,
      cw = 0;
    for (let s = 0; s < 2; s++) {
      const f = sup[s];
      if (!f) continue;
      cx += f.x;
      cz += f.z;
      cw++;
    }
    if (cw > 0) {
      cx /= cw;
      cz /= cw;
      // centre of pressure sits slightly in front of the ankles
      const ff = forwardOf(p[P.YAW] + env.stance.turn, _l);
      cx += ff.x * 0.012 * d.height;
      cz += ff.z * 0.012 * d.height;
      this.computeCOM(sup);
      // a plan is where we'll stand still, so balance always counts there
      const wb = planner ? 4 : 6 * (1 - 0.85 * env.moving) * (1 - sit);
      r[n++] = wb * (fk.com.x - cx);
      r[n++] = wb * (fk.com.z - cz);
    }

    // ---- knee flexion effort (quadriceps torque): steep near straight, so people
    // either stand tall or commit to a bend; a ready stance prefers its crouch
    const Ll = d.legLength;
    const prefFlex = 2 * Math.acos(clamp((Ll - env.stance.crouch) / Ll, 0, 1));
    for (let s = 0; s < 2; s++) {
      const f = sup[s];
      if (!f) continue;
      const flex = 2 * Math.acos(clamp(fk.hips[s].distanceTo(f) / (0.9998 * Ll), 0, 1));
      // a relaxed ~10° knee bend is nearly free; beyond it effort rises
      const e = flex - prefFlex;
      r[n++] = (1 - sit) * (0.75 * Math.sign(e) * Math.max(0, Math.abs(e) - 0.3) + 0.5 * e);
    }

    // ---- the pelvis stays over the feet sideways (no leaning tower over a closed stance)
    if (!planner && env.footholds) {
      const lx = Math.cos(p[P.YAW]),
        lz = -Math.sin(p[P.YAW]);
      const a = (env.footholds[0].x - fk.pelvis.x) * lx + (env.footholds[0].z - fk.pelvis.z) * lz;
      const b = (env.footholds[1].x - fk.pelvis.x) * lx + (env.footholds[1].z - fk.pelvis.z) * lz;
      const lo = Math.min(a, b) - 0.03,
        hi = Math.max(a, b) + 0.03;
      r[n++] = 45 * (lo > 0 ? lo : hi < 0 ? hi : 0);
    }

    // ---- legs must be able to reach their support feet
    for (let s = 0; s < 2; s++) {
      const f = sup[s];
      if (!f) continue;
      const dist = fk.hips[s].distanceTo(f);
      // heels can come up (tiptoe) when the pelvis is above standing height
      r[n++] = 25 * Math.max(0, dist - 0.998 * d.legLength - Math.max(0, -p[P.DROP]));
      r[n++] = 12 * Math.max(0, 0.3 * d.legLength - dist);
    }

    // ---- stay clear of obstacles: toes and heels outside, with a little margin
    if (planner) {
      for (const o of t.obstacles) {
        // low obstacles are walked over (the gait clears them); they only block standing
        if (o.height !== undefined && o.height < 0.2 * d.height && env.moving > 0.3) continue;
        for (let s = 0; s < 2; s++) {
          for (const reach of [d.toeFront + 0.14, -d.heelBack - 0.08]) {
            const fx = feet[s].x + fwd.x * reach;
            const fz = feet[s].z + fwd.z * reach;
            const pen = Math.min(fx - o.minX, o.maxX - fx, fz - o.minZ, o.maxZ - fz);
            if (pen > 0) r[n++] = 12 * pen;
          }
        }
      }
    }

    if (planner && t.stand && t.stand.weight > 0) {
      r[n++] = 12 * t.stand.weight * (p[P.X] - t.stand.pos.x);
      r[n++] = 12 * t.stand.weight * (p[P.Z] - t.stand.pos.z);
      if (t.stand.yaw !== null) r[n++] = 6 * t.stand.weight * wrapAngle(p[P.YAW] - t.stand.yaw);
    }

    // ---- self-collision proxies: trunk capsule (pelvis→neck) and head stay clear of avoid volumes
    if (t.avoid.length) {
      const trunkR = 0.065 * d.height;
      const headR = 0.06 * d.height;
      for (const a of t.avoid) {
        const pen = Math.max(
          a.radius + trunkR - segmentDistance(a.center, fk.pelvis, fk.spine),
          a.radius + trunkR - segmentDistance(a.center, fk.spine, fk.chest),
          a.radius + trunkR - segmentDistance(a.center, fk.chest, fk.neck),
          a.radius + headR - a.center.distanceTo(fk.headCenter),
        );
        r[n++] = 60 * Math.max(0, pen);
      }
    }

    // ---- regularise toward current state
    if (planner) {
      r[n++] = 0.9 * (p[P.X] - env.root.x);
      r[n++] = 0.9 * (p[P.Z] - env.root.z);
      r[n++] = 0.35 * wrapAngle(p[P.YAW] - env.root.yaw);
    } else {
      r[n++] = 2.5 * wrapAngle(p[P.YAW] - env.root.yaw);
    }
    return n;
  };

  private computeCOM(sup: (Vector3 | null)[]) {
    const { fk, d, env } = this;
    const com = fk.com.set(0, 0, 0);
    com.addScaledVector(fk.headCenter, 0.081);
    com.addScaledVector(fk.spine, 0.25).addScaledVector(fk.chest, 0.247);
    for (let s = 0; s < 2; s++) {
      // hanging arm, blended toward the reaching arm
      _v.copy(fk.shoulders[s]);
      _v.y -= d.armLength * 0.45;
      const h = env.tasks.hands[s];
      if (h && h.weight > 0) _v.lerp(_c.copy(fk.shoulders[s]).lerp(h.pos, 0.45), Math.min(1, h.weight));
      com.addScaledVector(_v, 0.05);
      const ft = env.tasks.feet[s];
      const foot = ft && ft.weight > 0 ? ft.pos : (sup[s] ?? sup[1 - s] ?? fk.pelvis);
      _v.copy(fk.hips[s]).lerp(foot, 0.42);
      com.addScaledVector(_v, 0.161);
    }
  }
}

const _sa = new Vector3();
function segmentDistance(p: Vector3, a: Vector3, b: Vector3): number {
  _sa.subVectors(b, a);
  const l2 = _sa.lengthSq();
  const t = l2 > 1e-12 ? clamp((p.x - a.x) * _sa.x + (p.y - a.y) * _sa.y + (p.z - a.z) * _sa.z, 0, l2) / l2 : 0;
  return Math.hypot(a.x + _sa.x * t - p.x, a.y + _sa.y * t - p.y, a.z + _sa.z * t - p.z);
}

function smoothstep01(x: number) {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

function smoothRamp(x: number, a: number, b: number) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

const _a = new Vector3();
const _b = new Vector3();
function orientedResiduals(t: OrientedTask | null, pos: Vector3, q: Quaternion, r: Float64Array, n: number): number {
  if (!t || t.weight <= 0) return n;
  if (t.pos) {
    const w = 10 * t.weight;
    r[n++] = w * (pos.x - t.pos.x);
    r[n++] = w * (pos.y - t.pos.y);
    r[n++] = w * (pos.z - t.pos.z);
  }
  if (t.rot) {
    const w = 3 * t.weight;
    _a.set(0, 0, 1).applyQuaternion(q);
    _b.set(0, 0, 1).applyQuaternion(t.rot);
    r[n++] = w * (_a.x - _b.x);
    r[n++] = w * (_a.y - _b.y);
    r[n++] = w * (_a.z - _b.z);
    _a.set(0, 1, 0).applyQuaternion(q);
    _b.set(0, 1, 0).applyQuaternion(t.rot);
    r[n++] = w * (_a.x - _b.x);
    r[n++] = w * (_a.z - _b.z);
  }
  return n;
}
