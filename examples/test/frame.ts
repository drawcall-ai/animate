import type { Humanoid } from '@drawcall/animate';
import type { Prop } from '../src/scenario';
import type { Input } from '../src/simulation';

/** a body as the metrics read it */
export type Actor = Pick<Humanoid, 'model' | 'proportions' | 'feet' | 'yaw' | 'velocity' | 'seated' | 'mounted'>;

/** one actor after one step */
export interface Frame {
  t: number;
  h: Actor;
  input: Input;
  /** the scenery as it is then */
  props: readonly Prop[];
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
