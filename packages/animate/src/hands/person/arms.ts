import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import type { Frame } from '../../kernel/frame';
import type { Carrier } from '../../kernel/carrier';
import { followRotation } from '../../kernel/follow';
import { Glide } from '../../kernel/glide';
import { live, type Live, type Motion, type Placement, type Goal } from '../../kernel/goal';
import { clampRotation } from '../../kernel/limits';
import { ChainTip } from '../../kernel/tip';
import { TrackedRotation } from '../../kernel/track';
import { INDEX, SIDES, type Side } from '../../species/humanoid/bones';
import type { Reacher } from './reacher';
import type { Step } from '../../kernel/frame';
import type { Thing } from '../../things/thing';
import { hangsFrom, onBody } from '../../things/hold';
import { bringShoulder, PROTRACTION, twistToward } from './bend';
import { checkArms, clearWrist, keepArmOut, NUDGED, SOLVED, waitingFor } from './trunk';
import { clamp, leftOf, lerp, smoothstep, wrapAngle, yawOf } from '../../kernel/math';
import type { Proportions } from '../../species/humanoid/proportions';

/**
 * how far through a step the arm's swing leads it, walking and running (the arm furthest forward with the other thigh), the forearm
 * behind it (share of a step; CMU mocap)
 */
const LEAD = { walk: 0.2, run: -0.12, forearm: -0.14 };
/** a relaxed arm hangs out from the side (rad; 5–12°, Collins 2009) */
const ABDUCTION = (8 * Math.PI) / 180;
/**
 * how far a hanging hand keeps out past the thigh beside it, from axis to axis (× height): the thigh's and the hand's thickness
 * (mid-thigh 0.034, hand 0.012) and a little air
 */
const CLEAR = 0.055;
/**
 * how fast a free arm's joints may change their motion (rad/s²) and close in on its pose (rad/s): its swing's own pace, braked where it
 * kinks; let go of, it comes down calmly
 */
const SWING = { accel: 25, speed: 2.5 };
/** calm, everyday motion of a hand (Herneth 2024): how a hand moves unless asked otherwise, its joints braked at ~6× a reach's peak */
export const CALM = { accel: 8, speed: 1.5, turnAccel: 60, turnSpeed: 10 } satisfies Motion;
/** how fast the clavicle moves (rad/s²) */
const CLAVICLE = { accel: 30 };

/**
 * Free arms: each hangs a little out from the side, the elbow a little bent, and swings with the
 * steps as a pendulum (`h.locomotion`'s stride), opposite the legs, wider and bent walking faster; the
 * clavicles and hands at rest. Endless; every joint follows its pose from its history, so an arm a
 * task let go of swings back into it. A hand holding any item follows its grip until release, including supported and worn items.
 */
