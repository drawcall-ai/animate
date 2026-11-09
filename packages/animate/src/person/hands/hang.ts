import { MathUtils, Box3, Matrix4, Quaternion, Vector3 } from 'three';
import type { Frame, Behaviour } from '../../kernel/frame';
import { limited } from '../../kernel/limits';
import { TrackedRotation } from '../../kernel/tracked';
import { INDEX, SIDES, type Side } from '../anatomy/bones';
import type { Thing } from '../../things/thing';
import { boneOf } from '../../things/hold';
import { ArmClear, checkArms, keepArmOut, NUDGED } from './arm-clearance';
import { clamp, leftOf, lerp, wrapAngle, yawOf } from '../../kernel/math';
import type { Proportions } from '../anatomy/proportions';
import { palmOf } from '../anatomy/landmarks';
import { bowAhead } from '../legs/walk-pose';
import type { Person } from '../person';

// A free arm: it hangs from the shoulder, swings with the stride, turns back with the trunk's bow and is posed over that as asked.

/** how far through a step the arm's swing leads it, walking and running (the arm furthest forward with the other thigh), the forearm
 * behind it (share of a step; CMU mocap) */
const LEAD = { walk: 0.2, run: -0.12, forearm: -0.14 };
/** a relaxed arm hangs out from the side (rad; 5–12°, Collins 2009) */
const ABDUCTION = (8 * Math.PI) / 180;
/**
 * How a free arm hangs as the trunk bows (`drawnBack`). A formal standing bow keeps the hands at the sides of the legs, along the
 * trouser seams, as drill's attention does; as a bow deepens the hands slide down the thighs toward the knees, and a relaxed stoop (a toe
 * touch, a stooped lift) lets the arms hang plumb. So the arm turns back at the shoulder as far as keeps the palm beside the thigh as the
 * shoulder comes ahead of the hip, but for a share (`DRAPED`) of that it slides down the thigh's front — a centimetre or so in a moderate
 * bow, whatever the build's arms — and past a formal bow's depth (`STOOP.from`, rad) it hangs toward the plumb, all plumb at `STOOP.to`
 * (the deepest formal bow's; a reach's low bow).
 * But not while the other hand works standing: bowed over a table to take something in one hand, the other is held in by the side, its
 * palm by the thigh however deep the bow, not dangled under the shoulder beside what the first hand takes (`held`).
 */
const DRAPED = 0.1, STOOP = { from: 0.5, to: 1.2 };
/**
 * The arm follows that turn as a pendulum hung from the shoulder: recalled, a free arm's natural frequency is ~0.9 Hz, near the walking
 * stride's (Collins et al. 2009 find the swing largely passive); tuned stiffer and damped, as the tone that keeps the hands at the sides
 * holds it (1.5 Hz, 0.7 of critical): a 0.6 rad bow at its full 1.2 rad/s swings the palms ~5 cm ahead of where they settle, for half a
 * second, and back a little behind them rising.
 */
const SWAY = { frequency: 1.5, damping: 0.7 };

/** how far a free arm turns back off the plumb (rad, about the trunk's left) as the trunk bows `bow` (rad, + forward), `held` (0–1) by the
 * side as the other hand works standing: `DRAPED`, `STOOP` */
function drawnBack(proportions: Proportions, bow: number, held: number): number {
  const reach = proportions.armLength + palmOf(proportions, 'left').length();
  const beside = Math.asin(clamp((1 - DRAPED) * bowAhead(proportions, 0, bow, 'shoulder') / reach, -1, 1));
  return beside * (1 - (1 - held) * MathUtils.smoothstep(Math.abs(bow), STOOP.from, STOOP.to));
}

/** how far a hanging hand keeps out past the thigh beside it, from axis to axis (× height): the thigh's and the hand's thickness
 * (mid-thigh 0.034, hand 0.012) and a little air */
const CLEAR = 0.055;
/** how fast a free arm's joints may change their motion (rad/s²) and close in on its pose (rad/s): its swing's own pace, braked where it
 * kinks; let go of, it comes down calmly — and posed, it goes there so */
export const SWING = { accel: 25, speed: 2.5 };
/** how far (rad) a free arm's joint may run on past where a verb left it before its brakes (`SWING.accel`) stop it: what it inherits of
 * that verb's motion, √(2 · accel · this) */
const OVERRUN = Math.PI / 2;

