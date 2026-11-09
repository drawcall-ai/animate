// What a step is decided by: the tuned limits its parts share, a turn's way round, how far a foot strays from its hip, a run's speed.
import { wrapAngle } from '../kernel/math';
import type { Stepping, Feet, Leg } from './types';

/**
 * The turn (rad) from facing `from` to `to`: the short way round, but for one more than a quarter turn the other way, the `way` (±1, 0:
 * none) the root went round — spun faster than its feet let the body follow, the root came to lead it by more than half a turn, and turned
 * the short way the body went back against it; but a root spun a little past a whole turn round is not followed the long way round.
 */
export function turnTo(from: number, to: number, way: number): number {
  const turn = wrapAngle(to - from);
  return turn * way < 0 && Math.abs(turn) > Math.PI / 2 ? turn + way * 2 * Math.PI : turn;
}

/** Tuned: a root turning slower than this (rad/s) sets no way round to follow it (`Stepper.way`) */
export const SPUN = 0.5;

/**
 * Tuned: a foot steps once it is due (its gait share of a cycle after the leg before it lifted; standing, after `square` s) and is
 * `distance` (m; standing still and upright: `still`, the stance squared up evenly) off its home, or turned `turn` (rad; still: `squared`)
 * off it; at once if it would hold the pelvis `short` (m) below its height, or is `medial` (m) in from its hip under the body, or a whole
 * stance's travel behind it
 */
export const THRESHOLDS = { distance: 0.06, still: 0.02, turn: (25 * Math.PI) / 180, squared: (2 * Math.PI) / 180, short: 0.03, square: 0.2, medial: 0.1 };
/** Tuned: how long every foot stands planted, none wanting a step, before the legs are settled (s) */
export const SETTLED_AFTER = 0.4;
/** Tuned: one pivot turns the pelvis at most `PIVOTING` (rad) past the way the foot headed as it began: further, its hip turning about
 * the root over a foot that stays, the legs would cross */
export const PIVOTING = 3 * Math.PI / 4;
/** Tuned: a pivoting foot stays turned at most `PIVOTED` (rad) off the pelvis turning over it */
export const PIVOTED = (25 * Math.PI) / 180;
/** Tuned: the pelvis turns toward its facing at most at `TURN` (rad/s², rad/s) */
export const TURN = { accel: 100, speed: 12 };
/** Tuned: slower than `SHUFFLING` (m/s), a walker's feet alternate */
export const SHUFFLING = 0.6;
/** Tuned: the feet let the pelvis down at most `LOWEST` (m: a foot past reach leaves the leg straight instead) */
export const LOWEST = 0.12;
/** Tuned: past `SETTLE` of a swing even a hard stop no longer moves its landing */
export const SETTLE = 0.8;
/** Tuned: a walker's landing moves no more past `AIMED` of its swing */
export const AIMED = 0.55;
/** Tuned: the least share of the narrowest stance a foot landing well ahead of or behind the other keeps from it sideways: walking, the feet
 * pass but never cross */
export const PASSING = 0.4;

/**
 * whether a planted foot is too far in under the body from its hip (`inward`, m, + toward the body's middle): a person's more than
 * `THRESHOLDS.medial`; a leg with its own `stray`, that far either way from where it stands under its hip
 */
export function strayed(st: Stepping, feet: Feet, leg: Leg, inward: number): boolean {
  return strayPast(st, feet, leg, inward) > 0;
}

/** how far (m) a planted foot `inward` from its hip is past straying (≤ 0: within) */
export function strayPast(st: Stepping, feet: Feet, leg: Leg, inward: number): number {
  const stray = feet.legs[leg.i].stray;
  if (stray === undefined) return inward - THRESHOLDS.medial * st.scale;
  return Math.abs(inward - ((feet.legs[leg.i].hip ?? feet.hip) - st.width.stand)) - stray;
}

/** how far in under the body (m) a foot `out` m out from the body's middle line may land and not be `strayed` there */
export function strayRoom(st: Stepping, feet: Feet, leg: Leg, out: number): number {
  const stray = feet.legs[leg.i].stray, hip = feet.legs[leg.i].hip ?? feet.hip;
  if (stray === undefined) return Math.max(0, THRESHOLDS.medial * st.scale - (hip - out));
  return Math.max(0, stray - (hip - out - (hip - st.width.stand)));
}

/** whether `speed` (m/s: measured, asked or foreseen) is a run's, not a walk's: its stride has a flight */
export const runs = (st: Stepping, speed: number) => speed >= st.run[0];
