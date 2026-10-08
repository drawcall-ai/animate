import { Quaternion, Vector3 } from 'three';
import type { Proportions } from '../proportions';
import type { Gait } from '../gait/gait';
import type { HandTask } from '../intent/tasks';
import type { Tracker } from '../intent/tracker';
import { clamp, forwardOf, leftOf, lerp, smoothstep, Spring } from '../math';
import { createLimb, type Side, type TrunkFrame } from '../pose/frames';
import type { Stance } from '../stance';
import { SIDE_BONES } from '../pose/bones';
import { twistShare } from '../pose/limits';
import { swingFrame } from '../pose/rotations';
import { solveInRange, type LimbJoints } from './twoBone';

const _hand = new Vector3();
const _balance = new Vector3();
const _v = new Vector3();
const _w = new Vector3();
const _f = new Vector3();
const _l = new Vector3();
const _up = new Vector3();
const _pole = new Vector3();
const _q = new Quaternion();

/**
 * how far through a step (lift-off to lift-off) the swing leads it, walking and running: the
 * arm is furthest forward with the other thigh; the forearm follows ~7% of the stride (0.14
 * step) behind it (CMU mocap)
 */
const LEAD = { walk: 0.26, run: -0.12, forearm: -0.14 };

/** the shortest an arm takes to swing from back to front (s), walking and running */
const ARM_PERIOD = { walk: 0.5, run: 0.3 };

/** where free arms go while a leg kicks (rad out from hanging, share of the arm forward): the arm away from the kicking leg, the one beside it; how long they stay out after (s) */
const KICK_ARMS = { hold: 0.6 };
/**
 * The arms counter the kicking leg (rad out from hanging, share of the arm forward; by where
 * the kicking foot is, −1 drawn back … +1 through): the arm away from it out wide and back
 * with the backswing, swinging forward and across the body with the follow-through; the one
 * beside it out a little, going back as the leg goes through. Elbows soft (× arm length).
 */
const KICK_SWING = { away: { out: [1.15, 0.8], forward: [-0.2, 0.85] }, near: { out: [0.55, 0.6], forward: [0.2, -0.45] }, reach: 0.85 };

/** where a free hand tucks in while the other strikes: from the chest bone (× height, sideways to its own side, up, forward); how long it stays tucked after (s) */
const TUCK = { x: 0.07, y: 0.07, z: 0.1, hold: 0.8 };
/** how quickly the arms go out for a kick or tuck in (1/s): a reaction of a few tenths of a second, not a snap */
const REACT = 9;

/** how far a relaxed arm hangs out from the side (rad): the shoulders are wider than the hips, the hand hangs clear of the thigh */
const ABDUCTION = 0.14;
/** riding standing up, free arms are held out for balance: the wrist off the shoulder (× arm length; out, down, forward in the chest's frame), the elbows soft */
const BALANCE = { out: 0.55, down: 0.6, ahead: 0.25 };

/**
 * The arms: free arms hang and swing opposite the legs (or keep a guard), go out for balance
 * while a leg kicks and tuck in while the other hand strikes; seated hands rest on the thighs,
 * tasked hands blend to their targets (and rotations); the clavicle shrugs and protracts, and
 * the elbow swivels by where the hand is.
 */
export class Arms {
  /** the wrist rotation targets handed on to the pose */
  private handRotations = [{ quaternion: new Quaternion(), weight: 0 }, { quaternion: new Quaternion(), weight: 0 }];
  /**
   * The swing's way through the current step (lift-off `at` of foot `side`, progress `u` from
   * `from` to 1, running on a little if the step lasts longer): each step picks up where the
   * last one left off, so the swing never jumps or stalls.
   */
  private step = { at: -10, side: 1, from: 0, u: 1 };
  /** how far the arms are out for a kick, and the kicking side */
  private kickOut = { amount: 0, side: 0, held: 0, spring: new Spring(), swing: new Spring() };
  /** how far a free hand is tucked in while the other strikes (and the trigger, lingering) */
  private tuck = { held: 0, spring: new Spring() };
  /** how far each hand is on a target (its weight) [left, right] */
  readonly held = [0, 0];
  /** each arm's joints, kept in their ranges */
  private readonly joints: [LimbJoints, LimbJoints];