/** Free arms follow their own histories back into stride swing, posed over it as asked (`armPose`, cleared); holding hands keep their grips. */
export function hanging(person: Person): Behaviour {
  const goals = new Map<number, TrackedRotation>(), seen = { left: new ArmClear(), right: new ArmClear() };
  /** whether each arm was another's (a hand verb's, or holding) the sub-step before: taken back, it is carried on no faster than it swings */
  const taken = { left: true, right: true };
  let phase = person.locomotion.phase;
  // (each arm's turn back with the bow (rad) and its rate, swaying after `drawnBack` as `SWAY` has it)
  const start = drawnBack(person.proportions, person.locomotion.bow, 0);
  const back = { left: { angle: start, rate: 0 }, right: { angle: start, rate: 0 } }, omega = 2 * Math.PI * SWAY.frequency;
  return (f) => {
    if (f.dev && f.time > f.dt) checkArms(f.prev, person.proportions, f.time - f.dt, f.dev);
    const locomotion = person.locomotion;
    // Recalled pendulum floor: at least 0.25 s between arm reversals, including entrainment.
    phase += clamp(wrapAngle(locomotion.phase - phase), 0, 4 * Math.PI * f.dt);
    const lead = lerp(LEAD.walk, LEAD.run, locomotion.run);
    const proportions = person.proportions;
    // (running, the arms hang and swing from the shoulders as the stride turns the thorax off the pelvis — not as an asked twist or
    // a turn's lead turns the chest; walking, that turn is small and the arms keep to the pelvis's facing)
    const yaw = yawOf(_h.copy(f.current.local(0))) + locomotion.run * (locomotion.thoraxYaw - locomotion.pelvisYaw);
    const hips = f.current.position(0);
    const left = leftOf(yaw, _left);
    SIDES.forEach((side, s) => {
      const posed = person.armPose[side], { shrug, forward, out: spread, twist, elbow } = posed;
      [posed.shrug, posed.forward, posed.out, posed.twist, posed.elbow] = [0, 0, 0, 0, 0];
      const busy = person.holding[side] !== null || person.owner(`hand.${side}`) !== undefined, handed = taken[side] && !busy;
      taken[side] = busy;
      if (person.holding[side]) return;
      const sign = s === 0 ? 1 : -1;
      // (the left arm in front as the left foot lifts, the right behind; growing in as the walk does)
      const swing = (at: number) => (sign * Math.cos(phase + Math.PI * at) * lerp(0.33, 0.42, locomotion.run) * locomotion.arms + 0.02) * locomotion.walk;
      const a = swing(lead);
      const walked = 0.25 + (0.18 + 0.5 * swing(lead + LEAD.forearm)) * locomotion.walk, ran = 1.5 + 0.3 * swing(lead + LEAD.forearm);
      const flex = lerp(walked, ran, locomotion.run) * (1 - MathUtils.smoothstep(a, 0.6, 1.6)) + elbow;
      // the arm hanging from the shoulder — plumb, but as far back as the bow carries it (held in as the other hand works) — out as far
      // as keeps the hand clear of the thigh beside it (the hip's or the knee's, as the legs stand now) however the trunk bows, leans or
      // twists, swung forward about that frame's left; the forearm forward
      followJoint(f, goals, INDEX[`${side}Shoulder`], shrug === 0 ? IDENTITY : _s2.setFromAxisAngle(Z, sign * shrug), handed);
      const outward = (at: Readonly<Vector3>) => _d.subVectors(at, hips).dot(left) * sign;
      const thigh = Math.max(outward(f.current.position(INDEX[`${side}UpperLeg`])), outward(f.current.position(INDEX[`${side}LowerLeg`])));
      const handY = f.current.position(INDEX[`${side}UpperArm`]).y - proportions.armLength;
      const rest = _w.copy(hips).addScaledVector(left, sign * (thigh + CLEAR * proportions.height)).setY(handY);
      clearArm(person, f, side, rest, yaw);
      const clear = (outward(rest) - outward(f.prev.position(INDEX[`${side}UpperArm`]))) / proportions.armLength;
      // (posed: swung forward, lifted out and twisted about its own length over that, as `ArmPosture` has them)
      const out = Math.max(ABDUCTION, Math.asin(clamp(clear, -1, 1))) + spread;
      const other = SIDES[1 - s], working = person.holding[other] !== null || person.owner(`hand.${other}`) !== undefined;
      const turn = back[side], held = working ? 1 - locomotion.walk : 0;
      turn.rate += (omega ** 2 * (drawnBack(proportions, locomotion.bow, held) - turn.angle) - 2 * SWAY.damping * omega * turn.rate) * f.dt;
      turn.angle += turn.rate * f.dt;
      const swung = _h.setFromAxisAngle(X, turn.angle - a - forward), lifted = _p.setFromAxisAngle(Z, -sign * (Math.PI / 2 - out));
      const hang = _q.setFromAxisAngle(Y, yaw).multiply(swung).multiply(lifted);
      if (twist !== 0) hang.multiply(_t.setFromAxisAngle(X, -twist));
      // (the hanging pose kept out of the trunk as it turns — the hand forward, the elbow as it swings — and then followed)
      const limb = [INDEX[`${side}UpperArm`], INDEX[`${side}LowerArm`], INDEX[`${side}Hand`]];
      f.current.setLocal(limb[0], hang.premultiply(_h.copy(f.current.rotation(INDEX[`${side}Shoulder`])).invert()));
      f.current.setLocal(limb[1], _q.setFromAxisAngle(Y, -sign * flex));
      f.current.setLocal(limb[2], IDENTITY);
      keepArmOut(f, proportions, side, { position: _hung.copy(f.current.position(limb[2])) }, HUNG, seen[side]);
      for (const bone of limb) followJoint(f, goals, bone, f.current.local(bone).clone(), handed);
      // A hand returning from a task stays clear as its braked joints descend with the turning trunk, below the hips too (its clearance
      // is judged again only as the arm or the trunk moves: a hanging arm at rest is not)
      keepArmOut(f, proportions, side, { position: _hung.copy(f.current.position(limb[2])) }, NUDGED, seen[side]);
    });
  };
}

