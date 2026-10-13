import type { Humanoid } from '@drawcall/animate';

/** one actor after one step: its posed model */
export interface Frame {
  t: number;
  h: Pick<Humanoid, 'model'>;
}
