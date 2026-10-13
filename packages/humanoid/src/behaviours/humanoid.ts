import { Quaternion, Vector3 } from 'three';
import { action, parallel, type ReusableTimeline } from '@pmndrs/timeline';
import { STEP, type Ctx, type Support } from '@prohuman/body';
import { BONES, INDEX, SIDES, type Side } from '../bones';
import { ankleFor, footprint } from '../gait/foot';
import { hullOf, outside, type Spot } from '../gait/support';
import type { Humanoid } from '../humanoid';
import { clamp, forwardOf, GRAVITY, leftOf, quatYXZ, Spring, wrapAngle } from '../math';
import { CALM, CALM_ROOT, caps, rootCap } from '../profile/caps';
import { ranges } from '../profile/limits';
import { relaxedPose } from '../profile/relaxed';
import { yawOf } from '../rig';
import { bodyYaw, defaultStance, feetFacing as facingOf, OVER_ANKLES, stanceFeet, type Stance } from '../stance';
import { plant, type Leg } from '../procedures/footing';
import { nextHip } from '../procedures/legs';
import { STANDING_REACH } from '../start';
import { standingHeight } from '../procedures/shift';
import { shankTilt, step } from '../procedures/step';

const ORIGIN = new Vector3();
const HIPS = { bone: INDEX.hips, at: ORIGIN };

/** how strongly the relaxed pose pulls a joint nothing else drives */
const COMFORT = 0.2;
/**
 * the extrapolated centre of mass leaving the support by this much (m, default body) takes a
 * step (the old core's CATCH)
 */
const CATCH = 0.02;
/** a foot this far off its place in the stance is moved (m, default body; rad): the old core's idle adjustments */
const SETTLE = { distance: 0.1, lateral: 0.04, yaw: 0.45 };
/** the most the ankle flexes up standing before the heel comes up (rad; the old core's HEEL_OFF.stand) */
const HEEL_OFF = 0.62;
/** how quickly a planted foot rolls to its pitch (1/s): flat after a step's heel strike, up onto the ball when the leg can't reach */
const ROLL_RATE = 25;
/** the stand's pull on the pelvis (Hz): balance is slow, a sway */
const STAND_STIFFNESS = 3;
/** how firmly the stand poses its legs (from where their hips are: a hint at the knees' way, not a brake) */
const POSE = 0.1;
/** how close a stepping foot may come to the other, side to side (× the stance's width): it never steps onto or across it */
const CLEAR = 0.8;
/** how long a step must have been due before it is taken (s) */
const DUE = 0.1;

/**
 * The humanoid's lifetime bundle: its joints' human ranges of motion and calm acceleration caps,
 * comfort (the relaxed pose, for whatever nothing else drives), and standing balance (the feet
 * held where they stand, the body over them, a step when it would fall). All of it is
 * the fallback the behaviours run on: a behaviour that drives the body overrides it.
 */
export function humanoid<W>(h: Humanoid<W>, options: { stance?: Partial<Stance> } = {}): ReusableTimeline<Ctx<W>> {
  return function* () {
    h.status.stance = { ...defaultStance(h.proportions), ...options.stance };
    yield* parallel<Ctx<W>>('all', joints(), comfort(), stand(h));
  };
}

/** the joints' ranges of motion and calm caps (`CALM`; the toes' elite), the root's calm translation cap, every frame */
function joints<W>(): ReusableTimeline<Ctx<W>> {
  const limits = ranges();
  // (but the toes: they lie flat on the floor as the heel rolls up and down, at the foot's pace)
  const elite = caps();
  const calm = [...caps(CALM).map((c, i) => (/Toes/.test(BONES[c.bone]) ? elite[i] : c)), rootCap(CALM_ROOT)];
  return function* () {
    yield* action<Ctx<W>>({
      update: (ctx) => {
        for (const l of limits) ctx.propose.limit(l);
        for (const c of calm) ctx.propose.cap(c);
      },
    });
  };
}

/**
 * comfort: the relaxed pose's arms, trunk and head (the legs are the stance's), weak, every
 * frame; whatever a behaviour drives or claims (a hand target its arm) yields it
 */
