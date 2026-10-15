// Recalled: Perry (1992) / Winter (2009) normal walking curves, ported from the legged spike.
import type { Proportions } from './proportions';
import { INDEX, SIDES } from './bones';
import type { JointCycle } from '../core/legs/cycle';
import type { LegChain } from '../core/legs/legs';
import type { LegGait } from '../core/legs/gait';
import { powerGait } from '../core/legs/schedule';

/** Recalled: free walk 1.37 m/s, 1.41 m stride, 0.64 s stance (Perry 1992); 1.3 cm toe clearance (Winter 1992). */
// Tuned in the spike: below 0.5 m/s shorten the stride instead of slowing its cadence.
export const humanGait = (p: Proportions): LegGait => powerGait(p.hipHeight, 0.5, [0, 0.5], 2.49, 0.79, [0.013, 0.013]);

/** Recalled: the cycles below follow normal free walking, % of the cycle from heel strike, toe-off at 62% (recalled: Perry 1992; Winter 2009, Biomechanics and Motor Control, App. A) */
const cycle = (keys: [number, number][]): JointCycle => ({ duty: 0.62, keys });
/** Recalled: the hip: 30° flexed at heel strike, extending to −10° by 50%, flexing to ~35° late in the swing */
const HIP = cycle([[0, 30], [0.1, 27], [0.3, 8], [0.5, -10], [0.62, 0], [0.75, 22], [0.87, 33], [0.95, 32]]);
/** Recalled: the knee (− flexed): ~18° in loading response, near straight at mid-stance, ~40° at toe-off, ~60° early in the swing */
const KNEE = cycle([[0, -3], [0.12, -18], [0.25, -12], [0.4, -4], [0.5, -8], [0.62, -38], [0.72, -62], [0.85, -35], [0.95, -4]]);
/** Recalled: the ankle (+ dorsiflexed): plantarflexing 6° after heel strike, ~10° dorsiflexed late in stance, ~18° plantarflexed at toe-off, neutral in the swing */
const ANKLE = cycle([[0, 0], [0.07, -6], [0.3, 8], [0.48, 10], [0.62, -18], [0.7, -12], [0.85, 0], [0.95, 1]]);
/** Recalled: the foot to the floor over the stance (+ toes up): ~18° at heel strike, flat from ~10% to ~31% (heel-off), ~40° heel-up at toe-off (the three rockers) */
const ROCKER: LegChain['rocker'] = [[0, 18], [0.1, 7], [0.17, 0], [0.5, 0], [0.62, -4], [0.8, -16], [0.92, -30], [1, -40]];
// Recalled: ~12 cm between heels at 1.75 m, ~7° toe-out, Perry-shaped stance.
const WIDTH = 0.06;
const TOE_OUT = 0.12;

export function humanLegs(p: Proportions): readonly LegChain[] {
  return SIDES.map((side, s): LegChain => {
    const sign = s === 0 ? 1 : -1;
    return {
      joints: [
        { bone: INDEX[`${side}UpperLeg`], axes: 'yzx', cycle: HIP },
        { bone: INDEX[`${side}LowerLeg`], axes: 'x', cycle: KNEE },
        { bone: INDEX[`${side}Foot`], axes: 'yzx', cycle: ANKLE },
      ],
      heel: p.sole.heel.clone(),
      toe: p.offsets[`${side}Toes`].clone(),
      toes: { bone: INDEX[`${side}Toes`], tip: p.sole.bigToe.clone() },
      toeOut: sign * TOE_OUT,
      width: sign * WIDTH * p.scale,
      rocker: ROCKER,
    };
  });
}
