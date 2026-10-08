import { Vector3 } from 'three';
import { clamp, forwardOf, GRAVITY, hypot, leftOf, lerp, smoothstep, wrapAngle } from '../math';
import { bodyYaw, footYaw, stanceFeet } from '../stance';
import type { Gait } from './gait';
import { avoidLandingOn, groundAt } from './obstacles';

/** how far out to its own side of the body a foot lands, at least (m, default body) */
const OWN_SIDE = 0.035;
/** how far to its own side of the other foot a foot lands, at least, as the body faces now (m, default body) */
const UNCROSSED = 0.04;
/** how far inside a step's base the extrapolated centre of mass is caught (m, default body) */
const COVER_MARGIN = 0.03;

const _homes: [Vector3, Vector3] = [new Vector3(), new Vector3()];
const _away = new Vector3();
const _bare = new Vector3();
const _then = new Vector3();
const _travel = new Vector3();
const _l = new Vector3();
const _f = new Vector3();

/**
 * Where foot `s` should land, flat, predicted `lead` seconds ahead (Raibert-style:
 * under where the body will be). Writes the ankle to `out`, returns the foot's yaw.
 */
export function desiredAnchor(g: Gait, s: number, lead: number, out: Vector3): number {
  const { root, velocity: vel, target, stance, d } = g;
  const arc = travel(g, lead, _travel);
  let px = _travel.x;
  let pz = _travel.z;
  if (g.starting) {
    const gx = target.x - root.x;
    const gz = target.z - root.z;
    const gl = hypot(gx, gz);
    // (setting off roughly forward; sideways/diagonal starts use need-based stepping)
    const fwdness = gl > 1e-6 ? (gx * Math.sin(root.yaw) + gz * Math.cos(root.yaw)) / gl : 0;
    if (gl > 1e-6 && fwdness > 0.7) {
      // a moving goal (someone setting off) gets a proper first step, a small
      // reposition just what it needs
      const going = g.targetSpeed > 0.04 || gl > 0.3;
      const first = 0.32 * d.scale;
      const k = (going ? first : Math.min(gl, first)) / gl;
      px = gx * k;
      pz = gz * k;
    }
  }
  // side-steps aim at where the body has to go, not just where it's drifting
  // (otherwise a lagging root makes short steps, which keep it lagging) — as far as this
  // step gets there: a goal further ahead is walked to, its sideways offset shared out
  // along the way (not side-stepped at once)
  if (lead > 0) {
    const lx = Math.cos(root.yaw);
    const lz = -Math.sin(root.yaw);
    const dx = target.x - root.x;
    const dz = target.z - root.z;
    const ahead = Math.abs(dx * lz - dz * lx);
    const reach = Math.abs(px * lz - pz * lx);
    const need = (dx * lx + dz * lz) * (ahead > reach ? reach / ahead : 1);
    const have = px * lx + pz * lz;
    const want = clamp(need * 0.9, -0.45, 0.45);
    if (Math.abs(want) > Math.abs(have) && Math.sign(want) === Math.sign(need)) {
      px += (want - have) * lx;
      pz += (want - have) * lz;
    }
  }
  // (the facing turns with a curving path: by 2·arc then)
  const yawPred = root.yaw + 2 * arc * g.steer.faceTravel + clamp(wrapAngle(g.goalYaw - root.yaw), -1.2, 1.2) * clamp(lead * 2.5, 0, 1);
  // (by the pace, not the walk's smoothed amount: the steps that stop the body widen into the stance)
  const walkNarrow = smoothstep(0.1, 0.6, g.speed) * (stance.stagger === 0 ? 1 : 0.3);
  const width = lerp(stance.width, Math.min(stance.width, 0.036 * d.height), walkNarrow);
  // (leaning into a force at the hands, the feet stand that far behind the body)
  const lean = g.steer.lean;
  stanceFeet(root.x + px - lean.x, root.z + pz - lean.z, forwardOf(yawPred, _f), leftOf(yawPred, _l), d, stance, _homes, width);
  out.copy(_homes[s]);
  // (Hof) the foot on the side the body drifts to lands beyond its extrapolated centre of
  // mass: out by the sideways speed over ω0, or the body falls past it before the next step
  if (lead > 0) {
    const lx = Math.cos(yawPred);
    const lz = -Math.sin(yawPred);
    // (judged by the velocity then: along a curve the travel turns with the facing)
    const c2 = Math.cos(2 * arc);
    const s2 = Math.sin(2 * arc);
    const drift = (vel.x * c2 + vel.z * s2) * lx + (vel.z * c2 - vel.x * s2) * lz;
    if (drift * g.feet[s].side > 0) out.addScaledVector(_l.set(lx, 0, lz), drift * 1.5 / Math.sqrt(GRAVITY / d.legLength));
  }
  return footYaw(yawPred, g.feet[s].side, stance);
}

