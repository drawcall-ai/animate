import { Quaternion, Vector3 } from 'three';
import { kneePole } from '../limbs/legs';
import { solveTwoBone } from '../limbs/twoBone';
import { forwardOf, lerp, minimumJerk, quatYXZ, smoothstep, softMin, Spring } from '../math';
import { createLimb } from '../pose/frames';
import { DORSIFLEXION } from '../pose/limits';
import type { Proportions } from '../proportions';
import type { Stance } from '../stance';
import type { GaitFoot } from './foot';
import type { Gait } from './gait';
import { groundClearance } from './obstacles';
import type { Timing } from './timing';

/** time over which the foot rolls flat about the heel after heel strike (s) */
const HEEL_ROCKER = 0.12;
/**
 * How far the ankle dorsiflexes (the shank tilting forward over the foot, rad) before the
 * heel comes up: standing, the range's end (~35°, a deep squat); walking, the calf holds it at
 * ~11° and the heel rises from mid-stance on; running at ~26° (Perry 1992; CMU mocap).
 */
const HEEL_OFF = { stand: 0.62, walk: 0.19, run: 0.45 };
/** push-off: how much further the ankle plantarflexes by toe-off (rad): to ~15° past neutral walking, ~25° running */
const PUSH = { walk: 0.46, run: 0.88 };
/** the swinging ankle holds its push-off through the start of the swing, then returns to just past neutral (rad): the toes clear the floor */
const SWING_ANKLE = 0.06;
const SWING_RETURN = [0.1, 0.45] as const;
/** toe/heel clearance kept above the floor during swing (m) */
const SOLE_CLEARANCE = 0.012;
/** the share of the swing over which the toes relax from the floor into line with the foot */
const TOES_RELAX = 0.3;
/** how quickly a raised foot's ankle turns to its pitch (1/s): it doesn't snap, it swings */
const LIFTED_RATE = 30;
/** how near the floor a raised foot's toes come before they are kept off it (m, default body) */
const TOE_ROOM = 0.06;
/** a stair step's toe clearance (m, default body) */
const STAIR_CLEARANCE = 0.06;
/** the most a planted heel rises (rad) */
const MAX_HEEL = 1.2;

const _v = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _q = new Quaternion();
const _pole = new Vector3();
const _fwd = new Vector3();
const _leg = createLimb();

/**
 * How the feet pitch, by the ankle's angle to the shank (the joint the calf drives), not by
 * a pitch of their own: a planted foot rolls flat after the heel rocker, its heel rising once
 * the shank tilts past what the ankle allows and more as it pushes off; up onto the ball
 * whenever the leg could not otherwise reach. A swinging foot carries the push-off ankle
 * back to neutral, then turns toes-up into its heel strike. Lifted feet are pointed from the
 * shin (their ankle's own turn on a spring), their toes kept off the floor; carried ones keep
 * their mount's.
 */
export class FootRoll {
  private springs = [new Spring(), new Spring()];
  /** a raised foot's own ankle turn (pointed from the shin), on its spring */
  private ankles = [new Spring(), new Spring()];
  /** each foot's ankle angle (rad, + = dorsiflexed) and toes' pitch as it last stood: where its swing starts from */
  private liftAnkle = [0, 0];
  private liftToes = [0, 0];

  constructor(
    private d: Proportions,
    private stance: Stance,
  ) {}