  constructor(
    private d: Proportions,
    private stance: Stance,
    private style: { armSwing: number },
    private tf: TrunkFrame,
    private gait: Gait,
    /** the hand targets acted on */
    private reach: readonly (HandTask | null)[],
    private tracker: Tracker,
  ) {
    const share = twistShare('leftLowerArm', 'leftHand');
    const joints = (s: number): LimbJoints => {
      const b = SIDE_BONES[s];
      return { limb: createLimb(), len1: d.upperArm, len2: d.forearm, maxExtension: 0.999, softness: 0.012, upper: b.upperArm, lower: b.lowerArm, end: b.hand, upperRest: d.offsets[b.lowerArm], lowerRest: d.offsets[b.hand], share, parent: new Quaternion(), turn: new Quaternion(), weight: 0, swivel: 0 };
    };
    this.joints = [joints(0), joints(1)];
  }

  /** `sit`: how far seated (free hands rest on the thighs; the legs are already solved) */
  solve(sit: number, sides: readonly [Side, Side], dt: number) {
    const { d, stance, tf, gait: g } = this;
    const L = d.armLength;
    const H = d.height;
    const chestUp = _up.set(0, 1, 0).applyQuaternion(tf.qChest);
    const bodyLeft = leftOf(g.root.yaw + stance.blade, _l);
    const st = this.step;
    if (g.lastLiftAt !== st.at) {
      st.at = g.lastLiftAt;
      // (the other foot lifting turns the swing back; the same foot lifting again — a step
      // restarted, setting off — goes on with it: the arm's way is the same)
      if (g.lastLift !== st.side) st.u -= 1;
      st.side = g.lastLift;
      st.from = st.u;
    }
    const t = g.timing();
    // (no faster than an arm swings as a pendulum: a quick short step, setting off, doesn't flail
    // it — one that lags a swing behind catches up over two at most; one already at its end waits there)
    const period = Math.max(lerp(g.feet[g.lastLift].swing.duration + t.doubleSupport, t.stepT, t.run), lerp(ARM_PERIOD.walk, ARM_PERIOD.run, t.run));
    st.u = Math.min(1.5, st.u + (dt * clamp(1 - st.from, 0, 2)) / period);

    const kick = this.kick(dt);
    const tk = this.tuck;
    tk.held = Math.max(smoothstep(1, 2, this.tracker.pace), tk.held - dt / TUCK.hold);
    const tuck = tk.spring.step(tk.held, REACT, dt);
    for (let s = 0; s < 2; s++) {
      const side = sides[s];
      const sgn = s === 0 ? 1 : -1;
      const clavicle = side.clavicle.copy(tf.shoulders[s]);
      const shoulder = side.arm.root.copy(tf.upperArms[s]);
      const clavicleLength = shoulder.distanceTo(clavicle);
      // (a climb's or vault's hands hold the edge)
      const task = g.move.hold(s) ?? this.reach[s];
      this.held[s] = task ? task.weight : 0;
      const hand = this.freeHand(s, shoulder, task ? task.weight : 0);
      // free arms (not a guard) go out for balance while a leg kicks, countering it (KICK_SWING)
      if (!task && kick.amount > 0 && !stance.guard) {
        const k = KICK_SWING[s !== kick.side ? 'away' : 'near'];
        const u = 0.5 + 0.5 * kick.swing.value;
        const out = lerp(k.out[0], k.out[1], u);
        const f = forwardOf(g.root.yaw + stance.blade, _f);
        _w.set(0, -Math.cos(out), 0).addScaledVector(bodyLeft, sgn * Math.sin(out)).addScaledVector(f, lerp(k.forward[0], k.forward[1], u)).setLength(KICK_SWING.reach * L).add(shoulder);
        hand.lerp(_w, kick.amount);
      }
      // a free hand pulls in to the chest while the other strikes or throws (the glove arm tucks)
      if (!task && this.reach[1 - s]) hand.lerp(_w.set(sgn * TUCK.x * H, TUCK.y * H, TUCK.z * H).applyQuaternion(tf.qChest).add(tf.chest), tuck);
      // seated: free hands rest on the thighs
      if (sit > 0) {
        const rest = _w.lerpVectors(side.leg.root, side.leg.mid, 0.62);
        rest.y += 0.06 * H;
        rest.addScaledVector(bodyLeft, -sgn * 0.015 * H);
        hand.lerp(rest, sit);
      }
      if (task) hand.lerp(task.pos, task.weight);
      if (task?.rot) {
        const rot = this.handRotations[s];
        rot.quaternion.copy(task.rot);
        rot.weight = task.weight;
        side.hand = rot;
      } else side.hand = null;

      // --- clavicle: shrug when reaching up, protract when reaching far
      _v.subVectors(hand, shoulder);
      const elev = smoothstep(-0.05, 0.6, _v.dot(chestUp) / L);
      shoulder.addScaledVector(chestUp, elev * 0.03 * H);
      // (a free hand swung up over the shoulder, as in a jump, rides up with the shrug: the arm
      // stays long. Judged against the world's up: a flexed trunk's chest leans its up forward)
      if (!task) hand.addScaledVector(chestUp, Math.min(elev, smoothstep(0, 0.6, _v.y / L)) * 0.03 * H);
      const dist = _v.length();
      const protract = clamp(dist - 0.85 * L, 0, 0.035 * H) * (task ? task.weight : 0);
      if (dist > 1e-6) shoulder.addScaledVector(_v, protract / dist);
      // (the clavicle keeps its length: the joint moves on a sphere around its origin)
      shoulder.sub(clavicle).setLength(clavicleLength).add(clavicle);

      // --- elbow swivel: blend of canonical directions by where the hand is
      // (chest frame, x = outward): hanging → back, forward → down/out,
      // overhead → forward/out, out to the side → down/back, across → out/down
      _q.copy(tf.qChest).invert();
      const dl = _v.subVectors(hand, shoulder).normalize().applyQuaternion(_q);
      dl.x *= sgn;
      _pole
        .set(0.12, 0, -1)
        .multiplyScalar(Math.max(0, -dl.y))
        .addScaledVector(_w.set(0.4, -1, -0.15), Math.max(0, dl.z))
        .addScaledVector(_w.set(0.12, -0.15, 1), Math.max(0, dl.y))
        .addScaledVector(_w.set(0, -1, -0.4), Math.max(0, dl.x))
        .addScaledVector(_w.set(0.7, -0.6, 0), Math.max(0, -dl.x));
      if (stance.guard && !task) _pole.set(0.2, -1, 0);
      _pole.x *= sgn;
      _pole.applyQuaternion(tf.qChest);
      // (the clavicle's rotation, as the pose will have it)
      const j = this.joints[s];
      swingFrame(tf.qChest, d.offsets[SIDE_BONES[s].upperArm], _w.subVectors(shoulder, clavicle), j.parent);
      j.weight = task?.rot ? task.weight : 0;
      if (task?.rot) j.turn.copy(task.rot);
      j.limb = side.arm;
      solveInRange(j, hand, _pole, dt);
    }
  }