/**
 * How far the root travels in `time` s, into `out` (x, z): along the curving path — the
 * chord of an arc turning at the travel's turn rate (a straight extrapolation lands the
 * feet outside the curve) — and no further than the goal gets. Returns the arc's half angle.
 */
function travel(g: Gait, time: number, out: Vector3): number {
  const { root, velocity: vel, target } = g;
  const arc = clamp(0.5 * g.turnRate * time, -0.6, 0.6);
  const chord = Math.abs(arc) > 1e-6 ? Math.sin(arc) / arc : 1;
  const cos = Math.cos(arc) * chord * time;
  const sin = Math.sin(arc) * chord * time;
  out.set(vel.x * cos + vel.z * sin, 0, vel.z * cos - vel.x * sin);
  const toT = hypot(target.x - root.x, target.z - root.z) + g.targetSpeed * time;
  const l = hypot(out.x, out.z);
  if (l > toT && l > 1e-6) out.multiplyScalar(toT / l);
  return arc;
}

/**
 * Fit a landing to the body: it catches the body (covers its extrapolated centre of mass,
 * with the other foot), is humanly possible (no crossing over, not under the body, no
 * over-long step) and never on an obstacle. `landingYaw`: the foot's heading at landing — lateral order is judged in
 * the frame the body will have then (it keeps turning while the foot is in the air).
 * Returns true when the step is planned: moved around an obstacle, or onto other ground.
 */
export function fitLanding(g: Gait, s: number, to: Vector3, landingYaw: number, ahead: number): boolean {
  refitLanding(g, s, to, landingYaw, ahead);
  const moved = avoidLandingOn(g, s, to);
  // (standing on the ground there)
  to.y = groundAt(g.steer.ground, to.x, to.z) + g.d.ankleHeight;
  return moved || Math.abs(to.y - g.feet[s].anchor.y) > 0.01;
}

/**
 * `fitLanding` without the way around obstacles. What the landing must catch is the
 * extrapolated centre of mass when the foot comes down, `ahead` s from now (the point as it
 * is at lift-off lies back along the path — on a curve, aside of the line between the feet:
 * covering it throws the landing out wide, and later back in). Returns how far that point
 * still lies outside the base (m).
 */
export function refitLanding(g: Gait, s: number, to: Vector3, landingYaw: number, ahead: number): number {
  predictXcom(g, ahead, _then);
  _bare.copy(to);
  limit(g, s, _bare, landingYaw);
  const out = uncovered(g, s, _bare, landingYaw, _then);
  to.copy(_bare);
  if (out <= 0) return 0;
  cover(g, s, to, landingYaw, _then);
  limit(g, s, to, landingYaw);
  const left = uncovered(g, s, to, landingYaw, _then);
  // (a cover the limits undo — the point lies beyond the other foot — is no cover: that
  // foot has to step out next)
  if (left < out) return left;
  to.copy(_bare);
  return out;
}

/**
 * The extrapolated centre of mass `ahead` s from now, into `out`: carried along with the
 * root and, along a curve, swung in with the velocity turning (v/ω0 ahead of the body).
 * Running is a bouncing gait, not an inverted pendulum: the stance leg brakes and relaunches
 * the body, so the pendulum's run-out ahead (v/ω0, a metre at 3 m/s) is no point for the
 * landing to reach — only its sideways part is (a runner still lands under a sideways fall).
 */
function predictXcom(g: Gait, ahead: number, out: Vector3): Vector3 {
  const { velocity: v, capture, root } = g;
  const turn = 2 * travel(g, ahead, _travel);
  const c = Math.cos(turn) - 1;
  const sn = Math.sin(turn);
  out.set(v.x * c + v.z * sn, 0, v.z * c - v.x * sn).divideScalar(capture.omega);
  // (once there is a flight phase: the stepping switches to its clock at run 0.5)
  const run = smoothstep(0.5, 1, g.run);
  if (run > 0) {
    const fx = Math.sin(root.yaw);
    const fz = Math.cos(root.yaw);
    const along = ((v.x * fx + v.z * fz) / capture.omega) * run;
    out.x -= fx * along;
    out.z -= fz * along;
  }
  return out.add(_travel).add(capture.point);
}

/** how far the extrapolated centre of mass `ahead` s from now lies outside the base of the other foot and foot `s` at `to` (`refitLanding`'s measure) */
export function uncaughtBy(g: Gait, s: number, to: Vector3, yaw: number, ahead: number): number {
  return uncovered(g, s, to, yaw, predictXcom(g, ahead, _then));
}

