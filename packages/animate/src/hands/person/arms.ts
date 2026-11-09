import { MathUtils, Quaternion, Vector3 } from 'three';
import type { Frame, Step } from '../../kernel/frame';
import { Carrier } from '../../kernel/carrier';
import { followRotation, toLocal } from '../../kernel/follow';
import { Glide } from '../../kernel/glide';
import { type Live, type Motion, type Goal } from '../../kernel/goal';
import { limited } from '../../kernel/limits';
import { ChainTip } from '../../kernel/tip';
import { solveChain } from '../../kernel/chain';
import { TrackedRotation } from '../../kernel/track';
import { INDEX, type Side } from '../../species/humanoid/bones';
import type { Reacher } from './reacher';
import { Pose, type ReadonlyPose } from '../../kernel/pose';
import type { Thing } from '../../things/thing';
import { boneOf, onBody } from '../../things/hold';
import { bringShoulder, liftFor, twistToward } from './bend';
import { clearWrist, keepArmOut, NUDGED, SOLVED, waitingFor } from './trunk';
import { followJoint } from './hang';
import type { Proportions } from '../../species/humanoid/proportions';
import { palmOf } from '../../species/humanoid/landmarks';

// A hand going somewhere: its arm solved onto a timed glide or a pace, the clavicle and the trunk joining it, kept out of the trunk.

/** calm, everyday motion of a hand (Herneth 2024): how a hand moves unless asked otherwise, its joints braked at ~6× a reach's peak */
export const CALM = { accel: 8, speed: 1.5, turnAccel: 60, turnSpeed: 10 } satisfies Motion;
/** how many times `shrug` draws the shoulder joint on toward the hand, round the clavicle, to settle where it goes (within a millimetre) */
const DRAWS = 4;
/** how far out a hand is (of the arm's length, from the shoulder) before the clavicle draws the shoulder toward it */
const DRAWN = 0.85;
/** how fast the clavicle moves (rad/s²) */
const CLAVICLE = { accel: 30 };

/** Tuned: how briskly a holding hand keeps to its grip (m/s², m/s, rad/s², rad/s): far quicker than a reach, so it never trails it */
export const HOLD = { accel: 30, speed: 3, turnAccel: 200, turnSpeed: 15 };

/** How a person's hand goes to its target. */
interface HandOptions extends Partial<Motion> {
  /** the target is on this frame (a thing's, tracked), in its frame: the hand goes with it */
  on?: Carrier;
  /** the thing that frame is, if it is one */
  thing?: Thing;
  /** where the elbow bends toward (world; default as where the hand is asks: down and back hanging, out reaching across, …) */
  pole?: Vector3;
  /** the body comes along for a target out of the arm's reach: it bows and squats for one low, goes up on its toes for one high (default
   * true); false: the hand only follows (a tracked controller: the head leads) */
  lead?: boolean;
  /** a reach that takes this long (s): the hand goes along a minimum-jerk path to the target (a bell of speed), then stays on it */
  seconds?: number;
  /** with `seconds`: the reach sets off this long after (s), the arm kept as it is till then */
  after?: number;
  /** with `seconds`: the glide keeps to the straight line to its target, setting off with only the part of the hand's motion along it (a
   * way round something, whose legs the hand must not cut across) */
  straight?: boolean;
}

