// The pace a person's walk keeps: how fast its posture takes up what it is asked, when a walk starts and stops — read by both legs.
import { follow } from '../../core/follow';

/** how fast `lower` (m/s², m/s) and `bow` (rad/s², rad/s) are taken up and given back: a squat's pace */
export const BOW = { accel: 6, speed: 1.2 };
/** how fast the pelvis (m/s²) and the trunk's joints (rad/s²) may change their motion: the gait's own oscillations, braked only at their kinks */
export const PELVIS = { accel: 30 };
export const TURN = { accel: 60 };

/** how quickly the goal's own velocity is picked up (1/s) */
export const GOAL_VELOCITY_RATE = 9;
/** a goal moving faster than this (m/s) was re-planned, not carried: it jumped */
export const JUMP_SPEED = 4;
/** a walk starts when the goal is this far (m, default body), turned (rad; a facing asked: `faced`, just past where it stops) or moving (m/s) */
export const START = { distance: 0.14, yaw: 0.45, faced: 0.12, speed: 0.25 };
/** it stops once close, slow, the goal still and the facing reached */
export const STOP = { distance: 0.05, speed: 0.15, goalSpeed: 0.08, yaw: 0.1 };
/** until the first foot is off the ground the body barely glides (m/s) */
export const START_GLIDE = 0.15;

/** a scalar followed to `goal` from its history (`[prev2, prev]`, shifted on) */
export function followed(history: number[], goal: number, motion: { accel: number; speed: number }, dt: number): number {
  const next = follow(history[0], history[1], goal, motion, dt);
  [history[0], history[1]] = [history[1], next];
  return next;
}
