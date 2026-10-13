import { eyesOf, jointOf } from '../src/joints';
import { Peak, type Frame } from './frame';

/** how closely full-weight targets are met: wrists within reach, and the eyes */
export class Targets {
  private readonly wristPeak = new Peak();
  private readonly headPeak = new Peak();
  get wrist() {
    return this.wristPeak.value;
  }
  get head() {
    return this.headPeak.value;
  }

  see({ t, h, input }: Frame) {
    const head = input.head;
    if (head && (head.weight ?? 1) > 0.99) this.headPeak.see(eyesOf(h).distanceTo(head.position), t);
    for (const s of ['left', 'right'] as const) {
      const e = input[`${s}Hand`];
      // only targets within reach range (far ones are walked to first, by design)
      if (!e || (e.weight ?? 1) <= 0.99 || jointOf(h, `${s}UpperArm`).distanceTo(e.position) >= h.proportions.armLength + 0.35) continue;
      this.wristPeak.see(jointOf(h, `${s}Hand`).distanceTo(e.position), t);
    }
  }

  toString() {
    return `max wrist err (w=1, target within arm+0.35m) ${this.wristPeak}, head (eyes) target err ${this.headPeak}`;
  }
}
