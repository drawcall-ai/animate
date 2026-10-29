// Recalled: Perry (1992) / Winter (2009) normal walking curves.
import type { Proportions } from '../../species/humanoid/proportions';
import type { Gait } from '../../species/gait';
import { powerGait, stanceOf } from '../../species/schedule';
import type { Stepping } from '../step/state';
import { squatOf, STANDING_REACH } from './posture';
import { lerp } from '../../kernel/math';
import { defaultStance } from '../../species/humanoid/stance';
import type { Stride } from '../../species/humanoid/humanoid';
import { TUNED, type Individual } from './individual';

/** Recalled: free walk 1.37 m/s, 1.41 m stride, 0.64 s stance (Perry 1992); 1.3 cm toe clearance (Winter 1992); tuned: below 0.5 m/s the stride
 * shortens instead of its cadence slowing. */
export const humanGait = (proportions: Proportions): Gait => powerGait({
  height: proportions.hipHeight, slowest: 0.5, offsets: [0, 0.5], stride: 2.49,
  stance: stanceOf(0.79, 1, proportions.hipHeight), clearance: [0.013, 0.013],
});

/**
 * A person's stepping (m: the default body's, × its legs' length over theirs: the legs set its steps, stance and lift), striding as
 * `style` has it and as the `individual` it is. Its `cadence` is `cadenceOf`'s; recalled (Perry 1992): stance ~60% of the cycle walking; tuned: running between 2 and
 * 3 m/s, the `travel`, the `lead` and `width` (never closer than `narrowest`). Requested: a 3–4 cm pelvis `bob` (tuned ~4 cm, lowest in
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
export const humanStepping = (proportions: Proportions, foreseen = true, style: Stride = {}, individual: Individual = TUNED): Stepping => {
  const { cadence = 1, width = 1, bob = 1, toeOut = 1 } = style;
  const walker: Stepping = {
    scale: proportions.legs, offsets: [0, 0.5], toeOut: defaultStance(proportions).toeOut * toeOut, duty: { walk: 0.6, side: 0.5, run: 0.32 }, run: [2, 3],
    cadence: (speed, sideways, time) => cadence * individual.cadenceAt(time) * cadenceOf(speed, foreseen ? sideways : 0, proportions.legs),
    travel: { forward: 0.85, run: 0.75, back: 0.6, side: 0.3 }, lead: { share: 0.4, side: 0.5, most: 0.3, run: 0.22 },
    width: { stand: defaultStance(proportions).width, walk: 0.09 * width, run: 0.07 * width, narrowest: 0.1, sway: 0.09 * (width - 1) }, bob: 0.042 * bob, drop: { walk: 0, side: 0.03, run: 0.06 },
    lift: { walk: 0.09, run: 0.25, jump: 0.2 }, arc: 4.5, strike: { walk: 0.2, run: 0.08, ahead: 0.15 }, pitch: { heel: 0.35, ball: -0.95 }, dorsiflexion: 0.6, plantarflexion: 0.75,
    push: 20 * Math.PI / 180,
    crouch: { depth: squatOf(proportions) / proportions.scale, wider: 0, ahead: 0.14, travel: 0.4, lift: 0.5 },
    reach: 0.997, swingReach: 0.97, clearance: 0.015, capture: 0.07,
  };
  if (foreseen) return walker;
  return { ...walker, duty: { ...walker.duty, walk: 0.62 }, bob: 0.035 * bob, reach: STANDING_REACH,
    crouch: { ...walker.crouch, depth: 0.37, wider: 0.04 }, capture: undefined, push: undefined };
};

/**
 * A person's cadence (cycles a second, two steps each) at `speed` (m/s) and a share of it `sideways` (0 … 1), on legs `legs` × the
 * default body's: dynamically similar to the default body's (recalled: at one Froude number v²/(g·L), legged animals of any size step
 * alike, Alexander & Jayes 1983), its pace v / √legs and its cadence that one's / √legs — longer legs stepping slower at a pace. On the
 * default body, steps a second linear in the pace: `WALKING`'s walking and running, side-stepping from `SIDE_STEPPING`'s base.
 * Recalled: ~110–120 steps/min walking at 1.4 m/s (Perry 1992), ~165 running at 3.5 m/s with ~0.25 s contact and a ~0.1 s flight
 * (Novacheck 1998). Read: from preferred to fast walking a step's length over the steps a minute — the walk ratio — stays near
 * 0.0066 m, about √(60 v / 0.0066) steps a minute, rising below 60 m/min (Sekiya & Nagasaki 1998, as cited by Sakuma et al. 2025 and
 * Front. Hum. Neurosci. 2021, 10.3389/fnhum.2021.779920). The line is tuned quicker than both, most at a slow walk: ~130 a minute at
 * 1.4 m/s, ~122 at 0.92 m/s against the walk ratio's ~91, 105 standing; the walks, reaches and catches here are tuned on it.
 */
function cadenceOf(speed: number, sideways: number, legs: number): number {
  const scaled = speed / Math.sqrt(legs), walked = lerp(WALKING.base, SIDE_STEPPING.base, sideways) + WALKING.perSpeed * scaled;
  return walked / 2 / Math.sqrt(legs);
}

const WALKING = { base: 1.75, perSpeed: 0.3 }, SIDE_STEPPING = { base: 2.7 };
