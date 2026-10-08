import type { Humanoid } from '@prohuman/core';
import type { Prop, ScenarioInput } from '../src/scenario';

/** one actor after one step */
export interface Frame {
  t: number;
  h: Humanoid;
  input: ScenarioInput;
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
