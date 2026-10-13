// Adapted from the old core (a801be4:packages/core/src/gait/placement.ts): Raibert-style placement
// under where the body will be, Hof's capture rule, and the human limits on a step; without
// obstacles, ground and leaning into a force.
import { Vector3 } from 'three';
import { clamp, forwardOf, leftOf, lerp, smoothstep, wrapAngle } from '../math';
import { bodyYaw, footYaw, stanceFeet } from '../stance';
import { footprint } from './foot';
import type { Gait } from './gait';
import { hullOf, outside } from './support';

/** how far out to its own side of the body a foot lands, at least (m, default body) */
const OWN_SIDE = 0.035;
/** how far to its own side of the other foot a foot lands, at least, as the body faces now (m, default body) */
const UNCROSSED = 0.04;
/** how far inside a step's base the extrapolated centre of mass is caught (m, default body) */
const COVER_MARGIN = 0.03;
/** the speeds (m/s, default body) over which a run turns into a bouncing gait, with flight phases */
const BOUNCING = [2.2, 2.5] as const;

const _homes: [Vector3, Vector3] = [new Vector3(), new Vector3()];
const _travel = new Vector3();
const _f = new Vector3();
const _l = new Vector3();
const _then = new Vector3();
const _bare = new Vector3();
const _away = new Vector3();

/**
 * Where foot `s` should land, flat, predicted `lead` s ahead: under where the body will be, its
 * place in the stance there, out past the extrapolated centre of mass on the side the body
 * drifts to (Hof). Writes the ankle to `out`, returns the foot's heading.
 */
export function placeFoot(g: Gait, s: number, lead: number, out: Vector3): number {
  const { root, velocity: v, stance, p } = g;
  const arc = travel(g, lead, _travel);
  let px = _travel.x;
  let pz = _travel.z;
  const gx = g.goal.x - root.x;
  const gz = g.goal.z - root.z;
  const gl = Math.hypot(gx, gz);
  if (g.starting && gl > 1e-6 && (gx * Math.sin(g.yaw) + gz * Math.cos(g.yaw)) / gl > 0.7) {
    // setting off roughly forward: a moving goal gets a proper first step, a small reposition what it needs
    const first = 0.32 * p.scale;
    const k = (g.goalSpeed > 0.04 || gl > 0.3 ? first : Math.min(gl, first)) / gl;
    px = gx * k;
    pz = gz * k;
  }
  // side-steps aim at where the body has to go, as far as this step gets there
  if (lead > 0) {
    const lx = Math.cos(g.yaw);
    const lz = -Math.sin(g.yaw);
    const ahead = Math.abs(gx * lz - gz * lx);
    const reach = Math.abs(px * lz - pz * lx);
    const need = (gx * lx + gz * lz) * (ahead > reach ? reach / ahead : 1);
    const have = px * lx + pz * lz;
    const want = clamp(need * 0.9, -0.45, 0.45);
    if (Math.abs(want) > Math.abs(have) && Math.sign(want) === Math.sign(need)) {
      px += (want - have) * lx;
      pz += (want - have) * lz;
    }
  }
  // (the facing turns with a curving path: by 2·arc then)
  const facing = g.goalFacing ?? g.goalYaw;
  const yaw = g.yaw + 2 * arc + clamp(wrapAngle(facing - g.yaw), -1.2, 1.2) * clamp(lead * 2.5, 0, 1);
  const narrow = smoothstep(0.1, 0.6, g.speed) * (stance.stagger === 0 ? 1 : 0.3);
  const width = lerp(stance.width, Math.min(stance.width, 0.036 * p.height), narrow);
  stanceFeet(root.x + px, root.z + pz, forwardOf(yaw, _f), leftOf(yaw, _l), p, stance, _homes, width);
  out.copy(_homes[s]);
  // (Hof) the foot on the side the body drifts to lands beyond its extrapolated centre of mass
  if (lead > 0) {
    const lx = Math.cos(yaw);
    const lz = -Math.sin(yaw);
    const c2 = Math.cos(2 * arc);
    const s2 = Math.sin(2 * arc);
    const drift = (v.x * c2 + v.z * s2) * lx + (v.z * c2 - v.x * s2) * lz;
    if (drift * g.feet[s].sign > 0) out.addScaledVector(_l.set(lx, 0, lz), (drift * 1.5) / g.omega);
  }
  return footYaw(yaw, g.feet[s].sign, stance);
}

/**
 * How far the root travels in `time` s, into `out`: the chord of an arc turning at the travel's
 * turn rate, no further than the goal gets. Returns the arc's half angle.
 */
function travel(g: Gait, time: number, out: Vector3): number {
  const v = g.velocity;
  const arc = clamp(0.5 * g.turnRate * time, -0.6, 0.6);
  const chord = Math.abs(arc) > 1e-6 ? Math.sin(arc) / arc : 1;
  const cos = Math.cos(arc) * chord * time;
  const sin = Math.sin(arc) * chord * time;
  out.set(v.x * cos + v.z * sin, 0, v.z * cos - v.x * sin);
  const toGoal = Math.hypot(g.goal.x - g.root.x, g.goal.z - g.root.z) + g.goalTravel(time);
  const l = Math.hypot(out.x, out.z);
  if (l > toGoal && l > 1e-6) out.multiplyScalar(toGoal / l);
  return arc;
}

/**
 * Fits a landing `to` (heading `yaw`) of foot `s` to the body: it catches the body — with the
 * other foot it covers the extrapolated centre of mass as it will be on landing, `ahead` s from
 * now (`xcom` is it now) — and is humanly possible: no crossing over, not under the body, no
 * over-long step. Returns how far that point still lies outside the base (m).
 */