/** Keep a resting wrist outside equipment worn beside it, using the same padding as the thigh, judged facing `yaw` (default: the pelvis's). */
export function clearArm(person: Person, f: Frame, side: Side, at: Vector3, yaw = yawOf(f.current.local(0)), obstacles: readonly Thing[] = person.worn): Vector3 {
  const sign = side === 'left' ? 1 : -1, hips = f.current.position(0);
  const inverse = _r.setFromAxisAngle(Y, -yaw);
  const local = _rest.subVectors(at, hips).applyQuaternion(inverse);
  const pad = CLEAR * person.proportions.height;
  let out = sign * local.x;
  for (const thing of obstacles) {
    if (f.current.skeleton.chain(`${side}Arm`).includes(boneOf(person, thing.object))) continue;
    const placed = person.track(thing.object).at(f.time).current;
    const position = _d.subVectors(placed.position, hips).applyQuaternion(inverse);
    const rotation = _q.copy(inverse).multiply(placed.quaternion);
    const box = _box.copy(thing.bounds).applyMatrix4(_matrix.compose(position, rotation, ONE));
    if (local.y < box.min.y - pad || local.y > box.max.y + pad || local.z < box.min.z - pad || local.z > box.max.z + pad) continue;
    out = Math.max(out, (sign > 0 ? box.max.x : -box.min.x) + pad);
  }
  return at.addScaledVector(leftOf(yaw, _left), sign * (out - sign * local.x));
}

/** joint `bone` turned on from its history toward `goal` (its own motion followed), as briskly as a free arm swings (`SWING`) */
export function followJoint(f: Frame, joints: Map<number, TrackedRotation>, bone: number, goal: Quaternion, handed = false) {
  let joint = joints.get(bone);
  if (!joint) joints.set(bone, (joint = new TrackedRotation()));
  // (`handed`: just taken back from what had the arm, carried on no faster than its brakes stop within `OVERRUN` — whatever the verb was
  // doing: let go of at a throw's whip speed, it flew on up past the shoulder before they caught it)
  const prev = f.prev.local(bone), prev2 = _p2.copy(f.prev2.local(bone)), turned = prev2.angleTo(prev), most = Math.sqrt(2 * SWING.accel * OVERRUN) * f.dt;
  if (handed && turned > most) prev2.copy(prev).slerp(f.prev2.local(bone), most / turned);
  const q = joint.follow(prev2, prev, goal, SWING, f.dt, _r);
  f.current.setLocal(bone, limited(f.current.skeleton, bone, q));
}

/** a hanging arm kept out of the trunk as a free arm is, without swivelling its elbow */
const HUNG = { ...NUDGED, swivel: 0 };

const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1), ONE = new Vector3(1, 1, 1);
const _q = new Quaternion(), _p = new Quaternion(), _p2 = new Quaternion(), _r = new Quaternion(), _h = new Quaternion(), IDENTITY = new Quaternion(), _s2 = new Quaternion(), _t = new Quaternion();
const _left = new Vector3(), _d = new Vector3(), _w = new Vector3(), _rest = new Vector3(), _hung = new Vector3();
const _box = new Box3(), _matrix = new Matrix4();
