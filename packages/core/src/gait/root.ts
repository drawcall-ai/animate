import { Vector3 } from 'three';
import { clamp, hypot, smoothstep, wrapAngle } from '../math';
import { FOOT_HALF_WIDTH } from './capture';
import type { Gait, Root } from './gait';
import { trackTurn, turnRoot } from './turn';

/** how fast a root that got off its feet is brought back over them (m/s) */
const LEASH_SPEED = 0.6;
/** people brake harder than they accelerate */
const BRAKE_FACTOR = 2.2;
/** the share of the acceleration an approach plans with (arrives without braking hard) */
const PLANNED_ACCEL = 0.8;
/** how quickly the goal's own velocity is picked up (1/s) */
const TARGET_VEL_RATE = 9;
/** a goal moving faster than this (m/s) was re-planned, not carried: it jumped */
const JUMP_SPEED = 4;
/** a walk starts when the goal is this far (m, default body; eager: a tracked part walks), turned (rad) or moving (m/s) */
const START = { dist: 0.14, eagerDist: 0.05, yaw: 0.45, targetSpeed: 0.25, eagerTargetSpeed: 0.1 };
/** it stops once close, slow, the goal still and the facing reached */
const STOP = { dist: 0.05, speed: 0.15, targetSpeed: 0.08, yaw: 0.1 };
/** until the first foot is off the ground the body barely glides (m/s) */
const START_GLIDE = 0.15;
/** how quickly a push's drift dies out while standing (1/s) */
const DRIFT_DECAY = 6;
/** the sideways speed a shuffle of hip-wide steps carries (m/s): faster, a side-step's landing holds the body through the closing step too */
const SHUFFLE = 0.4;

const _vd = new Vector3();

/** Move the root toward `target`: start/stop, accelerate/brake, turn (./turn). */
export function updateRoot(g: Gait, dt: number, target: Root) {
  const { root, velocity: vel } = g;
  const eager = g.steer.eager;
  trackTargetVelocity(g, dt, target);
  const dx = target.x - root.x;
  const dz = target.z - root.z;
  const dist = hypot(dx, dz);
  const yawErr = wrapAngle(target.yaw - root.yaw);
  const tvl = g.targetSpeed;

  // (standing on one foot, or shifting onto it, the body cannot travel)
  if (g.footHeld) g.moving = g.starting = false;
  const startDist = (eager ? START.eagerDist : START.dist) * g.d.scale;
  if (!g.moving && !g.footHeld && (dist > startDist || Math.abs(yawErr) > START.yaw || tvl > (eager ? START.eagerTargetSpeed : START.targetSpeed))) {
    g.moving = true;
    // gait initiation: the first step goes at once, the body falls into it
    // (not from a crouch: that's a reposition, handled with care)
    g.starting = !g.steer.crouched;
  }
  if (g.starting && (g.feet[0].phase !== 'planted' || g.feet[1].phase !== 'planted')) g.starting = false;

  const vx = vel.x;
  const vz = vel.z;
  if (g.moving) {
    const vd = desiredVelocity(g, dx, dz, dist, _vd);
    const dvx = vd.x - vel.x;
    const dvz = vd.z - vel.z;
    const dvl = hypot(dvx, dvz);
    const braking = vd.x * vel.x + vd.z * vel.z < vel.x * vel.x + vel.z * vel.z;
    const maxDv = (braking ? BRAKE_FACTOR * g.accel : g.accel) * dt;
    const s = dvl > maxDv ? maxDv / dvl : 1;
    vel.x += dvx * s;
    vel.z += dvz * s;
    root.x += vel.x * dt;
    root.z += vel.z * dt;
    leashToFeet(g, dt);

    turnRoot(g, dt, target, dx, dz, dist);

    if (dist < STOP.dist && g.speed < STOP.speed && tvl < STOP.targetSpeed && Math.abs(yawErr) < STOP.yaw) {
      g.moving = false;
      g.starting = false;
      vel.set(0, 0, 0);
    }
  } else {
    // (a push while standing still carries the body a little, then the feet catch it; a
    // stride carries it itself)
    const carried = g.feet[0].striding > 0 || g.feet[1].striding > 0;
    if (!carried) {
      root.x += vel.x * dt;
      root.z += vel.z * dt;
      vel.multiplyScalar(Math.max(0, 1 - DRIFT_DECAY * dt));
      leashToFeet(g, dt);
    }
    g.goalYaw = root.yaw;
    // (a stride turns the body over the standing foot toward the facing asked: the hips open)
    if (g.feet[0].striding > 0.5 || g.feet[1].striding > 0.5) turnRoot(g, dt, target, dx, dz, dist);
  }
  trackTurn(g, vx, vz, dt);
  const walkTarget = smoothstep(0.08, 0.6, g.speed);
  g.walk += (walkTarget - g.walk) * Math.min(1, dt * 6);
}