export function fitLanding(g: Gait, s: number, to: Vector3, yaw: number, ahead: number, xcom: Readonly<Vector3>): number {
  predictXcom(g, ahead, xcom, _then);
  _bare.copy(to);
  limit(g, s, _bare, yaw);
  const out = uncovered(g, s, _bare, yaw, _then);
  to.copy(_bare);
  if (out <= 0) return 0;
  const margin = COVER_MARGIN * g.p.scale;
  for (let pass = 0; pass < 3; pass++) {
    const d = uncovered(g, s, to, yaw, _then, _away);
    if (d <= 0) break;
    to.addScaledVector(_away, d + margin);
  }
  limit(g, s, to, yaw);
  const left = uncovered(g, s, to, yaw, _then);
  if (left < out) return left;
  to.copy(_bare);
  return out;
}

/**
 * The extrapolated centre of mass `ahead` s from now (`xcom` now), into `out`: carried along
 * with the root, along a curve swung in as the velocity turns. Running with flight phases is a
 * bouncing gait: only its sideways part is for a landing to catch.
 */
function predictXcom(g: Gait, ahead: number, xcom: Readonly<Vector3>, out: Vector3): Vector3 {
  const v = g.velocity;
  const turn = 2 * travel(g, ahead, _travel);
  const c = Math.cos(turn) - 1;
  const sn = Math.sin(turn);
  out.set(v.x * c + v.z * sn, 0, v.z * c - v.x * sn).divideScalar(g.omega);
  // (bouncing once there is a flight phase, from ~2.3 m/s: until then, the steps catch it fore and aft too)
  const run = smoothstep(BOUNCING[0], BOUNCING[1], g.speed / g.p.scale);
  if (run > 0) {
    const fx = Math.sin(g.yaw);
    const fz = Math.cos(g.yaw);
    const along = ((v.x * fx + v.z * fz) / g.omega) * run;
    out.x -= fx * along;
    out.z -= fz * along;
  }
  out.add(_travel).add(xcom).setY(0);
  // (the goal slowing to a stop, the body stops there too: its extrapolated centre of mass goes no further)
  const speed = Math.hypot(v.x, v.z);
  if (g.goalAccel >= 0 || speed < 1e-3) return out;
  // (the time the goal's velocity carries it on for to its stop: v / −2a)
  const stop = g.goalSpeed / (-2 * g.goalAccel);
  const gx = g.goal.x + g.goalVelocity.x * stop;
  const gz = g.goal.z + g.goalVelocity.z * stop;
  const beyond = ((out.x - gx) * v.x + (out.z - gz) * v.z) / speed;
  if (beyond > 0) out.addScaledVector(v, -beyond / speed);
  return out;
}

/** how far `point` lies outside the base of the other foot (planted) and a landing at `to` */
function uncovered(g: Gait, s: number, to: Vector3, yaw: number, point: Vector3, away?: Vector3): number {
  const other = g.status[1 - s];
  if (other.phase !== 'planted') return 0;
  return outside(hullOf([...footprint(g.p, other.position, other.yaw), ...footprint(g.p, to, yaw)]), point, away);
}

/** how far the extrapolated centre of mass (`xcom`) lies outside the planted feet (0 inside; Infinity with none) */
export function uncaught(g: Gait, xcom: Readonly<Vector3>): number {
  const spots = g.status.flatMap((f) => (f.phase === 'planted' ? footprint(g.p, f.position, f.yaw) : []));
  return spots.length ? outside(hullOf(spots), xcom) : Infinity;
}

/** no crossing over, not under the body, no over-long step */
function limit(g: Gait, s: number, to: Vector3, yaw: number) {
  const other = g.status[1 - s];
  const sign = g.feet[s].sign;
  // (crossing over is judged across the step: halfway between the two feet's headings)
  const from = bodyYaw(other.yaw, g.feet[1 - s].sign, g.stance);
  const across = from + 0.5 * wrapAngle(bodyYaw(yaw, sign, g.stance) - from);
  const H = g.p.height;
  aside(to, other.position, across, sign, 0.05 * H, Math.max(0.05 * H + 0.3 * H, 2.3 * g.stance.width));
  aside(to, other.position, g.yaw, sign, UNCROSSED * g.p.scale, Infinity);
  aside(to, g.root, g.yaw, sign, OWN_SIDE * g.p.scale, Infinity);
  // step length grows with speed; the first steps from standing are short
  const span = Math.hypot(2 * g.stance.width, g.stance.stagger);
  const pace = Math.max(g.speed, g.goalSpeed * 0.5);
  const most = Math.max(1.15 * span, Math.min(lerp(0.55, 1.05, g.run) * H, (0.32 + 0.55 * pace) * g.p.scale));
  const dx = to.x - other.position.x;
  const dz = to.z - other.position.z;
  const dl = Math.hypot(dx, dz);
  if (dl > most) {
    to.x = other.position.x + (dx * most) / dl;
    to.z = other.position.z + (dz * most) / dl;
  }
}

/** keeps `to` between `min` and `max` out to side `sign` of `from`, across a body facing `yaw` */
function aside(to: Vector3, from: Readonly<Vector3>, yaw: number, sign: number, min: number, max: number) {
  const lx = Math.cos(yaw);
  const lz = -Math.sin(yaw);
  const lateral = ((to.x - from.x) * lx + (to.z - from.z) * lz) * sign;
  const want = clamp(lateral, min, max);
  if (want === lateral) return;
  to.x += lx * sign * (want - lateral);
  to.z += lz * sign * (want - lateral);
}
