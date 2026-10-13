import { Quaternion, Vector3 } from 'three';
import { eyesOf, jointOf } from '../src/joints';
import { Peak, type Frame } from './frame';

/**
 * How closely the eyes are on what the script asks them to look at, and the hands stay on what
 * they hold: each wrist off its grip (the item's grip in the
 * world as the item is now), while the grip is within reach (the arm's length + 0.35 m of the
 * shoulder: one further off is walked to, by design).
 */
export class Targets {
  private readonly wristPeak = new Peak();
  private readonly gazePeak = new Peak();
  /** frames a gaze was asked, and frames it was judged in */
  asked = 0;
  judged = 0;
  /** the gaze target asked, and since when (s) */
  private gazeAt: { target: Vector3; since: number } | null = null;
  get wrist() {
    return this.wristPeak.value;
  }
  /** the eyes off the gaze target asked (°), once it has stayed put for SETTLE, where it is in front of the chest */
  get gaze() {
    return this.gazePeak.value;
  }

  see({ t, h, asked }: Frame) {
    const gaze = asked.get('gaze');
    if (!(gaze instanceof Vector3)) this.gazeAt = null;
    else {
      if (!this.gazeAt || this.gazeAt.target.distanceTo(gaze) > 0.01) this.gazeAt = { target: gaze.clone(), since: t };
      const head = h.model.scene.getObjectByName('head');
      if (!head) throw new Error('no head');
      const forward = new Vector3(0, 0, 1).applyQuaternion(head.getWorldQuaternion(new Quaternion()));
      // (judged where a head can look: within a quarter turn of where the chest faces)
      const toward = gaze.clone().sub(eyesOf(h));
      const chest = h.model.scene.getObjectByName('chest');
      if (!chest) throw new Error('no chest');
      const facing = new Vector3(0, 0, 1).applyQuaternion(chest.getWorldQuaternion(new Quaternion())).setY(0);
      const seen = facing.angleTo(toward.clone().setY(0)) < Math.PI / 2;
      this.asked++;
      if (seen && t - this.gazeAt.since > SETTLE) {
        this.judged++;
        this.gazePeak.see((forward.angleTo(toward) * 180) / Math.PI, t);
      }
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
    return `max wrist err (held grips within arm+0.35m) ${this.wristPeak}, gaze off its target ${this.gazePeak.value.toFixed(1)}° @${this.gazePeak.at.toFixed(2)}s (judged ${this.judged} of ${this.asked} frames asked)`;
  }
}

const _v = new Vector3();
/** how long a gaze target stays put before the eyes are judged on it (s): a gaze shift takes ~0.3–0.5 s */
const SETTLE = 0.6;