  /**
   * How far a leg is up in a kick (0..1) — a foot target holding it well off the floor — and
   * which, and where the foot is (`swing`, −1 back … 1 through); the arms go out as it comes up
   * and stay out a moment as it comes down through the ball.
   */
  private kick(dt: number) {
    const { d, gait: g, kickOut } = this;
    let amount = 0;
    let swing = kickOut.swing.value;
    const fwd = forwardOf(g.root.yaw, _f);
    for (let s = 0; s < 2; s++) {
      const f = g.feet[s];
      if (f.phase !== 'lifted') continue;
      const up = f.liftWeight * smoothstep(0.1 * d.height, 0.25 * d.height, f.pose.ankle.y - f.anchor.y);
      if (up <= amount) continue;
      [amount, kickOut.side] = [up, s];
      // (where the kicking foot is, fore and aft of the hip)
      const hip = this.tf.upperLegs[s];
      swing = clamp(((f.pose.ankle.x - hip.x) * fwd.x + (f.pose.ankle.z - hip.z) * fwd.z) / (0.6 * d.legLength), -1, 1);
    }
    kickOut.swing.step(swing, REACT, dt);
    kickOut.held = Math.max(amount, kickOut.held - dt / KICK_ARMS.hold);
    kickOut.amount = kickOut.spring.step(kickOut.held, REACT, dt);
    return kickOut;
  }