export function hanging(h: Reacher): Step {
  const goals = new Map<number, TrackedRotation>();
  let phase = h.locomotion.phase;
  return (f) => {
    if (f.dev && f.time > f.dt) checkArms(f.prev, h.proportions, f.time - f.dt, f.dev);
    const g = h.locomotion;
    // Recalled pendulum floor: at least 0.25 s between arm reversals, including entrainment.
    phase += clamp(wrapAngle(g.phase - phase), 0, 4 * Math.PI * f.dt);
    const lead = lerp(LEAD.walk, LEAD.run, g.run);
    const p = h.proportions;
    // (running, the arms hang and swing from the shoulders as the stride turns the thorax off the pelvis — not as an asked twist or
    // a turn's lead turns the chest; walking, that turn is small and the arms keep to the pelvis's facing)
    const yaw = yawOf(_h.copy(f.current.local(0))) + g.run * (g.thoraxYaw - g.pelvisYaw);
    const hips = f.current.position(0);
    const left = leftOf(yaw, _left);
    SIDES.forEach((side, s) => {
      if (h.holding[side]) return;
      const sign = s === 0 ? 1 : -1;
      // (the left arm in front as the left foot lifts, the right behind)
      // (growing in as the walk does: setting off, the first steps barely swing them)
      const swing = (at: number) => (sign * Math.cos(phase + Math.PI * at) * lerp(0.33, 0.42, g.run) + 0.02) * g.walk;
      const a = swing(lead);
      const walked = 0.25 + (0.18 + 0.5 * swing(lead + LEAD.forearm)) * g.walk, ran = 1.5 + 0.3 * swing(lead + LEAD.forearm);
      const flex = lerp(walked, ran, g.run) * (1 - smoothstep(0.6, 1.6, a));
      // the arm hanging plumb from the shoulder (as it was last, whoever placed the chest after),
      // out from the T-pose as far as keeps the hand clear of the thigh beside it (the hip's or
      // the knee's, as the legs stand now; the arm's frame) — however the trunk bows, leans
      // or twists — swung forward about that frame's left; the forearm forward
      set(f, goals, INDEX[`${side}Shoulder`], IDENTITY);
      const outward = (at: Readonly<Vector3>) => _d.subVectors(at, hips).dot(left) * sign;
      const hip = outward(f.current.position(INDEX[`${side}UpperLeg`])), knee = outward(f.current.position(INDEX[`${side}LowerLeg`]));
      const thigh = Math.max(hip, knee);
      const handY = f.current.position(INDEX[`${side}UpperArm`]).y - p.armLength;
      const rest = _w.copy(hips).addScaledVector(left, sign * (thigh + CLEAR * p.height)).setY(handY);
      clearArm(h, f, side, rest, yaw);
      const clear = (outward(rest) - outward(f.prev.position(INDEX[`${side}UpperArm`]))) / p.armLength;
      const out = Math.max(ABDUCTION, Math.asin(clamp(clear, -1, 1)));
      const swung = _h.setFromAxisAngle(X, -a), lifted = _p.setFromAxisAngle(Z, -sign * (Math.PI / 2 - out));
      const hang = _q.setFromAxisAngle(Y, yaw).multiply(swung).multiply(lifted);
      // (the hanging pose kept out of the trunk as it turns — the hand forward, the elbow as it swings — and then followed)
      const limb = [INDEX[`${side}UpperArm`], INDEX[`${side}LowerArm`], INDEX[`${side}Hand`]];
      f.current.setLocal(limb[0], hang.premultiply(_h.copy(f.current.rotation(INDEX[`${side}Shoulder`])).invert()));
      f.current.setLocal(limb[1], _q.setFromAxisAngle(Y, -sign * flex));
      f.current.setLocal(limb[2], IDENTITY);
      keepArmOut(f, p, side, { position: _hung.copy(f.current.position(limb[2])) }, { ...NUDGED, swivel: 0 });
      const kept = limb.map((bone) => f.current.local(bone).clone());
      limb.forEach((bone, k) => set(f, goals, bone, kept[k]));
    });
  };
}

/** Keep a resting wrist outside equipment worn beside it, using the same padding as the thigh, judged facing `yaw` (default: the pelvis's). */
export function clearArm(h: Reacher, f: Frame, side: Side, at: Vector3, yaw = yawOf(f.current.local(0))): Vector3 {
  const sign = side === 'left' ? 1 : -1, hips = f.current.position(0);
  const inverse = _r.setFromAxisAngle(Y, -yaw);
  const local = _rest.subVectors(at, hips).applyQuaternion(inverse);
  const pad = CLEAR * h.proportions.height;
  let out = sign * local.x;
  for (const thing of h.worn) {
    if (f.current.skeleton.chain(`${side}Arm`).includes(hangsFrom(h, thing.object))) continue;
    const placed = h.track(thing.object).at(f.time).current;
    const position = _d.subVectors(placed.position, hips).applyQuaternion(inverse);
    const rotation = _q.copy(inverse).multiply(placed.quaternion);
    const box = _box.copy(thing.bounds).applyMatrix4(_matrix.compose(position, rotation, ONE));
    if (local.y < box.min.y - pad || local.y > box.max.y + pad || local.z < box.min.z - pad || local.z > box.max.z + pad) continue;
    out = Math.max(out, (sign > 0 ? box.max.x : -box.min.x) + pad);
  }
  return at.addScaledVector(leftOf(yaw, _left), sign * (out - sign * local.x));
}

/** joint `bone` turned on from its history toward `goal` (its own motion followed) */
function set(f: Frame, joints: Map<number, TrackedRotation>, bone: number, goal: Quaternion) {
  let joint = joints.get(bone);
  if (!joint) joints.set(bone, (joint = new TrackedRotation()));
  const q = joint.follow(f.prev2.local(bone), f.prev.local(bone), goal, SWING, f.dt, _r);
  const limit = f.current.skeleton.limits[bone];
  if (limit) clampRotation(q, limit);
  f.current.setLocal(bone, q);
}