/** Reach by a timed glide or pace, borrowing posture when leading. */
export function reaching(person: Reacher, side: Side, target: Live<Goal>, options: HandOptions = {}): Step {
  const seconds = options.seconds, arm = new ChainTip(`${side}Arm`), bone = INDEX[`${side}Hand`];
  let glide: Glide | null = null, waited = 0, waiting = options.after ?? 0;
  // (waiting, the arm's joints kept as they were when it began: the hand neither dropped to its hang nor taken up by the arm's solve)
  let kept: [number, Quaternion][] | null = null;
  const joints = new Map<number, TrackedRotation>();
  let start: { elbow: Vector3; clavicle: Quaternion; off: number } | null = null;
  // (the hand turned on from how it set off as far as it has come toward its goal (`at`, the world's), in the frame of `on`: tied to the
  // hand's way, its turn arrives with it however fast it goes, rather than trailing it at its own pace)
  let setOff: { off: number; turn: Quaternion } | null = null;
  const turnedOn = (f: Frame, goal: Goal, at: Readonly<Vector3>, on?: Carrier): Goal => {
    if (!goal.quaternion) return goal;
    const placed = on?.at(f.time), off = f.prev.position(bone).distanceTo(at);
    setOff ??= { off, turn: placed ? placed.prev.quaternion.clone().invert().multiply(f.prev.rotation(bone)) : f.prev.rotation(bone).clone() };
    const share = setOff.off > 1e-6 ? MathUtils.smoothstep(1 - off / setOff.off, 0, 1) : 1;
    return { ...goal, quaternion: _gliding.copy(setOff.turn).slerp(goal.quaternion, share) };
  };
  return (f) => {
    const goal = typeof target === 'function' ? target(f) : target;
    if (seconds === undefined) {
      let wait: Vector3 | null = null;
      if (!options.on && !person.locomotion.settled) {
        const near = elbowPole(f.current, person.proportions, side, goal.position, _spare);
        wait = waitingFor(f.current, person.proportions, side, f.prev.position(bone), goal.position, near, _wait);
      }
      // (the shoulder and the body still go for the goal itself)
      const toward = wait ? { at: goal.position, clavicle: f.prev.local(INDEX[`${side}Shoulder`]), share: 1 } : undefined;
      const at = options.on ? options.on.toWorld(goal, _world, f.time).position : goal.position;
      // (its turn, eased on with the hand's way, followed as briskly as a held hand's, so it does not lag the hand)
      return void handStep(person, f, side, wait ? { position: wait } : turnedOn(f, goal, at, options.on), { turnAccel: HOLD.turnAccel, turnSpeed: HOLD.turnSpeed, ...options }, arm, toward);
    }
    if (waiting > 0) {
      waiting -= f.dt;
      kept ??= ARM.map((b) => [INDEX[`${side}${b}`], f.prev.local(INDEX[`${side}${b}`]).clone()]);
      for (const [b, q] of kept) followJoint(f, joints, b, q);
      keepArmOut(f, person.proportions, side, { position: f.current.position(bone).clone() }, NUDGED);
      return;
    }
    // (the hand gliding to the target from where it is and how it moves: on what the body itself wears or holds, in its frame — the body
    // moves that, so its turning never leaves the hand behind — else in the world, the target's own motion fed forward)
    const on = options.on;
    const own = options.thing && onBody(person, options.thing) ? on : undefined;
    const placed = own?.at(f.time);
    const world = on ? on.toWorld(goal, _world, f.time) : { ...goal, velocity: goal.velocity ?? ZERO };
    const aim = placed ? { ...goal, velocity: goal.velocity ?? ZERO } : world;
    const from = _from.copy(f.prev.position(bone)), was = _was.copy(f.prev2.position(bone));
    if (placed) {
      toLocal(placed.prev, from);
      toLocal(placed.prev2, was);
    }
    const end = _end.copy(aim.position);
    const near = placed ? null : elbowPole(f.current, person.proportions, side, end, _spare);
    const held = near ? Math.max(0, clearWrist(f.current, person.proportions, side, end, near, _spare)) : 0;
    // (a goal behind the shoulder or round across the body while the body turns to it, or the hand behind its shoulder for one toward the
    // other side: the hand waits in front, going round with the trunk, and sets off — the reach's time from then — once it may)
    const turning = near && !person.locomotion.settled && !start;
    const wait = turning ? waitingFor(f.current, person.proportions, side, f.prev.position(bone), aim.position, near, _wait) : null;
    if (wait) {
      waited += f.dt;
      const toward = { at: world.position, clavicle: f.prev.local(INDEX[`${side}Shoulder`]), share: 1 };
      return void handStep(person, f, side, { position: wait }, { ...options, on: undefined }, arm, toward);
    }
    glide ??= new Glide(Math.max(seconds / 2, seconds - waited));
    const moving = _m.subVectors(from, was).divideScalar(f.dt);
    if (options.straight) {
      const line = _line.subVectors(end, from), length = line.length();
      moving.copy(length > 1e-9 ? line.multiplyScalar(Math.max(0, moving.dot(line) / length) / length) : ZERO);
    }
    glide.step(from, moving, end, aim.velocity ?? ZERO, f.dt, _glided);
    // (the arm as it stood when the hand set off turning to what the reach wants as the hand goes: aimed at once where the hand goes,
    // the solve would swing the arm round, drawing the hand back, before it sets off)
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
    const share = start.off > 1e-6 ? MathUtils.smoothstep(1 - _glided.position.distanceTo(aim.position) / start.off, 0, 1) : 1;
    const bent = _bend.copy(start.elbow).applyQuaternion(chest).add(shoulder);
    // (onto a thing, the elbow set off as it stood keeps the hand on a grip moving fast; to a point, the elbow goes as a reach there
    // bends it, since an elbow held to where it set off cannot follow a hand swept across the body within the shoulder's range)
    const reached = elbowPole(f.current, person.proportions, side, world.position, _pole);
    const pole = options.pole ?? (options.thing ? reached.lerp(bent, 1 - share) : reached);
    const glided = turnedOn(f, { ...aim, position: _glided.position, velocity: _glided.velocity }, world.position, own);
    const toward = { at: world.position, center: on?.current.position, clavicle: start.clavicle, share, held };
    handStep(person, f, side, glided, { ...options, on: own, pole }, arm, toward);
  };
}

