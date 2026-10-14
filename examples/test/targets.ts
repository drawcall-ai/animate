import { Quaternion, Vector3 } from 'three';
import { eyesOf, jointOf } from '../src/joints';
import { Peak, type Frame } from './frame';

/**
 * How closely the eyes are on what the script asks them to look at, and the hands stay on what
 * they hold or track: each wrist off its grip (the item's grip in the world as the item is now) or
 * its tracked target (`leftWrist`, `rightWrist`), while that is within reach (the arm's length +
 * 0.35 m of the shoulder: one further off is walked to, by design); the eyes' midpoint off a
 * tracked head's (`head`: a headset).
 */
export class Targets {
  private readonly wristPeak = new Peak();
  private readonly headPeak = new Peak();
  private readonly gazePeak = new Peak();
  private readonly headOffPeak = new Peak();
  /** frames a gaze was asked, and frames it was judged in */
  asked = 0;
  judged = 0;
  /** frames a tracked wrist target was asked (per wrist), and judged (within reach); frames a tracked head was asked (all judged) */
  tracked = { asked: 0, judged: 0, head: 0 };
  get head() {
    return this.headPeak.value;
  }
  /** the gaze target asked (as it was last step), and since when (s) */
  private goal: { target: Vector3; since: number } | null = null;
  get wrist() {
    return this.wristPeak.value;
  }
  get wristAt() {
    return this.wristPeak.at;
  }
  get headAt() {
    return this.headPeak.at;
  }
  get gazeAt() {
    return this.gazePeak.at;
  }
  /** how far beyond what the eyes turn comfortably in the head (EYES) the gaze target asked lies (°), SETTLE after it last jumped, where it is before the body (in front of the frontal plane through the hips) */
  get gaze() {
    return this.gazePeak.value;
  }

  see({ t, h, asked }: Frame) {
    const gaze = asked.get('gaze');
    if (!(gaze instanceof Vector3)) this.goal = null;
    else {
      // (a target that jumps is a new one, settled on afresh; one moving smoothly is followed and judged)
      if (!this.goal || this.goal.target.distanceTo(gaze) > JUMP) this.goal = { target: gaze.clone(), since: t };
      else this.goal.target.copy(gaze);
      const head = h.model.scene.getObjectByName('head');
      if (!head) throw new Error('no head');
      const forward = new Vector3(0, 0, 1).applyQuaternion(head.getWorldQuaternion(new Quaternion()));
      // (judged unless truly behind the body: behind the frontal plane through the hips — a bowed body's
      // own buckle, below and behind its eyes, is judged)
      const toward = gaze.clone().sub(eyesOf(h));
      const hips = h.model.scene.getObjectByName('hips');
      if (!hips) throw new Error('no hips');
      const facing = new Vector3(0, 0, 1).applyQuaternion(hips.getWorldQuaternion(new Quaternion())).setY(0);
      const seen = gaze.clone().sub(hips.getWorldPosition(new Vector3())).dot(facing) > 0;
      this.asked++;
      if (seen && t - this.goal.since > SETTLE) {
        this.judged++;
        const off = (forward.angleTo(toward) * 180) / Math.PI;
        this.headOffPeak.see(off, t);
        this.gazePeak.see(beyondEyes(toward.applyQuaternion(head.getWorldQuaternion(new Quaternion()).invert()), off), t);
      }
    }
    const head = positionOf(asked.get('head'));
    if (head) {
      this.tracked.head++;
      this.headPeak.see(eyesOf(h).distanceTo(head), t);
    }
    for (const s of ['left', 'right'] as const) {
      const target = positionOf(asked.get(`${s}Wrist`));
      if (!target) continue;
      this.tracked.asked++;
      if (jointOf(h, `${s}UpperArm`).distanceTo(target) >= h.proportions.armLength + 0.35) continue;
      this.tracked.judged++;
      this.wristPeak.see(jointOf(h, `${s}Hand`, _v).distanceTo(target), t);
    }
    for (const s of ['left', 'right'] as const) {
      const held = h.holding[s];
      if (!held) continue;
      const g = held.item.grips[held.grip];
      if (!g) throw new Error(`the item has no grip "${held.grip}"`);
      const grip = g.position.clone().applyQuaternion(held.item.current.quaternion).add(held.item.current.position);
      if (jointOf(h, `${s}UpperArm`).distanceTo(grip) >= h.proportions.armLength + 0.35) continue;
      this.wristPeak.see(jointOf(h, `${s}Hand`, _v).distanceTo(grip), t);
    }
  }

  toString() {
    const { asked, judged, head } = this.tracked;
    return `max wrist err (held grips and tracked targets within arm+0.35m) ${this.wristPeak} (tracked: judged ${judged} of ${asked} frames asked), head (eyes) err ${this.headPeak} (${head} frames), gaze beyond the eyes' comfortable turn ${this.gazePeak.value.toFixed(1)}° @${this.gazePeak.at.toFixed(2)}s, the head off its target ${this.headOffPeak.value.toFixed(1)}° @${this.headOffPeak.at.toFixed(2)}s (judged ${this.judged} of ${this.asked} frames asked)`;
  }
}

/** where a goal asked is: a point, or a placement's */
function positionOf(goal: unknown): Vector3 | null {
  if (goal instanceof Vector3) return goal;
  if (typeof goal === 'object' && goal !== null && 'position' in goal && goal.position instanceof Vector3) return goal.position;
  return null;
}

const _v = new Vector3();
/**
 * How far the eyes turn in the head comfortably (°): down to the preferred declination of the line
 * of sight below the head's (29° sitting upright, 34° over all postures: Hill & Kroemer 1986, Human
 * Factors 28:127); up and to the side about half the eye-only range of head-free gaze shifts (36°
 * wide on average: Stahl 1999, Exp Brain Res 126:41; measured horizontally, taken for up as well)
 * — an ellipse round the head's forward.
 */
const EYES = { down: 30, up: 20, side: 20 };

/**
 * how far (°) a target the head faces `off` (°) away from, at `local` in the head's frame (+z
 * ahead, +y up), lies beyond what the eyes turn comfortably (`EYES`): 0 within it
 */
export function beyondEyes(local: Vector3, off: number): number {
  if (local.z <= 0) return off - EYES.side;
  const side = (Math.atan2(local.x, local.z) * 180) / Math.PI;
  const down = (Math.atan2(-local.y, Math.hypot(local.x, local.z)) * 180) / Math.PI;
  const s = Math.hypot(side / EYES.side, down / (down > 0 ? EYES.down : EYES.up));
  return s > 1 ? off * (1 - 1 / s) : 0;
}

/** how long a gaze target stays put before the eyes are judged on it (s): a gaze shift takes ~0.3–0.5 s */
const SETTLE = 0.6;
/** how far a gaze target moves in one step to count as a new one (m): a jump, not a motion (5 cm in 1/60 s is 3 m/s) */
const JUMP = 0.05;
