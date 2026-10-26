import { Quaternion, Vector3 } from 'three';
import { forwardOf, leftOf, wrapAngle } from '../kernel/math';
import type { Frame } from '../kernel/frame';
import { Poise } from '../kernel/poise';
import { Pose } from '../kernel/pose';
import { carriage, type Striding } from '../species/carriage';
import { seedOf } from '../kernel/random';
import { ChainLeg, feetOf, steppingOf } from './feet';
import { Planner } from './planner';
import { Stepper } from './step/stepper';
import { type RootGoal } from './step/state';
import type { Legged } from './legged';
import { offTheWay, stanceYaw } from './walker';
import type { Step } from '../kernel/frame';
import { drivenRoot } from './driven';
import { strideAt } from '../species/gait';
import { Inertia } from '../kernel/inertia';

/**
 * A creature's balance, a sub-step at a time: its species' legs carry it where the request that has its legs asks (`going`) — the planner takes its root
 * there as a player's input would (turning on the spot to a goal off its way, walking on as far as the legs keep up) — or where its app
 * drives it; the stepper keeps its feet under it, its posture or carriage rides on the stride, and each leg is posed down to its foot.
 * Asked nothing, it stands. It keeps `locomotion` for walks and `arriving`.
 */
export function creature(body: Legged): Step {
  const kind = body.species.legs;
  if (!kind) throw new Error('creature: the species has no legs');
  const gait = kind.gait, attention = body.life, driven = body.drive && drivenRoot(body);
  const skeleton = body.pose.skeleton, rest = new Pose(skeleton), posers = kind.chains.map((chain) => new ChainLeg(chain, rest));
  const feet = feetOf(kind.chains, rest, posers.map((poser) => poser.depth));
  const turn = Math.min(...posers.map((poser) => poser.turn));
  const ball = Math.max(...posers.map((poser) => poser.ball));
  const record = steppingOf(gait, feet, turn, ball);
  const standing = kind.chains.map((chain) => ({ position: body.pose.position(chain.joints[chain.joints.length - 1].bone).clone().setY(feet.ankleHeight), yaw: body.yaw }));
  const stepper = (body.stepper = new Stepper(record, feet, standing, body.yaw));
  const radius = Math.max(...feet.legs.map((leg) => Math.hypot(leg.hip ?? feet.hip, leg.ahead ?? 0)));
  const planner = new Planner(body.pose.position(0).clone().setY(0), body.yaw, gait, radius, false);
  // (on the spot it turns half round in `HALF_TURN` strides at its slowest walk's rhythm, its feet stepping as quickly as the turn needs)
  const turning = Math.PI * strideAt(gait, gait.slowest, 0).frequency / HALF_TURN;
  const start = body.pose.position(0), seed = body.life.seed ?? seedOf(start.x, start.z);
  const posture = kind.posture?.(body.pose, gait, seed), poise = new Poise();
  const carried = !posture && kind.carriage ? carriage(body.pose, kind.chains, kind.carriage, gait, seed) : null;
  const phases = kind.chains.map(() => ({ phase: 0 })), pitches: number[] = kind.chains.map(() => 0);
  let going = false, followed: Vector3 | null = null;
  let lowering: Eased = [0, 0], bowing: Eased = [0, 0];
  // (development check: the legs across a girdle never pass through each other — their bones kept `CLEARANCE` of a leg apart)
  const across = feet.legs.flatMap((leg, i) => leg.partner !== undefined && leg.partner > i ? [[i, leg.partner]] : []);
  const bones = kind.chains.map((chain) => chain.joints.map(({ bone }) => bone));
  const clear = (f: Frame) => {
    if (!f.dev) return;
    for (const [a, b] of across) {
      const gap = Math.min(...bones[a].slice(1).flatMap((bone, k) => bones[b].slice(1).map((other, m) =>
        segmentGap(f.prev.position(bones[a][k]), f.prev.position(bone), f.prev.position(bones[b][m]), f.prev.position(other)))));
      const limit = CLEARANCE * feet.length;
      if (gap < limit) f.dev.append(f.time - f.dt, { check: 'leg clearance (m)', value: gap, limit, where: f.prev.skeleton.bones[bones[a][bones[a].length - 1]].name });
    }
  };
  const inertia = body.species.inertia && new Inertia(body.species.inertia);
  const legs = {
    legs: phases,
    height: start.y,
    held: start.y,
    stride: { cycle: 1, stance: 0.5 },
    turn: { rate: 0, ahead: 0 },
    lean: inertia,
    rest: (p: readonly number[]) => p.forEach((pitch, i) => { pitches[i] = pitch; }),
  } satisfies Striding;
  let facing = body.yaw;
  return (f) => {
    body.poise.pass(poise);
    const g = body.locomotion, asked0 = body.going, face = asked0?.face;
    // (a goal nowhere — not a finite point — it does not go for: it stands)
    const finite = !asked0 || [asked0.to.x, asked0.to.z, ...(asked0.velocity?.toArray() ?? [])].every(Number.isFinite);
    const go = finite ? asked0 : null;
    if (f.time > f.dt) { posers.forEach((poser) => poser.check(f)); clear(f); stepper.check(f); }
    const stance = stanceYaw(stepper.legs, planner.root.yaw);
    // (a goal off its way it turns to first, as a person does: facing it till it is on its way; nearer than its feet stand, it is there)
    // (it sets off for a goal further than `STOP.start`, or one on the move, and stops within `STOP.distance` of a still one, slow:
    // there it stands, not edging about)
    const root = planner.root.position, speed0 = planner.root.velocity.length();
    // (a goal on the move followed as it goes, carried on at its speed and drawn to where it is `FOLLOWING` /s: not its every sway)
    if (go?.velocity && followed) followed.addScaledVector(go.velocity, f.dt).lerp(go.to, Math.min(1, FOLLOWING * f.dt)).setY(0);
    else followed = go?.velocity ? go.to.clone().setY(0) : null;
    const asked = followed?.clone() ?? go?.to.clone().setY(0) ?? root.clone();
    if (!going && (asked.distanceTo(root) > STOP.start || (go?.velocity?.lengthSq() ?? 0) > 0)) going = true;
    if (going && asked.distanceTo(root) < STOP.distance && speed0 < STOP.speed && !go?.velocity) going = false;
    // (a still goal behind it, nearer than its feet stand, it does not turn round for: come past it, it is there; asked a facing, it
    // steps back to it)
    const behind = _gap.copy(asked).sub(root).dot(forwardOf(planner.root.yaw, _to)) < 0;
    if (going && !go?.velocity?.lengthSq() && behind && asked.distanceTo(root) < radius && !face) going = false;
    const to = going ? asked : root.clone(), heading = Math.atan2(to.x - root.x, to.z - root.z);
    const faced = face?.yaw ?? (to.distanceTo(root) > radius && offTheWay(heading, planner.root.yaw) ? heading : undefined);
    // (or where the scene drives it)
    const r: RootGoal = driven ? driven(f) : planner.step(f, { position: to, velocity: go?.velocity, yaw: faced },
      { accel: go?.accel ?? 1, speed: going ? go?.speed ?? 0 : 0, turnSpeed: Math.min(face?.rate ?? Infinity, turning) }, stance, (forecast) => stepper.reachable(forecast));
    stepper.move(f, r);
    f.current.setLocal(0, _yaw.setFromAxisAngle(UP, stepper.yaw));
    // (the root's turn, and how much further round it will face `LOOKING` s on: what its head leads into; its lean into its acceleration)
    legs.turn.rate = wrapAngle(stepper.yaw - facing) / f.dt;
    legs.turn.ahead = r.forecast ? wrapAngle(r.forecast(LOOKING).yaw - stepper.yaw) : legs.turn.rate * LOOKING;
    facing = stepper.yaw;
    inertia?.step(r.velocity, stepper.yaw, f.dt);
    // (each leg's phase through its stride, 0 as it lands: its stance, then its swing — run on at the cadence and drawn toward where the
    // foot is, `LOCKING` /s, so a change of cadence does not jolt what rides on it)
    stepper.legs.forEach((leg, i) => {
      const at = leg.swing ? (stepper.Ts + leg.swing.u * (stepper.cycle - stepper.Ts)) / stepper.cycle : (leg.planted / stepper.cycle) % 1;
      const p = phases[i], ahead = p.phase + f.dt / stepper.cycle, off = at - ahead - Math.round(at - ahead);
      p.phase = f.time <= f.dt ? at : (((ahead + off * Math.min(1, LOCKING * f.dt)) % 1) + 1) % 1;
    });
    legs.height = f.current.position(0).y;
    [legs.stride.cycle, legs.stride.stance, legs.held] = [stepper.cycle, stepper.Ts, stepper.held];
    posture?.prepare(f, legs, attention, body.look);
    if (carried) { carried.step(f, legs); carried.write(f); }
    // (let down and bowed as a task asks: the body lower on its legs, its front tipped down about its hind girdle — eased there and back)
    lowering = ease(lowering, Math.max(0, Math.min(poise.lower, LOWEST * feet.length)), f.dt);
    bowing = ease(bowing, Math.max(0, Math.min(poise.bow, poise.bowLimit, MOST_BOW)), f.dt);
    if (lowering[0] > 1e-6 || bowing[0] > 1e-6) {
      const behind = Math.min(...feet.legs.map((leg) => leg.ahead ?? 0)), pivot = _p.set(0, 0, 0);
      const hinds = feet.legs.filter((leg) => (leg.ahead ?? 0) <= behind + 1e-6);
      for (const leg of hinds) pivot.add(f.current.position(leg.top));
      pivot.divideScalar(hinds.length);
      const turn = _bow.setFromAxisAngle(leftOf(stepper.yaw, _left), bowing[0]);
      const at = _at.copy(f.current.position(0)).sub(pivot).applyQuaternion(turn).add(pivot);
      f.current.setRoot(at.setY(at.y - lowering[0]));
      f.current.setLocal(0, _q.copy(turn).multiply(f.current.local(0)));
    }
    const speed = Math.hypot(r.velocity.x, r.velocity.z), walking = Math.min(1, speed / (gait.referenceSpeed ?? gait.slowest));
    stepper.legs.forEach((leg, i) => {
      // (each leg through its own stride by the cycle, as the gait's cycles are read: a stance cut short swings on from where it is)
      const top = f.current.position(feet.legs[i].top), foot = stepper.pose(i, top), duty = strideAt(gait, speed, i).duty;
      // (a foot the posture rests, standing, tips onto its toe (° toes down), its toe kept where it stands)
      if (!leg.swing && pitches[i] !== 0) {
        const pitch = pitches[i] * Math.PI / 180;
        feet.ankle(i, leg.anchor, leg.yaw, pitch, foot.ankle);
        feet.rotation(leg.yaw, pitch, foot.foot);
      }
      const u = leg.swing ? duty + leg.swing.u * (1 - duty) : Math.min(duty, leg.planted / stepper.cycle);
      posers[i].pose(f, foot, u, leg.swing ? leg.swing.u : null, gait, speed, walking, stepper.yaw, i);
    });
    g.velocity.copy(r.velocity).setY(0);
    [g.facing, g.moving, g.settled] = [stepper.yaw, speed > 0.05 || stepper.legs.some((leg) => leg.swing), stepper.settled];
    g.there = !!go && !go.velocity?.lengthSq() && !going;
  };
}