/** where a hand's shoulder and body go while it glides or waits: toward `at` (or `center`), the clavicle from `clavicle` by `share`;
 * the trunk turning as far as it holds the hand off `at` (`held`, m: the glide's end moved round it) */
interface Toward {
  at: Readonly<Vector3>;
  center?: Readonly<Vector3>;
  clavicle: Readonly<Quaternion>;
  share: number;
  held?: number;
}

/** one sub-step of `reaching`, its arm's tip `arm` */
export function handStep(person: Reacher, f: Frame, side: Side, target: Goal, options: HandOptions, arm: ChainTip, toward?: Toward) {
  // A grip attached to this arm follows the arm; solving the arm after that grip chases itself.
  if (options.thing && f.current.skeleton.chain(`${side}Arm`).includes(boneOf(person, options.thing.object))) return;
  const proportions = person.proportions;
  const at = options.on ? options.on.toWorld(target, _target, f.time).position : target.position;
  shrug(f, proportions, side, toward?.at ?? at, toward);
  const pole = options.pole === undefined ? elbowPole(f.current, proportions, side, at, _pole) : options.pole;
  // (a hand asked a turn is judged on from the wrist as turned, not along the forearm: a buckle held to the belly, the wrist beside it)
  const turn = target.quaternion && (options.on ? _turnAt.copy(options.on.current.quaternion).multiply(target.quaternion) : target.quaternion);
  const along = turn && _along.copy(palmOf(proportions, side)).normalize().applyQuaternion(turn);
  let held = Math.max(toward?.held ?? 0, clearWrist(f.current, proportions, side, _cleared.copy(at), elbowPole(f.current, proportions, side, at, _spare), _spare, along));
  if (held > 0) {
    const shift = _cleared.sub(at);
    const on = options.on;
    const position = on ? shift.applyQuaternion(_frame.copy(on.current.quaternion).invert()).add(target.position) : shift.add(at);
    target = { ...target, position };
  }
  // (a grip held, as a reach setting off, is let out as far as the arm hangs: a hand holding something by an arm all but straight —
  // something long taken up from a hanging hand — is not drawn off its grip)
  const contact = options.thing !== undefined && options.thing === person.holding[side]?.thing;
  // (a goal in the world followed from the shoulder the arm hangs from (`shoulderOf`), its own motion fed forward as seen from there: the
  // trunk carries the arm and the hand's brakes act on its own way only — followed in the world at a hand's 8 m/s², a hand gliding to a
  // box as the body squatted to it hung back in the air as the shoulder dropped past it, 0.7 m off its way, the arm swung out level)
  const shoulder = options.on ? undefined : shoulderOf(person, f, side);
  arm.to(f, shoulder ? shoulder.toLocal(target, _tipGoal, f.time) : target, {
    ...CALM,
    ...options,
    on: options.on ?? shoulder,
    pole,
    contact,
    // (a hand carrying what hangs from it keeps the arm's fit as it holds it, unless another is clearly better, and swivels on from it
    // continuously: two fits about as good would otherwise take turns as the goal moves on, swinging the elbow and what is in the hand; a
    // hand on a thing something else moves is put back on it after its brakes, `contact`)
    keep: Boolean(person.holding[side]) && !contact,
    letOut: toward !== undefined || contact,
    clear: (frame, tip, braked) => {
      held = Math.max(held, keepArmOut(frame, proportions, side, tip, braked ? NUDGED : SOLVED(proportions)));
    },
  });
  // The body joins a glide with the hand, rather than moving for its starting hang.
  if (options.lead ?? true) {
    // (the thing's weight once the hand follows it — a glide toward it from afar, moving in the world, does not yet bear it)
    const mass = options.on && options.thing ? options.thing.mass : 0, carried = target.carriedBy === person || options.on?.carriedBy === person;
    bringShoulder(person, f, side, toward?.at ?? at, toward?.share ?? 1, mass, carried);
    // (the trunk turns toward the middle of the thing the hands hold on to; a hand only riding on a carrier — what hangs from it carried
    // — toward where the hand goes, since the thing's origin may lie far from the hand)
    const goal = (options.thing ? options.on?.current.position : undefined) ?? toward?.center ?? toward?.at ?? at;
    twistToward(person, f.current, goal, toward?.share ?? 1, held, carried);
  }
}