/** Follow how the goal moves (feed-forward: moving targets are tracked without lag), then take it. */
function trackTargetVelocity(g: Gait, dt: number, target: Root) {
  if (dt > 0) {
    const k = 1 - Math.exp(-TARGET_VEL_RATE * dt);
    const jx = target.x - g.target.x;
    const jz = target.z - g.target.z;
    // only continuous goal motion counts as velocity; a re-planned (jumping) goal doesn't
    const jump = hypot(jx, jz) > JUMP_SPEED * dt;
    const tvx = jump ? 0 : jx / dt;
    const tvz = jump ? 0 : jz / dt;
    g.targetVel.x += (tvx - g.targetVel.x) * k;
    g.targetVel.z += (tvz - g.targetVel.z) * k;
  }
  Object.assign(g.target, target);
}

/** The ground velocity that closes (dx, dz) — `dist` away — and arrives at rest, within the speed limit. */
function desiredVelocity(g: Gait, dx: number, dz: number, dist: number, out: Vector3): Vector3 {
  const maxSpeed = g.maxSpeed;
  const catchUp = Math.min(maxSpeed, Math.sqrt(2 * g.accel * PLANNED_ACCEL * dist), 2.5 * dist + 0.4 * Math.sqrt(dist));
  const kk = dist > 1e-6 ? catchUp / dist : 0;
  let vdx = g.targetVel.x + dx * kk;
  let vdz = g.targetVel.z + dz * kk;
  // brake to arrive: speed toward the goal beyond what the goal itself does is
  // limited by the stopping distance
  if (dist > 1e-6) {
    const ux = dx / dist;
    const uz = dz / dist;
    const along = vdx * ux + vdz * uz;
    const cap = Math.max(0, g.targetVel.x * ux + g.targetVel.z * uz) + Math.sqrt(2 * BRAKE_FACTOR * g.accel * PLANNED_ACCEL * dist);
    if (along > cap) {
      vdx -= (along - cap) * ux;
      vdz -= (along - cap) * uz;
    }
  }
  const cap = g.starting ? Math.min(START_GLIDE, maxSpeed) : maxSpeed;
  const vdl = hypot(vdx, vdz);
  if (vdl > cap) {
    vdx *= cap / vdl;
    vdz *= cap / vdl;
  }
  return out.set(vdx, 0, vdz);
}

/**
 * The body can't outrun its feet: its sideways velocity is bounded so its extrapolated
 * centre of mass stays within the lateral span of the feet — where they stand, or where a
 * swing lands (forward walking has its own Raibert rhythm): a side-step carries the body
 * as far as the stepping foot reaches, no further. "Sideways" is judged against the
 * facing the body is turning to, not its current one: mid-turn (walking up, then turning
 * around to sit) the travel would otherwise read as sideways and be braked into a drift.
 */
function leashToFeet(g: Gait, dt: number) {
  const { root, velocity: vel, d } = g;
  const lx = Math.cos(g.goalYaw);
  const lz = -Math.sin(g.goalYaw);
  const v = vel.x * lx + vel.z * lz;
  // (a fast side-step's landing has to hold the body through the closing step after it too)
  const closing = Math.sign(v) * Math.max(0, Math.abs(v) - SHUFFLE) * 1.5 * g.timing().swing;
  let lo = Infinity;
  let hi = -Infinity;
  for (const f of g.feet) {
    // (a foot held up still marks the stance the root stands in)
    const p = f.footing;
    const l = (p.x - root.x) * lx + (p.z - root.z) * lz - (f.phase === 'swing' ? closing : 0);
    lo = Math.min(lo, l);
    hi = Math.max(hi, l);
  }
  const edge = FOOT_HALF_WIDTH * d.scale;
  const w0 = g.capture.omega;
  // the root's own extrapolated centre of mass (v/ω0 ahead), and the posed body's with its
  // sway and lean, within the feet; a root off its feet comes back at a walking pace
  const p = g.capture.point;
  const q = (p.x - root.x) * lx + (p.z - root.z) * lz;
  let want = clamp(v, Math.min((lo - edge) * w0, LEASH_SPEED), Math.max((hi + edge) * w0, -LEASH_SPEED));
  want -= (Math.max(0, q - hi - edge) - Math.max(0, lo - edge - q)) * w0;
  if (want === v) return;
  // (steered, not snapped: no velocity jumps)
  const dv = (want - v) * Math.min(1, 10 * dt);
  vel.x += dv * lx;
  vel.z += dv * lz;
}