function comfort<W>(): ReusableTimeline<Ctx<W>> {
  const relaxed = relaxedPose().filter(({ bone }) => !/Leg|Foot|Toes/.test(BONES[bone]));
  return function* () {
    yield* action<Ctx<W>>({
      update: (ctx) => {
        for (const { bone, rotation } of relaxed) ctx.propose.target({ kind: 'local', point: { bone, at: ORIGIN }, value: rotation, weight: COMFORT, tier: 'fallback', owner: 'comfort' });
      },
    });
  };
}

/** the extrapolated centre of mass (Hof) as the body was solved: on the floor, v / ω0 ahead */
export function xcomOf<W>(ctx: Ctx<W>, h: Humanoid<W>, out = new Vector3()): Vector3 {
  const omega = Math.sqrt(GRAVITY / h.proportions.legLength);
  return out
    .copy(ctx.body.com)
    .addScaledVector(ctx.body.comVelocity, 1 / omega)
    .setY(0);
}

/** the support's corners on the floor: each weight-bearing foot's footprint, any other support's point */
export function supportOf<W>(h: Humanoid<W>, supports: readonly Support[]): Spot[] {
  return supports.flatMap(({ contact, position }) => {
    const foot = contact.point !== 'com' && (contact.point.bone === INDEX.leftFoot || contact.point.bone === INDEX.rightFoot);
    const at: Spot = [position.x, position.z];
    if (!foot || !contact.rotation) return [at];
    const fwd = new Vector3(0, 0, 1).applyQuaternion(contact.rotation);
    return footprint(h.proportions, position, Math.atan2(fwd.x, fwd.z));
  });
}

/** a step the stand takes: which foot, to where, heading which way */
interface Due {
  side: Side;
  to: Vector3;
  yaw: number;
}

/** the stand's state: each foot's roll, the foot it is stepping */
interface Standing {
  pitch: [Spring, Spring];
  planted: [boolean, boolean];
  stepping: Side | null;
  /** how long a step has been due (s) */
  due: number;
}

const _com = new Vector3();
const _hips = new Vector3();
const _hip = new Vector3();
const _xcom = new Vector3();
const _v = new Vector3();
const _q = new Quaternion();
const _homes: [Vector3, Vector3] = [new Vector3(), new Vector3()];
const _f = new Vector3();
const _l = new Vector3();

/**
 * Standing balance, the fallback for the legs and the pelvis: planted feet held where the status
 * has them (rolled flat, up on the ball where the leg can't reach; one another behaviour swings
 * is left to it), the centre of mass over them; and, while the legs are its own, a step when the extrapolated centre of mass leaves the support or a foot is out of its
 * place in the stance (the body turned or moved over its feet).
 */
function stand<W>(h: Humanoid<W>): ReusableTimeline<Ctx<W>> {
  const st: Standing = { pitch: [new Spring(), new Spring()], planted: [true, true], stepping: null, due: 0 };
  return function* () {
    const next: { due: Due | null } = { due: null };
    for (;;) {
      yield* action<Ctx<W>>({
        update: (ctx) => {
          hold(ctx, h, st);
          // (a step once it has been due for a moment: a passing jolt is no reason to step)
          const due = dueStep(ctx, h, st);
          st.due = due ? st.due + ctx.dt : 0;
          next.due = st.due >= DUE ? due : null;
          return next.due === null;
        },
      });
      if (!next.due) continue;
      const { side, to, yaw } = next.due;
      const p = h.proportions;
      const from = h.status.feet[side === 'left' ? 0 : 1].position;
      const length = Math.hypot(to.x - from.x, to.z - from.z);
      st.stepping = side;
      // (the weight onto the other foot first, then the step)
      yield* parallel<Ctx<W>>(
        'race',
        action<Ctx<W>>({ update: (ctx) => void hold(ctx, h, st) }),
        (function* () {
          yield* step(h, side, {
            to: () => ({ position: to, yaw }),
            duration: clamp(0.24 + (0.32 * length) / p.scale, 0.28, 0.45),
            lift: (length < 0.06 ? 0.015 : clamp(0.07 * length, 0.03, 0.09)) * p.scale,
            strike: 0.04,
            leg: () => solvedLeg(h, side),
            hold: { priority: 1, owner: 'stand.step', pose: POSE },
            shift: true,
          });
        })(),
      );
      st.stepping = null;
      st.due = 0;
    }
  };
}

