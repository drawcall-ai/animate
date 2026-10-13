import type { Humanoid } from '@drawcall/animate';

/** a body as the metrics read it: its posed model, and what `balance` (its heading and ground velocity: `gait.facing`, `gait.velocity`) and the hands report of it */
export type Actor = Pick<Humanoid, 'model' | 'proportions' | 'feet' | 'gait' | 'holding'>;

/** one actor after one step: what the script asked of it then (the first actor's) */
export interface Frame {
  t: number;
  h: Actor;
  asked: ReadonlyMap<string, unknown>;
}

/** the largest value seen and when */
export class Peak {
  value = 0;
  at = 0;
  see(v: number, t: number) {
    if (v <= this.value) return;
    this.value = v;
    this.at = t;
  }
  toString() {
    return `${this.value.toFixed(3)} m @${this.at.toFixed(2)}s`;
  }
}

/** a hand is on something: it holds an item, or the script asked it somewhere */
export const tasked = ({ h, asked }: Frame) => !!h.holding.left || !!h.holding.right || asked.has('leftHand') || asked.has('rightHand');
