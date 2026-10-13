import { clamp, softMin, softplus } from '../math';
import type { Proportions } from '../proportions';

/** how far the trunk's bow takes a point of it down before the knees bend (× height) */
const BOW = 0.08;
/** how deep the knees bend at most (× height): a squat the body balances in, heels down; lower, the trunk bows further */
const SQUAT = 0.25;
/** over how much of the drop the knees start and stop bending (× height) */
const BEND = 0.02;
/** the share of a bow's sweep forward that takes the point ahead of the centre of mass (the hips go back the rest) */
const AHEAD = 0.6;
/** the share of a bow the hips take (the pelvis tipping forward), the spine the rest */
const HINGE = 0.6;

/**
 * How a standing body brings a point of its trunk `above` m over its hips down by `drop` (m): the
 * trunk bows (bending at the hips) for the first BOW of it, the knees bend for the rest, smoothly
 * into and out of the squat's ends (`soft`: never less than this, × height); lower than the squat
 * goes, the trunk bows further. `bow` is how far the bow takes the point down (m), `stoop` how far
 * the pelvis tips forward for it (rad), `ahead` how far the bow takes the point forward of where it
 * is upright (m).
 */
export function lowering(p: Proportions, above: number, drop: number, soft = 0) {
  const H = p.height;
  if (drop <= 0 && soft === 0) return { knees: 0, bow: 0, stoop: 0, ahead: 0 };
  const first = softMin(drop, BOW * H, BEND * H);
  const knees = softMin(soft * H + softplus(drop - first - soft * H - BEND * H, BEND * H), SQUAT * H, BEND * H);
  const bow = clamp(drop - knees, 0, above);
  return { knees, bow, stoop: HINGE * Math.acos(1 - bow / above), ahead: AHEAD * Math.sqrt(bow * (2 * above - bow)) };
}