/** the stand's proposals for one frame */
function hold<W>(ctx: Ctx<W>, h: Humanoid<W>, st: Standing) {
  const p = h.proportions;
  const { feet, stance } = h.status;
  let n = 0;
  _com.set(0, 0, 0);
  SIDES.forEach((side, s) => {
    const f = feet[s];
    const bone = INDEX[`${side}Foot`];
    // (the foot it steps is the step's)
    if (st.stepping === side) {
      st.planted[s] = false;
      return;
    }
    // (a foot another behaviour swings is its own until it puts it down)
    if (f.phase !== 'planted') {
      st.planted[s] = false;
      return;
    }
    // (from the pitch it came down with)
    if (!st.planted[s]) {
      const fwd = _v.set(0, 0, 1).applyQuaternion(ctx.body.rotations[bone]);
      st.pitch[s].reset(Math.atan2(fwd.y, Math.hypot(fwd.x, fwd.z)));
      st.planted[s] = true;
    }
    plant(ctx, h, side, st.pitch[s].step(heelPitch(ctx, h, side), ROLL_RATE, ctx.dt), solvedLeg(h, side), { priority: 1, owner: 'stand', tier: 'fallback', pose: POSE });
    n++;
  });
  if (n === 0) return;
  // the centre of mass over the feet (onto the standing one during a step), the pelvis as high
  // as the legs reach (and as low as asked), facing as asked or as the feet stand
  const hinted = h.hints.read(ctx.time);
  const facing = hinted.facing ?? feetFacing(h);
  const mid = _v.set(0, 0, 0);
  for (const f of feet) mid.add(f.position);
  mid.multiplyScalar(0.5);
  if (st.stepping) mid.copy(feet[st.stepping === 'left' ? 1 : 0].position);
  mid.addScaledVector(forwardOf(facing, _f), OVER_ANKLES * p.scale);
  const hips = _hips.copy(ctx.body.positions[0]);
  hips.x += mid.x - ctx.body.com.x;
  hips.z += mid.z - ctx.body.com.z;
  hips.y = standingHeight(ctx, h);
  ctx.propose.target({
    kind: 'position',
    point: HIPS,
    value: hips,
    weight: 1,
    tier: 'fallback',
    stiffness: STAND_STIFFNESS,
    owner: 'stand',
  });
  ctx.propose.target({
    kind: 'orientation',
    point: HIPS,
    value: quatYXZ(facing + stance.blade, 0, 0, _q),
    weight: 1,
    tier: 'fallback',
    stiffness: STAND_STIFFNESS,
    owner: 'stand',
  });
}

const _legs = [new Vector3(), new Vector3()];

/**
 * leg `side` as the body was solved: its hip joint where it will be next frame, the body facing as
 * its pelvis does (not as its feet stand: a foot lifted for a step would turn the knees with it)
 */
function solvedLeg<W>(h: Humanoid<W>, side: Side): Leg {
  const bone = INDEX[`${side}UpperLeg`];
  const s = h.state;
  return { pelvis: s.rotations[0], hip: _legs[side === 'left' ? 0 : 1].copy(s.positions[bone]).addScaledVector(s.velocities[bone], STEP), facing: yawOf(s.rotations[0]) - h.status.stance.blade };
}

/** the body's facing as its feet stand (as the planted one does while the other swings: not as it will land) */
export function feetFacing<W>(h: Humanoid<W>): number {
  const { feet, stance } = h.status;
  if (feet[0].phase === 'planted' && feet[1].phase !== 'planted') return bodyYaw(feet[0].yaw, 1, stance);
  if (feet[1].phase === 'planted' && feet[0].phase !== 'planted') return bodyYaw(feet[1].yaw, -1, stance);
  return facingOf(feet[0].yaw, feet[1].yaw, stance);
}

