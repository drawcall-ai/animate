import { Vector3 } from 'three';
import type { Body } from '@drawcall/animate';
import type { Clip, Sound } from './sound';

// Footsteps on the hall's stone, from the walkers' own foot contacts: each time one of a body's feet goes from swinging to planted
// (`body.feet`, as the library steps it) a step sounds where that foot landed, on the floor it stands on.

const STEPS: Clip[] = ['step1', 'step2', 'step3'];

export interface Walker {
  body: Body;
  /** how heavy its step sounds: gain and playback rate (a lower rate is a deeper, heavier step) */
  volume: number;
  rate: number;
  name: string;
}

/** listens to `walkers`' feet on `floor` (its height under a point); call `update` after every body has updated */
export function footsteps(walkers: readonly Walker[], sound: Sound, floor: (x: number, z: number) => number) {
  let planted: boolean[][] | undefined;
  let count = 0;
  return {
    update() {
      // (the feet are first read after the first update: before it, none is planted yet)
      if (!planted) {
        planted = walkers.map(({ body }) => body.feet.map((foot) => foot.planted));
        return;
      }
      const was = planted;
      walkers.forEach(({ body, volume, rate, name }, i) => {
        body.feet.forEach((foot, f) => {
          const landed = foot.planted && !was[i][f];
          was[i][f] = foot.planted;
          if (!landed) return;
          const at = new Vector3(foot.position.x, floor(foot.position.x, foot.position.z), foot.position.z);
          // one of three steps in turn, each a touch higher or lower, so a walk never repeats one sound
          const jitter = 1 + 0.06 * Math.sin(count * 2.39);
          sound.play(STEPS[count++ % STEPS.length], { from: at, volume, rate: rate * jitter, near: 2.5, why: `${name} foot ${f + 1}` });
        });
      });
    },
  };
}