  /** `hips`: the hip joints [left, right] */
  update(g: Gait, hips: readonly [Vector3, Vector3], dt: number) {
    const bodyFwd = forwardOf(g.root.yaw + this.stance.blade, _fwd);
    const t = g.timing();
    for (let s = 0; s < 2; s++) {
      const f = g.feet[s];
      const pose = f.pose;
      if (f.phase === 'planted') {
        const pitch = this.plantedPitch(f, g, t, hips[s], bodyFwd);
        // (continuous through 0: the pivot switches heel↔ball exactly where both agree)
        pose.pitch = dt > 0 ? this.springs[s].step(pitch, 60, dt) : pitch;
        f.ankleFor(f.anchor, f.yaw, pose.pitch, pose.ankle);
        this.liftAnkle[s] = pose.pitch + this.shankTilt(f, hips[s], pose.ankle, bodyFwd);
        // (the toes stay flat on the ball while the heel is up)
        pose.toePitch = this.liftToes[s] = Math.max(0, pose.pitch);
        this.ankles[s].reset(pose.pitch);
      } else {
        this.springs[s].reset(pose.pitch);
        if (f.phase !== 'lifted') this.ankles[s].reset(pose.pitch);
        // (a climb, a vault, a ladder or a mount poses the feet it carries)
        if (g.move.owns || f.phase === 'carried') continue;
        if (f.phase === 'swing') this.swingPitch(f, hips[s], bodyFwd, s, g);
        else {
          // a foot held up (a kick) is pointed from the shin, not from the floor: raised
          // forward, it turns up with the shank (a foot fixed to the floor's frame would bend
          // up against the shin); a stride's stays level to land
          if (f.phase === 'lifted') {
            // (the ankle's own turn on a spring, from the pitch it left the floor with: it swings, not snaps)
            const ankle = dt > 0 ? this.ankles[s].step(pose.pitch, LIFTED_RATE, dt) : pose.pitch;
            const pitch = ankle - f.liftWeight * (1 - f.striding) * this.shankTilt(f, hips[s], pose.ankle, bodyFwd);
            // (never with its toes through the floor it is about to come down on: pointed no further
            // than they touch it, eased into that limit — pointed back past straight down, they rise)
            // (aimed a little above the floor: the eased limit gives a little)
            const floor = f.anchor.y - this.d.ankleHeight + 0.015 * this.d.scale;
            pose.pitch = pitch;
            if (pitch > -Math.PI / 2 && this.toesAt(f, pitch) < floor + TOE_ROOM * this.d.scale) {
              let lo = -Math.PI / 2;
              let hi = 0.5;
              for (let i = 0; i < 12; i++) {
                const mid = (lo + hi) / 2;
                if (this.toesAt(f, mid) < floor) lo = mid;
                else hi = mid;
              }
              pose.pitch = -softMin(-pitch, -hi, 0.15);
            }
            // (set down, it rolls on from this pitch)
            this.springs[s].reset(pose.pitch);
          }
          pose.toePitch = pose.pitch;
        }
      }
      f.orient();
    }
  }