  /**
   * where a hand goes on its own: a guard, or hanging a little out from the side and
   * swinging with the legs — a pendulum timed by the steps, not a spring of its own (which
   * would lag and drift off their rhythm): through each step, lift-off to lift-off, the arm
   * opposite the stepping foot swings from back to front, easing at both ends; the forearm
   * follows ~7% of the stride behind (CMU mocap)
   */
  private freeHand(s: number, shoulder: Vector3, reaching: number): Vector3 {
    const { d, tf, gait: g } = this;
    const H = d.height;
    const sgn = s === 0 ? 1 : -1;
    const hand = _hand;
    // (riding, as far as the mount carries the body)
    const riding = g.mount.owns ? g.mount.carry : 0;
    const balance = _balance.set(sgn * BALANCE.out, -BALANCE.down, BALANCE.ahead).multiplyScalar(d.armLength).applyQuaternion(tf.qChest).add(shoulder);
    if (riding >= 1) return hand.copy(balance);
    if (this.stance.guard) return hand.set(sgn * 0.06 * H, 0.025 * H, 0.14 * H).applyQuaternion(tf.qChest).add(tf.neck);
    const fwd = forwardOf(g.root.yaw, _f);
    const u = this.step.u;
    // (cos π(1 + v) = −cos πv: one step's end is the next one's start, velocity and all)
    // (+1: the other foot is stepping, this arm swings forward)
    const forward = s === this.step.side ? -1 : 1;
    // relaxed swing, more forward than back (upper arm ~ +21° / -19°)
    // (an arm reaching out for something stops swinging)
    const swing = (lead: number) => (-forward * Math.cos(Math.PI * (u + lead)) * lerp(0.33, 0.5, g.run) + 0.02) * g.walk * this.style.armSwing * (1 - reaching);
    const lead = lerp(LEAD.walk, LEAD.run, g.run);
    // (a jump or a climb's hop swings the arms back, then forward and up)
    const a = swing(lead) + (g.jump.arm + g.move.arm) * (1 - reaching);
    // the elbow flexes and extends with the swing, more in front (~15° back, ~35° front; ~15° standing)
    const follow = swing(lead + LEAD.forearm);
    const flex = lerp(0.25 + (0.18 + 0.5 * follow) * g.walk, 1.5 + 0.3 * follow, g.run);
    // `a` swings the upper arm; the forearm hangs on from the elbow, flexed forward.
    // The arm hangs out from the shoulder by ABDUCTION (the hand clears the thigh) and
    // swings slightly toward the midline going forward
    // (swung up overhead, as in a jump, the elbow straightens and the hand stays out at the shoulder's width)
    const fa = a + flex * (1 - smoothstep(0.6, 1.6, a));
    const down = Math.cos(a) * d.upperArm + Math.cos(fa) * d.forearm;
    const out = Math.sin(ABDUCTION) * Math.abs(down) * (1 - 0.3 * clamp(a, 0, 1));
    hand
      .copy(shoulder)
      .addScaledVector(fwd, Math.sin(a) * d.upperArm + Math.sin(fa) * d.forearm)
      .addScaledVector(leftOf(g.root.yaw + this.stance.blade, _v), sgn * out);
    hand.y -= Math.cos(ABDUCTION) * down;
    return hand.lerp(balance, riding);
  }
}
