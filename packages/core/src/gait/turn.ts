import { clamp, smoothstep, wrapAngle, yawOf } from '../math';
import { bodyYaw } from '../stance';
import type { Gait, Root } from './gait';

/** how far the body may twist over its feet before turning waits for a step (rad, ~25°) */
const MAX_TWIST = 0.45;
/** the feet stay this far apart sideways under a turning body (m, default body) */
const MIN_ACROSS = 0.05;
/** turning speed (rad/s) and how quickly the facing closes on its goal (1/s) */
const TURN_RATE = 1.5;
const TURN_GAIN = 5;
/** the travel direction's turning is followed above this speed (m/s), this quickly (1/s) */
const TURN_SPEED = 0.3;
const TURN_TRACK_RATE = 6;
/** people only back up for a short (m), slow (m/s) shuffle to a goal facing away (rad) */
const BACKUP = { dist: 0.6, speed: 0.6, angle: 2.2 };

/**
 * Turn a moving body's facing toward the travel (or the goal's facing, `target` being
 * (dx, dz) and `dist` away), as fast as a body turns (`Gait.turnPace` × walking) and its feet allow.
 */
export function turnRoot(g: Gait, dt: number, target: Root, dx: number, dz: number, dist: number) {
  const pace = g.turnPace;
  const { root } = g;
  const travel = travelYaw(g, dx, dz);
  const far = facesTravel(g, target, travel, dist, g.targetSpeed);
  g.goalYaw = target.yaw + wrapAngle(travel - target.yaw) * far;
  // (a facing that follows a curving path turns with it: no lag behind the travel)
  const e = wrapAngle(g.goalYaw - root.yaw);
  const rate = TURN_RATE * pace;
  const turn = clamp((far * g.turnRate + e * TURN_GAIN * pace) * dt, -rate * dt, rate * dt);
  root.yaw += twistLimit(g, turn);
}

/** how fast the travel direction turns, from the velocity before (vx, vz) and after this tick (smoothed) */
export function trackTurn(g: Gait, vx: number, vz: number, dt: number) {
  const { x, z } = g.velocity;
  const v2 = x * x + z * z;
  // (the direction of a slow body is noise)
  const rate = dt > 0 && v2 > TURN_SPEED * TURN_SPEED ? (z * (x - vx) - x * (z - vz)) / (v2 * dt) : 0;
  g.turnRate += (rate - g.turnRate) * Math.min(1, TURN_TRACK_RATE * dt);
}

/**
 * How far the facing turns to the travel direction (1) rather than the goal's facing (0):
 * the travel direction while going somewhere, the goal's facing as the body slows to a
 * stop (turning around at speed places the feet behind the falling body), and the goal's
 * facing throughout when the steer holds it.
 */
function facesTravel(g: Gait, target: Root, travel: number, dist: number, tvl: number): number {
  // anything longer than a short backward shuffle is walked facing the way the body
  // goes, turning around on arrival
  const backwards = Math.abs(wrapAngle(travel - target.yaw)) > BACKUP.angle && dist < BACKUP.dist && g.speed < BACKUP.speed;
  const going = Math.max(smoothstep(0.25, 0.6, dist), smoothstep(0.5, 0.9, tvl));
  return going * (backwards ? 0 : 1) * g.steer.faceTravel;
}

/** the way the body goes: its velocity's direction once under way, the goal's (dx, dz away) while setting off */
function travelYaw(g: Gait, dx: number, dz: number): number {
  const { x, z } = g.velocity;
  const toGoal = yawOf(dx, dz);
  return toGoal + wrapAngle(yawOf(x, z) - toGoal) * smoothstep(0.35, 0.8, g.speed);
}

/**
 * The body can only twist so far over its feet (hip rotation), and not so far that its
 * feet cross over (a staggered stance turned under the body): turning further waits for a
 * step. The feet are the planted ones and where a swinging foot is landing. Returns the
 * part of `turn` that's allowed (never pulls back).
 */
function twistLimit(g: Gait, turn: number): number {
  let sx = 0;
  let sz = 0;
  for (const f of g.feet) {
    const y = bodyYaw(f.phase === 'swing' ? f.swing.toYaw : f.yaw, f.side, g.stance);
    sx += Math.sin(y);
    sz += Math.cos(y);
  }
  const feetYaw = Math.atan2(sx, sz);
  const yaw = g.root.yaw + turn;
  const d = wrapAngle(yaw - feetYaw);
  if (Math.abs(d) > MAX_TWIST && Math.sign(turn) === Math.sign(d)) return 0;
  // the left foot's lead over the right, across and along the turned body
  const [l, r] = g.feet;
  const a = l.phase === 'swing' ? l.swing.to : l.anchor;
  const b = r.phase === 'swing' ? r.swing.to : r.anchor;
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  const across = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  const along = dx * Math.sin(yaw) + dz * Math.cos(yaw);
  return across < MIN_ACROSS * g.d.scale && turn * along > 0 ? 0 : turn;
}
