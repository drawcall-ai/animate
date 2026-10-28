// A leap: the dip and push off, the flight and the landing the knees take.
import { GRAVITY } from '../../kernel/math';
import { quintic } from './swing';
import type { Leap } from './state';

/**
 * Tuned leap: the dip and push before take-off (s; recalled: games leave the floor within ~0.1 s of
 * the press); how far below standing the feet meet the floor (m); the knees taking the landing over
 * `down` s, as deep as `depth` × the fall's speed × `down` (half that running), rising over `up` s.
 */
const JUMP = { launch: 0.1, contact: 0.02, down: 0.15, depth: 0.25, up: 0.3 };

/**
 * A leap asked (`asked`, its take-off speed) moved on `dt`: dipping, then in the air (landing on a sub-step), the knees taking it, rising
 * again (`run`: 0 … 1 running; `s`: the body's scale).
 */
export function leap(j: Leap, asked: number | undefined, run: number, s: number, dt: number) {
  if (asked !== undefined && (j.phase === 'ground' || j.phase === 'up')) [j.phase, j.since, j.speed] = ['launch', 0, asked];
  j.since += dt;
  if (j.phase === 'landed') [j.phase, j.since, j.bottom, j.a] = ['down', dt, j.rise + JUMP.depth * (1 - run / 2) * j.vy * JUMP.down, -GRAVITY];
  if (j.phase === 'launch') {
    [j.rise, j.vy, j.a] = quintic(j.rise, j.vy, j.a, 0, j.speed, JUMP.launch - j.since + dt, dt);
    // (in the air till the sub-step it falls back to the floor's contact depth)
    const flight = (j.speed + Math.sqrt(j.speed ** 2 + 2 * GRAVITY * JUMP.contact * s)) / GRAVITY;
    if (j.since >= JUMP.launch - 1e-9) [j.phase, j.since, j.land] = ['air', 0, Math.ceil(flight / dt - 1e-6) * dt];
  } else if (j.phase === 'air') {
    const t = Math.min(j.since, j.land);
    [j.rise, j.vy] = [j.speed * t - GRAVITY * t * t / 2, j.speed - GRAVITY * t];
    if (j.since >= j.land - 1e-9) j.phase = 'landed';
  } else if (j.phase === 'down') {
    [j.rise, j.vy, j.a] = quintic(j.rise, j.vy, j.a, j.bottom, 0, JUMP.down - j.since + dt, dt);
    if (j.since >= JUMP.down - 1e-9) [j.phase, j.since] = ['up', 0];
  } else if (j.phase === 'up') {
    [j.rise, j.vy, j.a] = quintic(j.rise, j.vy, j.a, 0, 0, JUMP.up - j.since + dt, dt);
    if (j.since >= JUMP.up - 1e-9) [j.phase, j.rise, j.vy, j.a] = ['ground', 0, 0, 0];
  }
}
