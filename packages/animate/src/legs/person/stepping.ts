// Recalled: Perry (1992) / Winter (2009) normal walking curves.
import type { Proportions } from '../../species/humanoid/proportions';
import type { Gait } from '../../species/gait';
import { powerGait, stanceOf } from '../../species/schedule';
import type { Stepping } from '../step/state';
import { squatOf, STANDING_REACH } from './posture';
import { defaultStance } from '../../species/humanoid/stance';

/** Recalled: free walk 1.37 m/s, 1.41 m stride, 0.64 s stance (Perry 1992); 1.3 cm toe clearance (Winter 1992). */
// Tuned in the spike: below 0.5 m/s shorten the stride instead of slowing its cadence.
export const humanGait = (p: Proportions): Gait => powerGait({ height: p.hipHeight, slowest: 0.5, offsets: [0, 0.5], stride: 2.49, stance: stanceOf(0.79, 1, p.hipHeight), clearance: [0.013, 0.013] });

/**
 * A person's stepping (m: the default body's, × its legs' length over theirs: the legs set its steps, stance and lift). Recalled (Perry 1992;
 * Novacheck 1998): walking at 1.4 m/s ~110–120 steps/min, stance ~60% of the cycle; running at 3.5 m/s ~165 steps/min, ~0.25 s contact, a
 * ~0.1 s flight; tuned: a linear `cadence` through both, running between 2 and 3 m/s, side-stepping without a double support at the
 * `side` cadence's base (short quick open-and-close steps, its feet a stance or so apart, rather than straddles of a whole cycle's
 * travel), the `travel`, the `lead` and `width` (never closer than `narrowest`). Requested: a 3–4 cm pelvis `bob` (tuned ~4 cm, lowest in
 * the double support; side-stepping and running `drop` lower for the leg's reach); an 8–12 cm `lift` walking (tuned: a runner's heel
 * kicks higher, peaking at 60% of the swing). Recalled: the heel `strike`s ~10–15° toes-up (Perry 1992; tuned: toes first behind the
 * hip, full `ahead`); the ankle dorsiflexes ~35–40° at most (a deep squat's, below the rig's 40°), plantarflexes ~20° just after toe-off
 * at any walking speed (`push`; Perry 1992, Winter 1991), and is planned within ~43° pointing, leaving reserve inside the rig's 50° stop.
 * Tuned: the planted roll `pitch`; the stance leg near straight at mid-stance (`reach`; Perry's ~5–10° of knee flexion); a `crouch` as
 * deep as `squatOf` (the hips sit back, so the shanks stay within the ankle's bend); `swingReach` and the sole's `clearance`. Its balance
 * is caught by a step once the extrapolated centre of mass is `capture` past the feet: the trailing foot leaves the floor as it would
 * fall past them (tuned; the checks allow 0.1) — a person's toe-off ~10% of the cycle after the other heel strikes (recalled: Perry 1992).
 *
 * `foreseen` false: under a root that does not say where it goes — a player's, which may start, stop or turn at 10 m/s² any sub-step —
 * the legs only follow it (no catch: a step aimed at a balance the root may undo the next sub-step), its stance 62% (recalled: Winter
 * 1991), its bob 3.5 cm, its knees a little softer, its side-steps at the walking cadence and no push-off: tuned to keep such a root's
 * steps clean; its `crouch` a player's crouch key's (0.37 m, the feet 4 cm wider), not a squat.
 */
export const humanStepping = (p: Proportions, foreseen = true): Stepping => {
  const walker: Stepping = {
    scale: p.legs, offsets: [0, 0.5], toeOut: defaultStance(p).toeOut, cadence: { base: 1.75, perSpeed: 0.3, side: 2.7 }, duty: { walk: 0.6, side: 0.5, run: 0.32 }, run: [2, 3],
    travel: { forward: 0.85, run: 0.75, back: 0.6, side: 0.3 }, lead: { share: 0.4, side: 0.5, most: 0.3, run: 0.22 },
    width: { stand: defaultStance(p).width, walk: 0.09, run: 0.07, narrowest: 0.1 }, bob: 0.042, drop: { walk: 0, side: 0.03, run: 0.06 },
    lift: { walk: 0.09, run: 0.25, jump: 0.2 }, arc: 4.5, strike: { walk: 0.2, run: 0.08, ahead: 0.15 }, pitch: { heel: 0.35, ball: -0.95 }, dorsiflexion: 0.6, plantarflexion: 0.75,
    push: 20 * Math.PI / 180, crouch: { depth: squatOf(p) / p.scale, wider: 0, ahead: 0.14, travel: 0.4, lift: 0.5 }, reach: 0.997, swingReach: 0.97, clearance: 0.015, capture: 0.07,
  };
  if (foreseen) return walker;
  return { ...walker, cadence: { base: 1.75, perSpeed: 0.3 }, duty: { ...walker.duty, walk: 0.62 }, bob: 0.035, reach: STANDING_REACH,
    crouch: { ...walker.crouch, depth: 0.37, wider: 0.04 }, capture: undefined, push: undefined };
};