/** arm `side` posed onto `goal` (world) at once, its elbow bent the way a reach there bends it */
export function placeArm(person: Reacher, f: Pick<Frame, 'current'>, side: Side, goal: Goal): void {
  solveChain(f, `${side}Arm`, { tip: { position: goal.position, quaternion: goal.quaternion }, pole: elbowPole(f.current, person.proportions, side, goal.position, _pole) });
}

/**
 * the clavicle (chest-relative) turned as the hand asks of it now: the shoulder joint up for a hand high up, and toward a hand beyond `DRAWN`
 * of the arm as far as brings it within that (its range permitting) — settled on from where the clavicle at rest has it each sub-step, as
 * the shoulder joint swings round the clavicle's length (not from where it stands: each sub-step's lift would add to the last's, to the end
 * of its range).
 */
function shrug(f: Frame, proportions: Proportions, side: Side, hand: Readonly<Vector3>, from?: { clavicle: Readonly<Quaternion>; share: number }) {
  const pose = f.current;
  const bone = INDEX[`${side}Shoulder`];
  const clavicle = pose.position(bone);
  const chest = pose.rotation(INDEX.chest);
  const inverse = _c.copy(chest).invert();
  const offset = proportions.offsets[`${side}UpperArm`], length = offset.length();
  const up = _up.set(0, 1, 0).applyQuaternion(chest);
  const L = proportions.armLength;
  const want = _s.copy(offset).applyQuaternion(chest).add(clavicle);
  want.addScaledVector(up, liftFor(proportions, side, _d.subVectors(hand, want).dot(up)));
  // (a hand across the body draws the shoulder forward, never back: the arm goes round the front)
  const across = (side === 'left' ? 1 : -1) * _w.subVectors(hand, pose.position(INDEX.chest)).applyQuaternion(inverse).x < 0;
  for (let pass = 0; pass < DRAWS; pass++) {
    const v = _d.subVectors(hand, want).applyQuaternion(inverse);
    if (across) v.z = Math.max(0, v.z);
    const reach = v.length();
    if (reach <= DRAWN * L) break;
    want.addScaledVector(v.applyQuaternion(chest), (reach - DRAWN * L) / reach).sub(clavicle).setLength(length).add(clavicle);
  }
  const to = want.sub(clavicle).applyQuaternion(_c.copy(chest).invert()).normalize();
  const goal = _g.setFromUnitVectors(_rest.copy(proportions.offsets[`${side}UpperArm`]).normalize(), to);
  if (from) goal.slerpQuaternions(from.clavicle, _q.copy(goal), from.share);
  limited(pose.skeleton, bone, goal);
  const q = followRotation(f.prev2.local(bone), f.prev.local(bone), goal, CLAVICLE, f.dt, _r);
  pose.setLocal(bone, limited(pose.skeleton, bone, q));
}

/** Blend elbow poles in the chest frame and return `out` in world coordinates. Overhead, prefer outward: a forward pole makes a nearly straight arm swivel. */
export function elbowPole(pose: ReadonlyPose, proportions: Proportions, side: Side, hand: Readonly<Vector3>, out: Vector3): Vector3 {
  const sign = side === 'left' ? 1 : -1;
  const shoulder = pose.position(INDEX[`${side}UpperArm`]);
  const chest = _c.copy(pose.rotation(INDEX.chest));
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
  return out.applyQuaternion(chest).setLength(proportions.upperArm).add(shoulder);
}

