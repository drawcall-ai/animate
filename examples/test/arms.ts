import { Vector3 } from 'three';
import { jointOf } from '../src/joints';
import { FIXED_DT } from '../src/scenario';
import { comOf } from './com';
import { tasked, type Frame } from './frame';

const DEG = 180 / Math.PI;

/** frames standing still before the arms count as standing (0.5 s) */
const STILL_FRAMES = 30;
/** arms reaching for a hold or just let go of one are not free (s) */
const HOLD_NEAR = 0.6;
/** a limb's radius (× height): mid-thigh, and the hand's half-thickness */
const THIGH_RADIUS = 0.034;
const HAND_RADIUS = 0.012;

interface Band {
  min: number;
  max: number;
}
const band = (): Band => ({ min: Infinity, max: -Infinity });
const see = (b: Band, v: number) => {
  b.min = Math.min(b.min, v);
  b.max = Math.max(b.max, v);
};

/** free-arm measures over a set of frames (m, °) */
export interface ArmStats {
  frames: number;
  /** hand (wrist) distance out from the body's midline, and the hip joints' half-width */
  handOut: Band;
  hipHalf: number;
  /** hand to thigh surface, sideways (negative: inside the thigh) */
  clearance: Band;
  /** upper arm abduction (+ = out from the side), shoulder flexion (+ = forward), elbow flexion */
  abduction: Band;
  flexion: Band;
  elbow: Band;
}

const stats = (): ArmStats => ({ frames: 0, handOut: band(), hipHalf: 0, clearance: band(), abduction: band(), flexion: band(), elbow: band() });

/**
 * The free arms of the first actor (no hand on anything or asked anywhere), in the pelvis frame: how far the
 * hands hang out from the midline and clear the thighs, and the arm's angles. Standing
 * (not moving) and walking (steady, not running) are kept apart.
 */
export class FreeArms {
  /** the free arms' frames: when, walking or standing, each side's measures; and when a hand held on to something */
  private readonly samples: { t: number; walking: boolean; sides: { handOut: number; hipHalf: number; clearance: number; abduction: number; flexion: number; elbow: number }[] }[] = [];
  private readonly held: number[] = [];
  private still = 0;
  /** the centre of mass last frame */
  private com: Vector3 | null = null;

  get standing(): ArmStats {
    return this.stats(false);
  }

  get walking(): ArmStats {
    return this.stats(true);
  }

  /** the measures over the standing or walking frames, but those near a hold (reaching for it, letting go) */
  private stats(walking: boolean): ArmStats {
    const out = stats();
    for (const q of this.samples) {
      if (q.walking !== walking || this.held.some((t) => Math.abs(t - q.t) < HOLD_NEAR)) continue;
      for (const v of q.sides) {
        see(out.handOut, v.handOut);
        out.hipHalf = v.hipHalf;
        see(out.clearance, v.clearance);
        see(out.abduction, v.abduction);
        see(out.flexion, v.flexion);
        see(out.elbow, v.elbow);
      }
      out.frames++;
    }
    return out;
  }

  see(frame: Frame) {
    const { t, h } = frame;
    const speed = Math.hypot(h.locomotion.velocity.x, h.locomotion.velocity.z);
    const moving = h.feet.some((f) => f.phase !== 'planted');
    const com = comOf(h);
    const sinking = this.com && com.distanceTo(this.com) / FIXED_DT > 0.1;
    this.com = com;
    // (standing: still for a while, arms settled — not passing through on the way somewhere, nor crouching)
    this.still = speed < 0.05 && !moving && !sinking ? this.still + 1 : 0;
    const into = this.still > STILL_FRAMES ? 'standing' : speed > 0.8 && speed < 2 ? 'walking' : null;
    // (only arms left entirely to themselves: no hand on anything, nor asked anywhere, nor just let go)
    if (tasked(frame)) this.held.push(t);
    if (!into || tasked(frame)) return;
    const j = (n: string) => jointOf(h, n);
    const hips = j('hips');
    const lHip = j('leftUpperLeg');
    const rHip = j('rightUpperLeg');
    // the pelvis frame: left across the hip joints, up, forward
    const left = lHip.clone().sub(rHip).setY(0).normalize();
    const fwd = new Vector3(0, 1, 0).cross(left).normalize().negate();
    const H = h.proportions.height;
    const sides = (['left', 'right'] as const).map((s) => {
      const sgn = s === 'left' ? 1 : -1;
      const out = (p: Vector3) => p.clone().sub(hips).dot(left) * sgn;
      const shoulder = j(`${s}UpperArm`);
      const elbow = j(`${s}LowerArm`);
      const hand = j(`${s}Hand`);
      const hip = j(`${s}UpperLeg`);
      const knee = j(`${s}LowerLeg`);
      // the thigh's axis at the hand's height (clamped to the thigh)
      const k = Math.min(1, Math.max(0, (hip.y - hand.y) / (hip.y - knee.y)));
      const thigh = hip.clone().lerp(knee, k);
      const ua = elbow.clone().sub(shoulder);
      return {
        handOut: out(hand),
        hipHalf: out(hip),
        clearance: out(hand) - out(thigh) - (THIGH_RADIUS + HAND_RADIUS) * H,
        abduction: Math.atan2(ua.dot(left) * sgn, -ua.y) * DEG,
        flexion: Math.atan2(ua.dot(fwd), -ua.y) * DEG,
        elbow: 180 - shoulder.clone().sub(elbow).angleTo(hand.clone().sub(elbow)) * DEG,
      };
    });
    this.samples.push({ t, walking: into === 'walking', sides });
  }

