import { action } from '@pmndrs/timeline';
import type { Frame } from './frame';

/** Tuned, over a person's and a dog's breathing and sway (at most 0.05 rad/s, 0.002 m/s): how still a posed part is once it has come (rad/s;
 * its height, m/s), for how long (s), and how soon that can be said, as a part sets off slowly (s; fingers, unseen, take this long) */
export const STILL = { turn: 0.15, height: 0.03, seconds: 0.1, soonest: 0.1, fingers: 0.25 };
/** whether `parts` (bones) or the body's height moved last sub-step, more than idle life moves them */
const moving = (f: Frame, parts: readonly number[]) => Math.abs(f.prev.position(0).y - f.prev2.position(0).y) > STILL.height * f.dt
  || parts.some((part) => f.prev.rotation(part).angleTo(f.prev2.rotation(part)) > STILL.turn * f.dt);

/** Until `parts` have been measured still (no sooner than `soonest` s, as a part sets off slowly), or have had `most` s to be: the last of a verb that ends once they are. */
export function* comingToRest(parts: readonly number[], most: () => number, soonest: number = STILL.soonest) {
  let elapsed = 0, still = 0;
  yield* action<Frame>({
    until: (f) => {
      elapsed += f.dt;
      still = moving(f, parts) ? 0 : still + f.dt;
      return (still >= STILL.seconds && elapsed >= soonest) || elapsed >= most();
    },
  });
}