/** Tuned: how briskly a holding hand keeps to its grip as the thing or the body moves (m/s², m/s, rad/s², rad/s): a firm hold, far
 * quicker than a reach, so it never trails what it holds */
export const HOLD = { accel: 30, speed: 3, turnAccel: 200, turnSpeed: 15 };

/** How a person's hand goes to its target. */
export interface HandOptions extends Partial<Motion> {
  /** the target is on this frame (a thing's, tracked), in its frame: the hand goes with it */
  on?: Carrier;
  /** the thing that frame is, if it is one */
  thing?: Thing;
  /** where the elbow bends toward (world; default as where the hand is asks: down and back hanging, out reaching across, …) */
  pole?: Live<Vector3>;
  /**
   * the body comes along for a target out of the arm's reach: it bows and squats for one low, goes up on its toes for one high (default
   * true); false: the hand only follows (a tracked controller: the head leads)
   */
  lead?: boolean;
  /** a reach that takes this long (s): the hand goes along a minimum-jerk path to the target (a bell of speed), then stays on it */
  seconds?: number;
  /** with `seconds`: the reach sets off this long after (s), the arm kept as it is till then */
  after?: number;
}

/**
 * Hand `side`'s wrist (and, given its rotation, the hand) to `target`, a sub-step at a time: the hand moving on from its history at
 * `Motion`'s pace (calm by default) — or, given `seconds`, along a minimum-jerk path there in that time — its arm solved to it and
 * braked; the clavicle shrugging for a hand up high and drawn forward for one far out; the elbow swivelled as where the hand is asks.
 * Leading (by default), a target below what the arm reaches standing asks balance to bow and bend the knees for it, one above to go up
 * on the toes.
 */