  toString() {
    const f = (b: Band, k = 1, d = 0) => `${(b.min * k).toFixed(d)}…${(b.max * k).toFixed(d)}`;
    const line = (name: string, a: ArmStats) =>
      a.frames
        ? `free arms ${name}: hand out ${f(a.handOut, 100)} cm (hip joint ${(a.hipHalf * 100).toFixed(0)} cm), thigh clearance ${f(a.clearance, 100)} cm; abduction ${f(a.abduction)}°, shoulder flexion ${f(a.flexion)}°, elbow ${f(a.elbow)}°`
        : '';
    return [line('standing', this.standing), line('walking', this.walking)].filter(Boolean).join('\n') || 'free arms: none';
  }
}

/** a turn of the arm's swing counts once it has swung back this far from its end (°): a pendulum's, not a wobble */
const TURN = 2;

/**
 * The free arms' swing while stepping (the first actor; no hand on anything, asked anywhere or
 * just let go, no foot held up): the upper arm's angle forward of hanging, in the pelvis frame, and
 * the shortest time between two turns of it — an arm swings as a pendulum, its swings never
 * quicker than ~0.25 s (setting off too: the first short steps don't flail it).
 */
export class ArmTurns {
  /** each turn: when, and how long after the one before */
  private readonly turns: { t: number; gap: number }[] = [];
  private readonly held: number[] = [];
  private readonly sides = [0, 1].map(() => ({ end: NaN, dir: 0, turned: -Infinity }));

  /** the shortest time between two turns (s), and when, but those near a hold (reaching for it, letting go) */
  get shortest(): { gap: number; t: number } {
    let out = { gap: Infinity, t: 0 };
    for (const q of this.turns) if (q.gap < out.gap && !this.held.some((t) => Math.abs(t - q.t) < HOLD_NEAR)) out = q;
    return out;
  }

  see(frame: Frame) {
    const { t, h } = frame;
    if (tasked(frame)) this.held.push(t);
    const stepping = (h.feet.some((f) => f.phase === 'swing') || Math.hypot(h.locomotion.velocity.x, h.locomotion.velocity.z) > 0.1);
    if (tasked(frame) || !stepping) {
      for (const s of this.sides) s.end = NaN;
      return;
    }
    const left = jointOf(h, 'leftUpperLeg').sub(jointOf(h, 'rightUpperLeg')).setY(0).normalize();
    const fwd = new Vector3(0, 1, 0).cross(left).normalize().negate();
    (['left', 'right'] as const).forEach((n, i) => {
      const ua = jointOf(h, `${n}LowerArm`).sub(jointOf(h, `${n}UpperArm`));
      const a = Math.atan2(ua.dot(fwd), -ua.y) * DEG;
      const s = this.sides[i];
      if (Number.isNaN(s.end)) [s.end, s.dir, s.turned] = [a, 0, -Infinity];
      // (its end so far this way, and a turn once it has swung back TURN from it)
      if (s.dir === 0) {
        if (Math.abs(a - s.end) > TURN) [s.dir, s.end] = [Math.sign(a - s.end), a];
      } else if ((a - s.end) * s.dir > 0) s.end = a;
      else if ((s.end - a) * s.dir > TURN) {
        this.turns.push({ t, gap: t - s.turned });
        [s.dir, s.end, s.turned] = [-s.dir, a, t];
      }
    });
  }

  toString() {
    const { gap, t } = this.shortest;
    return `free arm swing: shortest between turns ${gap === Infinity ? '–' : `${gap.toFixed(2)} s @${t.toFixed(2)}s`}`;
  }
}