  private plantedPitch(f: GaitFoot, g: Gait, t: Timing, hip: Vector3, bodyFwd: Vector3): number {
    // (landed on the heel, the foot rolls down onto the ball; on the forefoot, the heel comes down)
    if (f.plantedTime < HEEL_ROCKER && f.landPitch !== 0) return f.landPitch * (1 - smoothstep(0, HEEL_ROCKER, f.plantedTime));
    // the ankle's limit, less the push-off: walking from the other foot's heel strike to
    // toe-off (the double support; fading if it doesn't lift), running through the stance's second half
    const other = g.feet[f.side > 0 ? 1 : 0];
    const trailing = other.phase === 'planted' && other.plantedTime < f.plantedTime;
    const walkPush = trailing ? smoothstep(0, t.doubleSupport, other.plantedTime) * (1 - smoothstep(0.25, 0.45, other.plantedTime)) : 0;
    const runPush = smoothstep(0.45, 1, f.plantedTime / t.stance);
    const limit = lerp(lerp(HEEL_OFF.stand, HEEL_OFF.walk, g.walk), HEEL_OFF.run, t.run);
    const ankle = limit - lerp(PUSH.walk * walkPush, PUSH.run * runPush, t.run) * g.walk;
    // the heel rises until the ankle is within it (raising the heel tilts the shank on a little: iterated)
    let pitch = Math.min(0, f.pose.pitch);
    for (let i = 0; i < 3; i++) pitch = Math.max(-MAX_HEEL, Math.min(0, ankle - this.shankTilt(f, hip, f.ankleFor(f.anchor, f.yaw, pitch, _a), bodyFwd)));
    // (pushing off into a jump, the ankles extend with the legs)
    pitch = Math.min(pitch, -g.jump.heel, -g.move.heel);
    // and whenever the leg could not otherwise reach
    const reach = 0.9995 * this.d.legLength;
    if (hip.distanceTo(f.ankleFor(f.anchor, f.yaw, pitch, _a)) <= reach) return pitch;
    let lo = -MAX_HEEL;
    let hi = pitch;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (hip.distanceTo(f.ankleFor(f.anchor, f.yaw, mid, _a)) > reach) hi = mid;
      else lo = mid;
    }
    return lo;
  }

  /** the ankle comes back from the push-off early in the swing, then the foot turns toes-up into its heel strike */
  private swingPitch(f: GaitFoot, hip: Vector3, bodyFwd: Vector3, s: number, g: Gait) {
    const w = f.swing;
    const { pose } = f;
    const ankle = lerp(this.liftAnkle[s], SWING_ANKLE, minimumJerk((w.s - SWING_RETURN[0]) / (SWING_RETURN[1] - SWING_RETURN[0])));
    // (stepping up, the toes come up early: they clear the riser ahead)
    const strike = w.to.y > w.from.y + 0.01 ? smoothstep(0.2, 0.55, w.s) : smoothstep(0.7, 1, w.s);
    // (held level over an obstacle: its clearance is the flat foot's; as far as the ankle flexes up,
    // the ankle raised by what that lowers the toes, which tilts the shank back on: iterated)
    const y = pose.ankle.y;
    for (let i = 0; i < 3; i++) {
      const tilt = this.shankTilt(f, hip, pose.ankle, bodyFwd);
      pose.pitch = Math.min(lerp(ankle - tilt, w.strikePitch, strike) * (1 - w.over), DORSIFLEXION - tilt);
      pose.ankle.y = y + Math.max(0, this.toesAt(f, 0) - this.toesAt(f, pose.pitch)) * w.over;
    }
    // the toes, bent up on the floor at lift-off, relax into line with the foot
    pose.toePitch = lerp(this.liftToes[s], pose.pitch, smoothstep(0, TOES_RELAX, w.s));
    // the sole never goes through the ground, and keeps a clearance fading in and out with the swing
    f.orient();
    const ball = f.ballLocal(_v).applyQuaternion(pose.quaternion);
    const tip = f.toeLocal(_a).sub(f.ballLocal(_b)).applyQuaternion(quatYXZ(f.yaw, -pose.toePitch, 0, _q)).add(ball);
    const heel = f.heelLocal(_v).applyQuaternion(pose.quaternion);
    if (g.steer.ground.length) {
      // over ground, the sole clears its edges on the way (a stair's nose): by a few cm stepping up or down (Riener 2002)
      const clearance = Math.abs(w.to.y - w.from.y) > 0.01 ? STAIR_CLEARANCE * this.d.scale : SOLE_CLEARANCE;
      const least = groundClearance(g, w, w.s, tip, heel, clearance);
      pose.ankle.y = -softMin(-pose.ankle.y, -least, 0.02 * this.d.scale);
      return;
    }
    const low = pose.ankle.y + Math.min(tip.y, heel.y);
    pose.ankle.y += Math.max(0, -low) + Math.max(0, SOLE_CLEARANCE - Math.max(0, low)) * Math.sin(Math.PI * w.s);
  }

  /** the toe tip's height with the foot at `pitch` about its ankle */
  private toesAt(f: GaitFoot, pitch: number): number {
    return f.pose.ankle.y + f.toeLocal(_a).applyQuaternion(quatYXZ(f.yaw, -pitch, 0, _q)).y;
  }

  /** the shank's forward tilt over the foot (rad, + = knee ahead of the ankle), the leg solved from `hip` to `ankle` as the legs will */
  private shankTilt(f: GaitFoot, hip: Vector3, ankle: Vector3, bodyFwd: Vector3): number {
    const d = this.d;
    kneePole(f, bodyFwd, hip, ankle, _pole);
    _leg.root.copy(hip);
    solveTwoBone(_leg, ankle, d.thigh, d.shin, _pole, 0.9995, 0.012);
    const shin = _v.subVectors(_leg.mid, _leg.end);
    return Math.atan2(shin.x * Math.sin(f.yaw) + shin.z * Math.cos(f.yaw), shin.y);
  }
}