/** an arm's joints, from the clavicle out */
/**
 * How the arm brings hand `side` to have its palm at `at` (world): the hand bone's turn (world, into `out`) with the arm posed onto it
 * from `pose` on `scratch` — its elbow bent the way a reach there bends it, the forearm and the wrist unturned, as a hanging arm's are
 */
export function broughtTurn(person: Reacher, pose: ReadonlyPose, side: Side, at: Readonly<Vector3>, scratch: Pose, out: Quaternion): Quaternion {
  scratch.copy(pose);
  const proportions = person.proportions, hand = INDEX[`${side}Hand`], palm = palmOf(proportions, side), wrist = _wrist;
  // (the wrist a palm back from `at` along the hand as the last pass turned it: two more passes bring it within a millimetre)
  for (let pass = 0; pass < 3; pass++) {
    scratch.setLocal(hand, IDENTITY);
    wrist.copy(palm).applyQuaternion(scratch.rotation(hand)).negate().add(at);
    solveChain({ current: scratch }, `${side}Arm`, { tip: { position: wrist }, pole: elbowPole(scratch, proportions, side, wrist, _pole) });
  }
  return out.copy(scratch.rotation(hand));
}

/** for each body, poses to try an arm on: as the arm brings the hand to a carry's end, and each grasp tried from there */
const scratches = new WeakMap<Reacher, { brought: Pose; trial: Pose }>();
export function scratch(person: Reacher): { brought: Pose; trial: Pose } {
  let poses = scratches.get(person);
  const skeleton = person.frame.prev.skeleton;
  if (!poses) scratches.set(person, (poses = { brought: new Pose(skeleton), trial: new Pose(skeleton) }));
  return poses;
}

const ARM = ['Shoulder', 'UpperArm', 'LowerArm', 'Hand'] as const;
const ZERO = new Vector3(), IDENTITY = new Quaternion();
const _q = new Quaternion(), _r = new Quaternion(), _c = new Quaternion(), _g = new Quaternion(), _frame = new Quaternion();
const _s = new Vector3(), _d = new Vector3(), _w = new Vector3(), _up = new Vector3(), _rest = new Vector3(), _pole = new Vector3();
const _cleared = new Vector3(), _spare = new Vector3(), _end = new Vector3(), _bend = new Vector3(), _m = new Vector3(), _line = new Vector3();
const _from = new Vector3(), _was = new Vector3(), _wait = new Vector3(), _along = new Vector3();
const _tipGoal: Goal & { velocity: Vector3; spin: Vector3 } = { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() };
const shoulders = new WeakMap<Reacher, Record<Side, Carrier>>();
const _turnAt = new Quaternion(), _gliding = new Quaternion(), _wrist = new Vector3();
const _world: Goal & { velocity: Vector3; spin: Vector3 } = { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() };
const _target: Goal & { velocity: Vector3; spin: Vector3 } = { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() };
const _glided = { position: new Vector3(), velocity: new Vector3() };

/**
 * where arm `side` of `person` hangs from as a frame its hand is carried in: the shoulder's root as the trunk moves it, unturned — the arm
 * hangs from the shoulder joint, so the trunk's tilt does not swing it (carried on the chest's turn, a hand as the body bowed to a box swung
 * up out in front as if the arm were fixed to the chest). Placed as the pose's last sub-steps had it, the first time it is read each
 * sub-step, so its motion is the shoulder's however long it went unread (moved only when read, a hand set off from the hang read its
 * walking speed as its own and was flung out in front).
 */
function shoulderOf(person: Reacher, f: Frame, side: Side): Carrier {
  const bone = INDEX[`${side}Shoulder`], at = f.current.position(bone);
  let carriers = shoulders.get(person);
  if (!carriers) shoulders.set(person, (carriers = { left: new Carrier(at), right: new Carrier(at) }));
  const shoulder = carriers[side];
  if (!shoulder.moved(f.time)) shoulder.trace(f.time, f.prev2.position(bone), f.prev.position(bone), at);
  return shoulder;
}
