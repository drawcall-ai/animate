import { Quaternion, Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import type { Frame } from '../core/body';
import type { Carrier } from '../core/carrier';
import { followRotation } from '../core/follow';
import { Glide } from '../core/glide';
import { live, type Behaviour, type Live, type Motion, type Target, type Until } from '../core/goal';
import { clampRotation } from '../core/limits';
import { ChainTip, reached } from '../core/tip';
import { TrackedRotation } from '../core/track';
import { INDEX, SIDES, type Side } from './bones';
import type { Humanoid } from './humanoid';
import { lowering, TIPTOE } from './balance/posture';
import { forwardOf, clamp, leftOf, lerp, smoothstep, wrapAngle } from '../core/math';
import { yawOf } from '../core/math';
import { gripOf } from './hands/grips';
import type { Proportions } from './proportions';

/** how far through a step the arm's swing leads it, walking and running (the arm furthest forward with the other thigh), the forearm behind it (share of a step; CMU mocap) */
const LEAD = { walk: 0.2, run: -0.12, forearm: -0.14 };
/** a relaxed arm hangs out from the side (rad; 5–12°, Collins 2009) */
const ABDUCTION = (8 * Math.PI) / 180;
/** how far a hanging hand keeps out past the thigh beside it, from axis to axis (× height): the thigh's and the hand's thickness (mid-thigh 0.034, hand 0.012) and a little air */
const CLEAR = 0.055;
/** how fast a free arm's joints may change their motion (rad/s²) and close in on its pose (rad/s): its swing's own pace, braked where it kinks; let go of, it comes down calmly */
const SWING = { accel: 25, speed: 2.5 };
/** calm, everyday motion of a hand (Herneth 2024): how a hand moves unless asked otherwise, its joints braked at ~6× a reach's peak */
export const CALM = { accel: 8, speed: 1.5, turnAccel: 60, turnSpeed: 10 } satisfies Motion;
/** A held grip follows briskly enough that solved joints stay within a few cm. */
export const HOLD = { ...CALM, accel: 30, speed: 3, turnAccel: 200, turnSpeed: 15 };
/** how fast the clavicle moves (rad/s²) */
const CLAVICLE = { accel: 30 };
/** how far a hand reaches, bowing and crouching for it (× the arm's length): all but straight, held out at most this far */
export const ARM_REACH = 0.95;
/** outward reach used to decide whether a target needs lowering (× arm length) */
const OUT = 0.5;

/**
 * Free arms: each hangs a little out from the side, the elbow a little bent, and swings with the
 * steps as a pendulum (`h.gait`'s stride), opposite the legs, wider and bent walking faster; the
 * clavicles and hands at rest. Endless; every joint follows its pose from its history, so an arm a
 * task let go of swings back into it. A hand still holding an item follows its grip until release.
 */
export function hangArms<W>(h: Humanoid<W>): Behaviour<W> {
  return function* () {
    const goals = new Map<number, TrackedRotation>();
    let phase = h.gait.phase;
    const heldArms = { left: new ChainTip('leftArm'), right: new ChainTip('rightArm') };
    yield* action<Frame<W>>({
      update: (f) => {
        const g = h.gait;
        // Recalled pendulum floor: at least 0.25 s between arm reversals, including entrainment.
        phase += clamp(wrapAngle(g.phase - phase), 0, 4 * Math.PI * f.dt);
        const lead = lerp(LEAD.walk, LEAD.run, g.run);
        const p = h.proportions;
        const yaw = yawOf(_h.copy(f.current.local(0)));
        const hips = f.current.position(0);
        const left = leftOf(yaw, _left);
        SIDES.forEach((side, s) => {
          const held = h.holding[side];
          if (held) {
            handStep(h, f, side, gripOf(held.item, held.grip), { on: held.item, ...HOLD, lead: !h.worn.has(held.item) }, heldArms[side]);
            return;
          }
          const sign = s === 0 ? 1 : -1;
          // (the left arm in front as the left foot lifts, the right behind)
          // (growing in as the walk does: setting off, the first steps barely swing them)
          const swing = (at: number) => (sign * Math.cos(phase + Math.PI * at) * lerp(0.33, 0.42, g.run) + 0.02) * g.walk;
          const a = swing(lead);
          const flex = lerp(0.25 + (0.18 + 0.5 * swing(lead + LEAD.forearm)) * g.walk, 1.5 + 0.3 * swing(lead + LEAD.forearm), g.run) * (1 - smoothstep(0.6, 1.6, a));
          // the arm hanging plumb from the shoulder (as it was last, whoever placed the chest after),
          // out from the T-pose as far as keeps the hand clear of the thigh beside it (the hip's or
          // the knee's, as the legs stand now; the pelvis' frame) — however the trunk bows, leans
          // or twists — swung forward about the pelvis' left; the forearm forward
          set(f, goals, INDEX[`${side}Shoulder`], IDENTITY);
          const outward = (at: Readonly<Vector3>) => _d.subVectors(at, hips).dot(left) * sign;
          const thigh = Math.max(outward(f.current.position(INDEX[`${side}UpperLeg`])), outward(f.current.position(INDEX[`${side}LowerLeg`])));
          const clear = (thigh + CLEAR * p.height - outward(f.prev.position(INDEX[`${side}UpperArm`]))) / p.armLength;
          const out = Math.max(ABDUCTION, Math.asin(clamp(clear, -1, 1)));
          const hang = _q.setFromAxisAngle(Y, yaw).multiply(_h.setFromAxisAngle(X, -a)).multiply(_p.setFromAxisAngle(Z, -sign * (Math.PI / 2 - out)));
          set(f, goals, INDEX[`${side}UpperArm`], hang.premultiply(_h.copy(f.current.rotation(INDEX[`${side}Shoulder`])).invert()));
          set(f, goals, INDEX[`${side}LowerArm`], _q.setFromAxisAngle(Y, -sign * flex));
          set(f, goals, INDEX[`${side}Hand`], IDENTITY);
        });
      },
    });
  };
}

/** joint `bone` turned on from its history toward `goal` (its own motion followed) */
function set<W>(f: Frame<W>, joints: Map<number, TrackedRotation>, bone: number, goal: Quaternion) {
  let joint = joints.get(bone);
  if (!joint) joints.set(bone, (joint = new TrackedRotation()));
  const q = joint.follow(f.prev2.local(bone), f.prev.local(bone), goal, SWING, f.dt, _r);
  const limit = f.current.skeleton.limits[bone];
  if (limit) clampRotation(q, limit);
  f.current.setLocal(bone, q);
}

/** How a hand goes to its target. */
export interface HandOptions<W> extends Partial<Motion> {
  /** where the elbow bends toward (world; default as where the hand is asks: down and back hanging, out reaching across, …) */
  pole?: Live<Vector3, W>;
  /** the target is on this carrier, in its frame */
  on?: Carrier;
  /** the body comes along for a target out of the arm's reach: it bows and squats for one low, goes up on its toes for one high (default true); false: the hand only follows (a tracked controller: the head leads) */
  lead?: boolean;
  /** a reach that takes this long (s): the hand goes along a minimum-jerk path to the target (`Glide`: a bell of speed), then stays on it */
  seconds?: number;
  /** with `seconds`: the reach sets off this long after (s), the arm kept as it is till then */
  after?: number;
  until?: Until<W>;
}

/**
 * Hand `side`'s wrist (and, given its rotation, the hand) to `target`, every sub-step, endless or
 * until `until`: the hand moving on from its history at `Motion`'s pace (default `CALM`), its arm
 * solved to it and braked; the clavicle shrugging for a hand up high and drawn forward for one far
 * out; the elbow swivelled as where the hand is asks. Leading (by default), a target below what the
 * arm reaches standing asks `balance` to bow and bend the knees for it, one above to go up on the
 * toes (`h.asks`).
 */
export function handTo<W>(h: Humanoid<W>, side: Side, target: Live<Target, W>, options: HandOptions<W> = {}): Behaviour<W> {
  const { until, seconds, after = 0 } = options;
  return function* () {
    const arm = new ChainTip(`${side}Arm`);
    const glide = seconds === undefined ? null : new Glide(seconds);
    const bone = INDEX[`${side}Hand`];
    let waiting = after;
    // (waiting, the arm's joints kept as they were when it began, come to rest there: the hand
    // stays where it is on the body, neither dropped to its hang nor taken up by the arm's solve)
    let kept: [number, Quaternion][] | null = null;
    const joints = new Map<number, TrackedRotation>();
    // (gliding: as the arm stood when the hand set off — where the elbow was from the shoulder, in the
    // chest's frame; the clavicle — and how far the hand had to go)
    let start: { elbow: Vector3; clavicle: Quaternion; off: number } | null = null;
    yield* action<Frame<W>>({
      update: (f) => {
        const goal = live(target, f);
        if (!glide) return void handStep(h, f, side, goal, options, arm);
        if (waiting > 0) {
          waiting -= f.dt;
          kept ??= ARM.map((b) => [INDEX[`${side}${b}`], f.prev.local(INDEX[`${side}${b}`]).clone()]);
          for (const [b, q] of kept) set(f, joints, b, q);
          return;
        }
        // (the target in the world, the hand gliding to it from where it is and how it moves)
        const on = options.on;
        const world = on ? { ...on.toWorld(goal, _world), axis: goal.axis && _axis.copy(goal.axis).applyQuaternion(on.current.quaternion) } : { ...goal, velocity: goal.velocity ?? ZERO };
        const moving = _m.subVectors(f.prev.position(bone), f.prev2.position(bone)).divideScalar(f.dt);
        glide.step(f.prev.position(bone), moving, world.position, world.velocity ?? ZERO, f.dt, _glided);
        // (the arm as it stood when the hand set off — its clavicle, where its elbow pointed — turning
        // to what the reach wants as the hand goes: aimed at once where the hand goes, the solve would
        // swing the arm round, drawing the hand back, before it sets off)
        const shoulder = f.current.position(INDEX[`${side}UpperArm`]);
        const chest = f.current.rotation(INDEX.chest);
        if (!start) {
          start = {
            elbow: f.prev.position(INDEX[`${side}LowerArm`]).clone().sub(f.prev.position(INDEX[`${side}UpperArm`])).applyQuaternion(_c.copy(f.prev.rotation(INDEX.chest)).invert()),
            clavicle: f.prev.local(INDEX[`${side}Shoulder`]).clone(),
            off: _glided.position.distanceTo(world.position),
          };
        }
        const share = start.off > 1e-6 ? smoothstep(0, 1, 1 - _glided.position.distanceTo(world.position) / start.off) : 1;
        const pole = options.pole === undefined ? elbowPole(f, h.proportions, side, world.position, _pole).lerp(_bend.copy(start.elbow).applyQuaternion(chest).add(shoulder), 1 - share) : live(options.pole, f);
        handStep(h, f, side, { ...world, position: _glided.position, velocity: _glided.velocity }, { ...options, on: undefined, pole }, arm, { at: world.position, center: on?.current.position, clavicle: start.clavicle, share });
      },
      until: until === 'reached' ? (f) => reached(f.prev2, f.prev, f.dt, INDEX[`${side}Hand`], live(target, f), options.on) : until,
    });
  };
}

/** one sub-step of `handTo`, its arm's tip `arm` */
export function handStep<W>(h: Humanoid<W>, f: Frame<W>, side: Side, target: Target, options: HandOptions<W>, arm: ChainTip, toward?: { at: Readonly<Vector3>; center?: Readonly<Vector3>; clavicle: Readonly<Quaternion>; share: number }) {
  const p = h.proportions;
  const at = options.on ? options.on.toWorld(target, _world).position : target.position;
  shrug(f, p, side, toward?.at ?? at, toward);
  const pole = options.pole === undefined ? elbowPole(f, p, side, at, _pole) : live(options.pole, f);
  // (gliding from where the hand is: an arm hanging all but straight is not drawn in at once)
  arm.to(f, target, { ...CALM, ...options, pole, letOut: toward !== undefined });
  // The body joins a glide with the hand, rather than moving for its starting hang.
  if (options.lead ?? true) {
    bringShoulder(h, f, side, toward?.at ?? at, toward?.share ?? 1);
    const goal = options.on?.current.position ?? toward?.center ?? toward?.at ?? at;
    const hips = f.current.position(0);
    const bearing = wrapAngle(Math.atan2(goal.x - hips.x, goal.z - hips.z) - h.gait.facing);
    // The trunk joins the reach while the feet keep their facing.
    h.asks.twist = clamp(0.2 * bearing, -Math.PI / 9, Math.PI / 9) * (toward?.share ?? 1);
  }
}

/**
 * the clavicle (chest-relative) turned so the shoulder joint goes up for a hand high up and forward
 * toward one far out (the old core's, a801be4:packages/core/src/limbs/arms.ts)
 */
function shrug<W>(f: Frame<W>, p: Proportions, side: Side, hand: Readonly<Vector3>, from?: { clavicle: Readonly<Quaternion>; share: number }) {
  const pose = f.current;
  const bone = INDEX[`${side}Shoulder`];
  const clavicle = pose.position(bone);
  const shoulder = _s.copy(pose.position(INDEX[`${side}UpperArm`]));
  const chest = pose.rotation(INDEX.chest);
  const up = _up.set(0, 1, 0).applyQuaternion(chest);
  const L = p.armLength;
  const v = _d.subVectors(hand, shoulder);
  const elevation = smoothstep(-0.05, 0.6, v.dot(up) / L);
  const reach = v.length();
  const want = shoulder.addScaledVector(up, elevation * 0.03 * p.height);
  if (reach > 1e-6) want.addScaledVector(v, clamp(reach - 0.85 * L, 0, 0.035 * p.height) / reach);
  // (the joint on a sphere about the clavicle's origin: its rest offset turned toward it, in the chest's frame)
  const to = want.sub(clavicle).applyQuaternion(_c.copy(chest).invert()).normalize();
  const goal = _g.setFromUnitVectors(_rest.copy(p.offsets[`${side}UpperArm`]).normalize(), to);
  if (from) goal.slerpQuaternions(from.clavicle, _q.copy(goal), from.share);
  const limit = pose.skeleton.limits[bone];
  if (limit) clampRotation(goal, limit);
  const q = followRotation(f.prev2.local(bone), f.prev.local(bone), goal, CLAVICLE, f.dt, _r);
  if (limit) clampRotation(q, limit);
  pose.setLocal(bone, q);
}

/**
 * where the elbow bends toward (into `out`, world): a blend of where it goes for a hand hanging,
 * forward, up, out and across, in the chest's frame (the old core's; up, the elbow out to the side:
 * forward, the arm near straight overhead would swivel to and fro)
 */
function elbowPole<W>(f: Frame<W>, p: Proportions, side: Side, hand: Readonly<Vector3>, out: Vector3): Vector3 {
  const sign = side === 'left' ? 1 : -1;
  const shoulder = f.current.position(INDEX[`${side}UpperArm`]);
  const chest = _c.copy(f.current.rotation(INDEX.chest));
  const dl = _d.subVectors(hand, shoulder).normalize().applyQuaternion(_q.copy(chest).invert());
  dl.x *= sign;
  out
    .set(0.12, 0, -1)
    .multiplyScalar(Math.max(0, -dl.y))
    .addScaledVector(_w.set(0.4, -1, -0.15), Math.max(0, dl.z))
    .addScaledVector(_w.set(0.7, -0.3, 0.5), Math.max(0, dl.y))
    .addScaledVector(_w.set(0, -1, -0.4), Math.max(0, dl.x))
    .addScaledVector(_w.set(0.7, -0.6, 0), Math.max(0, -dl.x));
  out.x *= sign;
  return out.applyQuaternion(chest).setLength(p.upperArm).add(shoulder);
}

/**
 * Asks `balance` to bring the shoulder within reach of `hand`: the trunk bowing and the knees bending
 * for one below (`lowering`), up on the toes for one above. Of two hands asking (both arms on
 * something low), the one needing more wins: each sub-step's asks start cleared.
 */
export function bringShoulder<W>(h: Humanoid<W>, f: Frame<W>, side: Side, hand: Readonly<Vector3>, share = 1) {
  const p = h.proportions;
  const { asks } = h;
  // (the shoulder joint's height standing, and how far below and above it the arm reaches, held out as far as standing takes it)
  const high = p.hipHeight + p.offsets.spine.y + p.offsets.chest.y + p.offsets.leftShoulder.y + p.offsets.leftUpperArm.y;
  const shoulder = _s.copy(f.current.position(INDEX[`${side}UpperArm`]));
  // At waist height, solve a standing hinge before asking the knees to lower the body.
  // Tuned blend across 12–32 cm below the hips; the 0.8 lever share approximates the articulated spine.
  const waist = smoothstep(p.hipHeight - 0.32 * p.scale, p.hipHeight - 0.12 * p.scale, hand.y);
  let hinge = 0;
  let knees = 0;
  if (waist > 0 && hand.y < high) {
    const from = _d.copy(hand).sub(f.current.position(INDEX.hips));
    const fwd = forwardOf(h.gait.facing, _w);
    const ahead = from.dot(fwd);
    const lateral = from.dot(leftOf(h.gait.facing, _left)) - (side === 'left' ? 1 : -1) * (p.offsets.leftShoulder.x + p.offsets.leftUpperArm.x);
    const lever = high - p.hipHeight;
    const reaches = (bow: number) => Math.hypot(lateral, ahead - lever * Math.sin(0.8 * bow), high - hand.y - lever * (1 - Math.cos(0.8 * bow))) <= ARM_REACH * p.armLength;
    let lo = 0;
    let hi = 0.65;
    if (!reaches(0)) {
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (reaches(mid)) hi = mid;
        else lo = mid;
      }
      hinge = hi;
      const across = Math.hypot(lateral, ahead - lever * Math.sin(0.8 * hinge));
      const below = Math.sqrt(Math.max(0, (ARM_REACH * p.armLength) ** 2 - across * across));
      knees = Math.max(0, high - hand.y - lever * (1 - Math.cos(0.8 * hinge)) - below);
    }
  }
  const across = Math.min(Math.hypot(hand.x - shoulder.x, hand.z - shoulder.z), Math.max(OUT * p.armLength, high - hand.y));
  const below = Math.sqrt(Math.max(0, (ARM_REACH * p.armLength) ** 2 - across * across));
  const drop = high - hand.y - below;
  if (drop > 0) {
    const { lower, bow } = lowering(p, drop);
    asks.lower = Math.max(asks.lower, lerp(lower, Math.min(lower, knees), waist) * share);
    asks.bow = Math.max(asks.bow, lerp(bow, hinge, waist) * share);
    return;
  }
  asks.bow = Math.max(asks.bow, hinge * waist * share);
  const rise = hand.y - (high + below);
  if (rise > 0 && asks.lower <= 0) asks.lower = Math.min(asks.lower, -Math.min(rise, TIPTOE * p.scale));
}

/** an arm's joints, from the clavicle out */
const ARM = ['Shoulder', 'UpperArm', 'LowerArm', 'Hand'] as const;
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const IDENTITY = new Quaternion();
const _q = new Quaternion();
const _p = new Quaternion();
const _r = new Quaternion();
const _h = new Quaternion();
const _left = new Vector3();
const _c = new Quaternion();
const _g = new Quaternion();
const _s = new Vector3();
const _d = new Vector3();
const _w = new Vector3();
const _up = new Vector3();
const _rest = new Vector3();
const _pole = new Vector3();
const _bend = new Vector3();
const _world: Target & { velocity: Vector3; spin: Vector3 } = { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() };
const _m = new Vector3();
const _axis = new Vector3();
const _glided = { position: new Vector3(), velocity: new Vector3() };
const ZERO = new Vector3();