export function reaching(h: Reacher, side: Side, target: Live<Goal>, options: HandOptions = {}): Step {
  const { seconds, after = 0 } = options;
  const arm = new ChainTip(`${side}Arm`);
  // (gliding: set off once the hand need not wait for the body, in what is left of the reach's time — at least half of it)
  let glide: Glide | null = null, waited = 0;
  const bone = INDEX[`${side}Hand`];
  let waiting = after;
  // (waiting, the arm's joints kept as they were when it began, come to rest there: the hand
  // stays where it is on the body, neither dropped to its hang nor taken up by the arm's solve)
  let kept: [number, Quaternion][] | null = null;
  const joints = new Map<number, TrackedRotation>();
  // (gliding: as the arm stood when the hand set off — where the elbow was from the shoulder, in the
  // chest's frame; the clavicle — and how far the hand had to go)
  let start: { elbow: Vector3; clavicle: Quaternion; off: number } | null = null;
  return (f) => {
    const goal = live(target, f);
    if (seconds === undefined) {
      let wait: Vector3 | null = null;
      if (!options.on && !h.locomotion.settled) {
        const near = elbowPole(f, h.proportions, side, goal.position, _spare);
        wait = waitingFor(f.current, h.proportions, side, f.prev.position(bone), goal.position, near, _wait);
      }
      // (the shoulder and the body still go for the goal itself)
      const toward = wait ? { at: goal.position, clavicle: f.prev.local(INDEX[`${side}Shoulder`]), share: 1 } : undefined;
      return void handStep(h, f, side, wait ? { position: wait } : goal, options, arm, toward);
    }
    if (waiting > 0) {
      waiting -= f.dt;
      kept ??= ARM.map((b) => [INDEX[`${side}${b}`], f.prev.local(INDEX[`${side}${b}`]).clone()]);
      for (const [b, q] of kept) set(f, joints, b, q);
      return;
    }
    // (the hand gliding to the target from where it is and how it moves: on what the body itself wears or holds, in its
    // frame — the body moves that, so its turning or speeding up never leaves the hand behind — else in the world, the
    // target's own motion fed forward)
    const on = options.on;
    const own = options.thing && onBody(h, options.thing) ? on : undefined;
    const placed = own?.at(f.time);
    const world = on
      ? { ...on.toWorld(goal, _world, f.time), axis: goal.axis && _axis.copy(goal.axis).applyQuaternion(on.current.quaternion) }
      : { ...goal, velocity: goal.velocity ?? ZERO };
    const aim = placed ? { ...goal, velocity: goal.velocity ?? ZERO } : world;
    const from = _from.copy(f.prev.position(bone)), was = _was.copy(f.prev2.position(bone));
    if (placed) {
      toFrame(placed.prev, from);
      toFrame(placed.prev2, was);
    }
    // (gliding round the trunk to a goal in its way: to where it is moved clear of it, the elbow as the reach would have it there)
    const end = _end.copy(aim.position);
    const near = placed ? null : elbowPole(f, h.proportions, side, end, _spare);
    if (near) clearWrist(f.current, h.proportions, side, end, near, _spare);
    // (a goal behind the shoulder or round across the body while the body turns to it, or the hand still behind its shoulder for a
    // goal toward the other side: the hand waits in front, going round with the trunk, and sets off on its own way — the reach's
    // time from then — once it may)
    const turning = near && !h.locomotion.settled && !start;
    const wait = turning ? waitingFor(f.current, h.proportions, side, f.prev.position(bone), aim.position, near, _wait) : null;
    if (wait) {
      waited += f.dt;
      const toward = { at: world.position, clavicle: f.prev.local(INDEX[`${side}Shoulder`]), share: 1 };
      return void handStep(h, f, side, { position: wait }, { ...options, on: undefined }, arm, toward);
    }
    glide ??= new Glide(Math.max(seconds / 2, seconds - waited));
    glide.step(from, _m.subVectors(from, was).divideScalar(f.dt), end, aim.velocity ?? ZERO, f.dt, _glided);
    // (the arm as it stood when the hand set off — its clavicle, where its elbow pointed — turning
    // to what the reach wants as the hand goes: aimed at once where the hand goes, the solve would
    // swing the arm round, drawing the hand back, before it sets off)
    const shoulder = f.current.position(INDEX[`${side}UpperArm`]);
    const chest = f.current.rotation(INDEX.chest);
    if (!start) {
      const elbow = f.prev.position(INDEX[`${side}LowerArm`]).clone().sub(f.prev.position(INDEX[`${side}UpperArm`]));
      start = {
        elbow: elbow.applyQuaternion(_c.copy(f.prev.rotation(INDEX.chest)).invert()),
        clavicle: f.prev.local(INDEX[`${side}Shoulder`]).clone(),
        off: _glided.position.distanceTo(aim.position),
      };
    }
    const share = start.off > 1e-6 ? smoothstep(0, 1, 1 - _glided.position.distanceTo(aim.position) / start.off) : 1;
    const elbow = start.elbow;
    const bent = () => _bend.copy(elbow).applyQuaternion(chest).add(shoulder);
    const pole = options.pole === undefined ? elbowPole(f, h.proportions, side, world.position, _pole).lerp(bent(), 1 - share) : live(options.pole, f);
    const glided = { ...aim, position: _glided.position, velocity: _glided.velocity };
    const toward = { at: world.position, center: on?.current.position, clavicle: start.clavicle, share };
    handStep(h, f, side, glided, { ...options, on: own, pole }, arm, toward);
  };
}

/** where a hand's shoulder and body go while it glides or waits: toward `at` (or `center`), the clavicle from `clavicle` by `share` */
interface Toward {
  at: Readonly<Vector3>;
  center?: Readonly<Vector3>;
  clavicle: Readonly<Quaternion>;
  share: number;
}

