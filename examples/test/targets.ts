import { Vector3 } from 'three';
import { jointOf } from '../src/joints';
import { Peak, type Frame } from './frame';

/**
 * How closely the hands stay on what they hold: each wrist off its grip (the item's grip in the
 * world as the item is now), while the grip is within reach (the arm's length + 0.35 m of the
 * shoulder: one further off is walked to, by design).
 */
export class Targets {
  private readonly wristPeak = new Peak();
  get wrist() {
    return this.wristPeak.value;
  }

  see({ t, h }: Frame) {
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
    return `max wrist err (held grips within arm+0.35m) ${this.wristPeak}`;
  }
}

const _v = new Vector3();
