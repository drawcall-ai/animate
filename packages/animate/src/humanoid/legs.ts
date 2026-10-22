// [C] Recalled: Perry (1992) / Winter (2009) normal walking curves, ported from the legged spike.
import type { Proportions } from './proportions';
import type { Gait } from '../core/legs/gait';
import { powerGait, stanceOf } from '../core/legs/schedule';
import type { Stepping } from '../core/legs/stepper';
import { STANDING_REACH } from './posture/posture';
import { defaultStance } from './stance';

/** Recalled: free walk 1.37 m/s, 1.41 m stride, 0.64 s stance (Perry 1992); 1.3 cm toe clearance (Winter 1992). */
// Tuned in the spike: below 0.5 m/s shorten the stride instead of slowing its cadence.
export const humanGait = (p: Proportions): Gait => powerGait({ height: p.hipHeight, slowest: 0.5, offsets: [0, 0.5], stride: 2.49, stance: stanceOf(0.79, 1, p.hipHeight), clearance: [0.013, 0.013] });

/**
 * A person's driven stepping (m: the default body's). Recalled (Perry 1992; Novacheck 1998): walking duty 0.62, 1.4 m/s at ~110–120 steps/min;
 * running at 3.5 m/s ~165 steps/min, ~0.25 s contact, a ~0.1 s flight; tuned: a linear `cadence` through both, running between 2 and 3 m/s,
 * side-stepping without a double support (quick, open-and-close steps), the `travel`, the `lead` and `width` (never closer than `narrowest`).
 * Requested: a 3–4 cm pelvis `bob`, lowest after contact (tuned: side-stepping and running `drop` lower for the leg's reach); an 8–12 cm
 * `lift` walking (tuned: a runner's heel kicks higher, peaking at 60% of the swing). Recalled: the heel `strike`s ~10–15° toes-up (Perry 1992;
 * tuned: toes first behind the hip, full `ahead`); the ankle dorsiflexes ~35–40° at most (a deep squat's, below the rig's 40°).
 * Plantarflexion is planned within ~43°, leaving reserve inside the rig's 50° stop. Tuned: the
 * planted roll `pitch`, the `crouch` (the hips sit back, so the shanks stay within the ankle's bend), `swingReach` and the sole's `clearance`.
 */
export const humanStepping = (p: Proportions): Stepping => ({
  scale: p.scale, offsets: [0, 0.5], toeOut: defaultStance(p).toeOut, cadence: { base: 1.75, perSpeed: 0.3 }, duty: { walk: 0.62, side: 0.5, run: 0.32 }, run: [2, 3],
  travel: { forward: 0.85, run: 0.75, back: 0.6, side: 0.3 }, lead: { share: 0.4, side: 0.5, most: 0.3, run: 0.22 },
  width: { stand: defaultStance(p).width, walk: 0.09, run: 0.07, narrowest: 0.1 }, bob: 0.035, drop: { walk: 0, side: 0.03, run: 0.06 },
  lift: { walk: 0.09, run: 0.25, jump: 0.2 }, arc: 4.5, strike: { walk: 0.2, run: 0.08, ahead: 0.15 }, pitch: { heel: 0.35, ball: -0.95 }, dorsiflexion: 0.6, plantarflexion: 0.75,
  crouch: { depth: 0.37, wider: 0.04, ahead: 0.14, travel: 0.4, lift: 0.5 }, reach: STANDING_REACH, swingReach: 0.97, clearance: 0.015,
});