/** one sub-step of `handTo`, its arm's tip `arm` */
export function handStep(h: Reacher, f: Frame, side: Side, target: Goal, options: HandOptions, arm: ChainTip, toward?: Toward) {
  // A grip attached to this arm follows the arm; solving the arm after that grip chases itself.
  if (options.thing && f.current.skeleton.chain(`${side}Arm`).includes(hangsFrom(h, options.thing.object))) return;
  const p = h.proportions;
  const at = options.on ? options.on.toWorld(target, _target, f.time).position : target.position;
  shrug(f, p, side, toward?.at ?? at, toward);
  const pole = options.pole === undefined ? elbowPole(f, p, side, at, _pole) : live(options.pole, f);
  // (gliding from where the hand is: an arm hanging all but straight is not drawn in at once)
  // (a goal in the trunk's way moved round it before the hand sets off for it, so its path goes round too; and how far the trunk holds
  // the hand off it)
  // (the elbow as the reach would have it there)
  let held = Math.max(0, clearWrist(f.current, p, side, _cleared.copy(at), elbowPole(f, p, side, at, _spare), _spare));
  if (held > 0) {
    const shift = _cleared.sub(at);
    const on = options.on;
    const position = on ? shift.applyQuaternion(_frame.copy(on.current.quaternion).invert()).add(target.position) : shift.add(at);
    target = { ...target, position };
  }
  // (a grip held, as a reach setting off, is let out as far as the arm hangs: a hand holding something by an arm all but straight —
  // a rifle taken up from a hanging hand — is not drawn off its grip)
  const contact = options.thing !== undefined && options.thing === h.holding[side]?.thing;
  arm.to(f, target, {
    ...CALM,
    ...options,
    pole,
    contact,
    letOut: toward !== undefined || contact,
    clear: (g, tip, braked) => {
      held = Math.max(held, keepArmOut(g, p, side, tip, braked ? NUDGED : SOLVED(p)));
    },
  });
  // The body joins a glide with the hand, rather than moving for its starting hang.
  if (options.lead ?? true) {
    // (the thing's weight once the hand follows it — a glide toward it from afar, moving in the world, does not yet bear it)
    const mass = options.on && options.thing ? options.thing.mass : 0, carried = target.carriedBy === h || options.on?.carriedBy === h;
    bringShoulder(h, f, side, toward?.at ?? at, toward?.share ?? 1, mass, carried);
    const goal = options.on?.current.position ?? toward?.center ?? toward?.at ?? at;
    twistToward(h, f.current, goal, toward?.share ?? 1, held);
  }
}

/**
 * the clavicle (chest-relative) turned so the shoulder joint goes up for a hand high up and forward
 * toward one far out
 */
function shrug(f: Frame, p: Proportions, side: Side, hand: Readonly<Vector3>, from?: { clavicle: Readonly<Quaternion>; share: number }) {
  const pose = f.current;
  const bone = INDEX[`${side}Shoulder`];
  const clavicle = pose.position(bone);
  const chest = pose.rotation(INDEX.chest);
  const shoulder = _s.copy(pose.position(INDEX[`${side}UpperArm`]));
  const up = _up.set(0, 1, 0).applyQuaternion(chest);
  const L = p.armLength;
  // (a hand across the body draws the shoulder forward, never back: the arm goes round the front)
  const v = _d.subVectors(hand, shoulder).applyQuaternion(_c.copy(chest).invert());
  if ((side === 'left' ? 1 : -1) * _w.subVectors(hand, pose.position(INDEX.chest)).applyQuaternion(_c).x < 0) v.z = Math.max(0, v.z);
  v.applyQuaternion(chest);
  const elevation = smoothstep(-0.05, 0.6, v.dot(up) / L);
  const reach = v.length();
  const want = shoulder.addScaledVector(up, elevation * 0.03 * p.height);
  if (reach > 1e-6) want.addScaledVector(v, clamp(reach - 0.85 * L, 0, PROTRACTION * p.height) / reach);
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
 * forward, up, out and across, in the chest's frame (up, the elbow out to the side:
 * forward, the arm near straight overhead would swivel to and fro)
 */
function elbowPole(f: Frame, p: Proportions, side: Side, hand: Readonly<Vector3>, out: Vector3): Vector3 {
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

/** `world` into the frame of a carrier placed `at` */
function toFrame(at: Placement, world: Vector3): Vector3 {
  return world.sub(at.position).applyQuaternion(_frame.copy(at.quaternion).invert());
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
const _cleared = new Vector3(), _spare = new Vector3(), _end = new Vector3(), _hung = new Vector3();
const _bend = new Vector3();
const _world: Goal & { velocity: Vector3; spin: Vector3 } = { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() };
const _target: Goal & { velocity: Vector3; spin: Vector3 } = { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() };
const _m = new Vector3();
const _axis = new Vector3();
const _from = new Vector3();
const _was = new Vector3();
const _frame = new Quaternion();
const _glided = { position: new Vector3(), velocity: new Vector3() };
const _wait = new Vector3();
const ZERO = new Vector3();

const _box = new Box3();
const _matrix = new Matrix4();
const ONE = new Vector3(1, 1, 1);
