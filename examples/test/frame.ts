import type { Humanoid, Side } from '@drawcall/animate';
import type { Solid } from '../src/scenario';

/** a body as the metrics read it: its posed model, and what `balance` (its heading and ground velocity: `gait.facing`, `gait.velocity`), the hands (what they hold) and the weight of what it holds and wears report of it */
export type Actor = Pick<Humanoid, 'model' | 'proportions' | 'feet' | 'gait' | 'holding' | 'borne' | 'worn'>;

/** one actor after one step: what the script asked of it then (the first actor's) */
export interface Frame {
  t: number;
  h: Actor;
  asked: ReadonlyMap<string, unknown>;
  /** what must keep out of the first actor's body (the items it handles), as they are then */
  solids: readonly Solid[];
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

/** a hand is on something: it holds an item, or the script asked it somewhere (or tracks it) */
export const tasked = (frame: Frame, side?: Side): boolean => {
  const { h, asked } = frame;
  return side
    ? !!h.holding[side] || asked.has(`${side}Hand`) || asked.has(`${side}Wrist`)
    : tasked(frame, 'left') || tasked(frame, 'right');
};