/**
 * How far planted foot `side` is rolled to stand under the body as it was solved: flat, its heel up
 * once the shank tilts past what the ankle flexes (a squat) or the leg can't reach it
 */
function heelPitch<W>(ctx: Ctx<W>, h: Humanoid<W>, side: Side): number {
  const p = h.proportions;
  const f = h.status.feet[side === 'left' ? 0 : 1];
  let pitch = Math.min(0, HEEL_OFF - shankTilt(ctx, side, f.yaw));
  // (the hip joint where the stand carries it: a pelvis held up higher is brought down onto
  // flat feet, not followed up onto the toes)
  const hip = nextHip(ctx, side, _hip);
  hip.y -= Math.max(0, ctx.body.positions[0].y - standingHeight(ctx, h));
  // (beyond the reach the stand stands at: the pelvis carried higher than the stand would)
  const reach = STANDING_REACH * p.legLength;
  if (hip.distanceTo(ankleFor(p, side, f.position, f.yaw, pitch, _v)) <= reach) return pitch;
  let lo = -1.2;
  let hi = pitch;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (hip.distanceTo(ankleFor(p, side, f.position, f.yaw, mid, _v)) > reach) hi = mid;
    else lo = mid;
  }
  pitch = lo;
  return pitch;
}

/**
 * The step the stand takes now, if any: while the legs are its own (its contacts won) and
 * both feet stand, a step with the foot that catches the body when its extrapolated centre of
 * mass leaves the support, or with the foot furthest out of its place in the stance.
 */
function dueStep<W>(ctx: Ctx<W>, h: Humanoid<W>, st: Standing): Due | null {
  const { feet, stance } = h.status;
  const p = h.proportions;
  if (feet.some((f) => f.phase !== 'planted') || ctx.granted('stand').lost.length > 0 || ctx.granted('stand').won.length < 2) return null;
  const facing = yawOf(_q.copy(ctx.body.rotations[0])) - stance.blade;
  const xcom = xcomOf(ctx, h, _xcom);
  const support = hullOf(supportOf(h, ctx.supports()));
  const out = support.length ? outside(support, xcom) : Infinity;
  // (where the feet go: their places in the stance around the centre of mass, or the extrapolated
  // one when it is leaving the support)
  const around = out > CATCH * p.scale ? xcom : _com.copy(ctx.body.com);
  stanceFeet(around.x, around.z, forwardOf(facing, _f), leftOf(facing, _l), p, stance, _homes);
  const yaws = [facing + stance.blade + stance.toeOut, facing + stance.blade - stance.toeOut];
  const off = SIDES.map((_, s) => {
    const d = _v.subVectors(_homes[s], feet[s].position).setY(0);
    return Math.max(d.length() / (SETTLE.distance * p.scale), Math.abs(d.dot(leftOf(facing, _l))) / (SETTLE.lateral * p.scale), Math.abs(wrapAngle(yaws[s] - feet[s].yaw)) / SETTLE.yaw);
  });
  // (falling, the foot on the side it falls to catches it, the other follows next; else the
  // foot furthest out of its place)
  const left = leftOf(facing, _l);
  const falling = out > CATCH * p.scale;
  const s = falling ? (_v.copy(feet[0].position).add(feet[1].position).multiplyScalar(-0.5).add(xcom).dot(left) > 0 ? 0 : 1) : off[0] >= off[1] ? 0 : 1;
  if (!falling && off[s] <= 1) return null;
  // (never onto or across the other foot: at least CLEAR of the stance's width beside it)
  const to = _homes[s].clone();
  const side = s === 0 ? 1 : -1;
  const beside = _v.subVectors(to, feet[1 - s].position).dot(left) * side;
  const clear = CLEAR * stance.width;
  if (beside < clear) to.addScaledVector(left, (clear - beside) * side);
  return { side: SIDES[s], to, yaw: yaws[s] };
}
