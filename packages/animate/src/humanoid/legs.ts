// [C] Recalled: Perry (1992) / Winter (2009) normal walking curves, ported from the legged spike.
import type { Proportions } from './proportions';
import { INDEX, SIDES } from './bones';
import type { JointCycle } from '../core/legs/cycle';
import type { LegChain } from '../core/legs/legs';
import type { Gait } from '../core/legs/gait';
import { powerGait } from '../core/legs/schedule';
import type { Stepping } from '../core/legs/stepper';
import { STANDING_REACH } from './balance/posture';
import { defaultStance } from './stance';

/** Recalled: free walk 1.37 m/s, 1.41 m stride, 0.64 s stance (Perry 1992); 1.3 cm toe clearance (Winter 1992). */
// Tuned in the spike: below 0.5 m/s shorten the stride instead of slowing its cadence.
export const humanGait = (p: Proportions): Gait => powerGait({ height: p.hipHeight, slowest: 0.5, offsets: [0, 0.5], stride: 2.49, stance: 0.79, clearance: [0.013, 0.013] });

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

/**
 * A person's driven stepping (m: the default body's). Recalled (Perry 1992; Novacheck 1998): walking duty 0.62, 1.4 m/s at ~110–120 steps/min;
 * running at 3.5 m/s ~165 steps/min, ~0.25 s contact, a ~0.1 s flight; tuned: a linear `cadence` through both, running between 2 and 3 m/s,
 * side-stepping without a double support (quick, open-and-close steps), the `travel`, the `lead` and `width` (never closer than `narrowest`).
 * Requested: a 3–4 cm pelvis `bob`, lowest after contact (tuned: side-stepping and running `drop` lower for the leg's reach); an 8–12 cm
 * `lift` walking (tuned: a runner's heel kicks higher, peaking at 60% of the swing). Recalled: the heel `strike`s ~10–15° toes-up (Perry 1992;
 * tuned: toes first behind the hip, full `ahead`); the ankle dorsiflexes ~35–40° at most (a deep squat's, below the rig's 40°). Tuned: the
 * planted roll `pitch`, the `crouch` (the hips sit back, so the shanks stay within the ankle's bend), `swingReach` and the sole's `clearance`.
 */
export const humanStepping = (p: Proportions): Stepping => ({
  scale: p.scale, offsets: [0, 0.5], toeOut: defaultStance(p).toeOut, cadence: { base: 1.75, perSpeed: 0.3 }, duty: { walk: 0.62, side: 0.5, run: 0.32 }, run: [2, 3],
  travel: { forward: 0.85, run: 0.75, back: 0.6, side: 0.3 }, lead: { share: 0.4, side: 0.5, most: 0.3, run: 0.22 },
  width: { stand: defaultStance(p).width, walk: 0.09, run: 0.07, narrowest: 0.1 }, bob: 0.035, drop: { walk: 0, side: 0.03, run: 0.06 },
  lift: { walk: 0.09, run: 0.25, jump: 0.2 }, arc: 4.5, strike: { walk: 0.2, run: 0.08, ahead: 0.15 }, pitch: { heel: 0.35, ball: -0.95 }, dorsiflexion: 0.6,
  crouch: { depth: 0.37, wider: 0.04, ahead: 0.14, travel: 0.4, lift: 0.5 }, reach: STANDING_REACH, swingReach: 0.97, clearance: 0.015,
});