/**
 * How far `point` lies outside the base of the other foot and a landing at `to` (0 while
 * that foot isn't planted); `away` gets the direction out toward it.
 */
function uncovered(g: Gait, s: number, to: Vector3, yaw: number, point: Vector3, away?: Vector3): number {
  const other = g.feet[1 - s];
  return other.phase === 'planted' ? g.capture.outsideOf(point, other.anchor, other.yaw, to, yaw, away) : 0;
}

/** no crossing over, not under the body, no over-long step */
function limit(g: Gait, s: number, to: Vector3, landingYaw: number) {
  // (crossing over is judged across the step: halfway between the headings the two feet
  // have — along a curve the body's heading now would read the curve as a cross-over)
  const other = g.feet[1 - s];
  const from = bodyYaw(other.phase === 'swing' ? other.swing.toYaw : other.yaw, other.side, g.stance);
  limitLateral(g, s, to, from + 0.5 * wrapAngle(bodyYaw(landingYaw, g.feet[s].side, g.stance) - from));
  uncross(g, s, to);
  ownSide(g, s, to);
  limitReach(g, s, to);
}

/**
 * A foot lands on its own side of the body, never under it: the body sways toward the
 * standing foot, and one right under it leaves nothing to catch the sway.
 */
export function ownSide(g: Gait, s: number, to: Vector3) {
  const { root } = g;
  const side = g.feet[s].side;
  const lx = Math.cos(root.yaw);
  const lz = -Math.sin(root.yaw);
  const lateral = ((to.x - root.x) * lx + (to.z - root.z) * lz) * side;
  const min = OWN_SIDE * g.d.scale;
  if (lateral >= min) return;
  to.x += lx * side * (min - lateral);
  to.z += lz * side * (min - lateral);
}

/**
 * Capture-point stepping (Hof): the base the step leaves — the other, planted foot and
 * this landing — must hold the extrapolated centre of mass (`point`, as the landing will
 * find it), or the body falls past its feet. Moves the landing out past it (a few passes:
 * moving the footprint also turns the hull's edges between the feet).
 */
function cover(g: Gait, s: number, to: Vector3, yaw: number, point: Vector3) {
  const margin = COVER_MARGIN * g.d.scale;
  for (let pass = 0; pass < 3; pass++) {
    const out = uncovered(g, s, to, yaw, point, _away);
    if (out <= 0) return;
    to.addScaledVector(_away, out + margin);
  }
}

function limitLateral(g: Gait, s: number, to: Vector3, fy: number) {
  const other = g.feet[1 - s];
  const side = g.feet[s].side;
  const lx = Math.cos(fy);
  const lz = -Math.sin(fy);
  const at = other.footing;
  const lateral = ((to.x - at.x) * lx + (to.z - at.z) * lz) * side;
  const minLat = 0.05 * g.d.height;
  // side-steps are short shuffles: the feet never spread much wider than the hips
  const maxLat = Math.max(minLat + 0.3 * g.d.height, 2.3 * g.stance.width);
  const clampLat = clamp(lateral, minLat, maxLat);
  if (clampLat === lateral) return;
  to.x += lx * side * (clampLat - lateral);
  to.z += lz * side * (clampLat - lateral);
}

/** and as the body faces now, the feet never cross: the landing stays a little to its own side of the other foot */
function uncross(g: Gait, s: number, to: Vector3) {
  const side = g.feet[s].side;
  const at = g.feet[1 - s].footing;
  const lx = Math.cos(g.root.yaw);
  const lz = -Math.sin(g.root.yaw);
  const lateral = ((to.x - at.x) * lx + (to.z - at.z) * lz) * side;
  const min = UNCROSSED * g.d.scale;
  if (lateral >= min) return;
  to.x += lx * side * (min - lateral);
  to.z += lz * side * (min - lateral);
}

/** step length grows with speed; the first steps from standing are short */
function limitReach(g: Gait, s: number, to: Vector3) {
  const other = g.feet[1 - s];
  const H = g.d.scale;
  const span = hypot(2 * g.stance.width, g.stance.stagger);
  const pace = Math.max(g.speed, g.targetSpeed * 0.5);
  const maxStep = Math.max(1.15 * span, Math.min(lerp(0.55, 1.05, g.run) * g.d.height, (0.32 + 0.55 * pace) * H));
  const at = other.footing;
  const dx = to.x - at.x;
  const dz = to.z - at.z;
  const dl = hypot(dx, dz);
  if (dl <= maxStep) return;
  to.x = at.x + (dx * maxStep) / dl;
  to.z = at.z + (dz * maxStep) / dl;
}