/**
 * How far ahead (s) the head leads into the turn the root makes: a person's eyes set off ~0.4 s before the step that turns, the head
 * 50–130 ms after them, the trunk and pelvis later (read: Lamontagne et al. 2020, Front Neurol, PMC7739666, 90° walking turns); the head
 * leads the body's yaw by ~0.2 s (snippet: a review of walking-turn prediction); with the neck's ~0.25 s follow (`carriage`), its aim this
 * far ahead leaves it ~0.2 s before the body
 */
const LOOKING = 0.45;
/** Tuned: a walk sets off for a goal further than `start` (m) and stops within `distance` (m) of it, slower than `speed` (m/s) */
const STOP = { start: 0.05, distance: 0.03, speed: 0.1 };
/** [D from read] strides of its slowest walk a body takes to turn half round on the spot: a horse's turn on the forehand is 4–5 hind
 * steps (equisearch.com, "Learn the Turn on the Forehand": "Four or five steps later, you will be facing in the opposite direction") */
const HALF_TURN = 2.25;
/** Tuned: the least gap between the bones of legs across a girdle, as a share of a leg's length (≈ two legs' thickness) */
const CLEARANCE = 0.06;
/** Tuned (1/s): how fast a followed goal on the move is drawn to where it is */
const FOLLOWING = 3;
/** Tuned (1/s): how fast the phase the carriage rides on is drawn to the feet's */
const LOCKING = 6;
const UP = new Vector3(0, 1, 0);
/** Tuned: the most a creature lets its body down (× its legs' length) and bows its front (rad), as a task asks */
export const STOOPING = { lowest: 0.3, bow: 0.5 };
const LOWEST = STOOPING.lowest, MOST_BOW = STOOPING.bow;
/** Tuned (1/s): how quickly it lets itself down or bows and comes back up: critically damped */
const EASING = 6;
type Eased = [value: number, rate: number];
/** `[value, rate]` a step on toward `goal`, critically damped */
function ease([x, v]: Eased, goal: number, dt: number): Eased {
  v += (EASING ** 2 * (goal - x) - 2 * EASING * v) * dt;
  return [x + v * dt, v];
}
const _p = new Vector3(), _at = new Vector3(), _left = new Vector3(), _bow = new Quaternion(), _q = new Quaternion();
const _gap = new Vector3(), _to = new Vector3(), _yaw = new Quaternion();

/** the least distance between segments `a0`–`a1` and `b0`–`b1` (m) */
function segmentGap(a0: Vector3, a1: Vector3, b0: Vector3, b1: Vector3): number {
  const d1 = _d1.subVectors(a1, a0), d2 = _d2.subVectors(b1, b0), r = _r.subVectors(a0, b0);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r), c = d1.dot(r), b = d1.dot(d2), den = a * e - b * b;
  let s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
  let t = e > 1e-12 ? (b * s + f) / e : 0;
  if (t < 0) { t = 0; s = a > 1e-12 ? Math.min(1, Math.max(0, -c / a)) : 0; } else if (t > 1) { t = 1; s = a > 1e-12 ? Math.min(1, Math.max(0, (b - c) / a)) : 0; }
  return _p1.copy(a0).addScaledVector(d1, s).distanceTo(_p2.copy(b0).addScaledVector(d2, t));
}
const _d1 = new Vector3(), _d2 = new Vector3(), _r = new Vector3(), _p1 = new Vector3(), _p2 = new Vector3();
