import { Quaternion, Vector3 } from 'three';
import { forwardOf, wrapAngle } from '../math';
import { action } from '@pmndrs/timeline';
import type { Body, Frame } from '../body';
import { createAsks, takeAsks } from '../asks';
import type { Behaviour } from '../goal';
import { Pose } from '../pose';
import type { Attention } from '../species';
import { Legs } from './legs';
import { carriage, type Striding } from './carriage';
import { seedOf } from '../random';
import { ChainLeg, feetOf, steppingOf } from './feet';
import { Planner } from './planner';
import { Stepper } from './stepper';
import { strideAt } from './gait';

/** Not public: the legs a creature stands and walks on until the stepper replaces `Legs` (the tests compare the two). */
export const creatureLegs: { path: 'legs' | 'stepper' } = { path: 'stepper' };

/**
 * A creature's base, endless: its species' legs carry it where a walk asks (`asks.go`), no faster than it
 * closes the gap at the walk's acceleration, its posture on top; asked nothing, it stands. It keeps
 * `locomotion` for `walkTo` and `arriving`.
 */
export function creature(body: Body, attention: Attention = {}): Behaviour {
  const kind = body.species.legs;
  if (!kind) throw new Error('idle: the species has no legs');
  if (creatureLegs.path === 'stepper') return stepping(body, attention);
  return function* () {
    const legs = new Legs(body.pose, kind.chains, kind.gait), posture = kind.posture?.(body.pose), asks = createAsks();
    const start = body.pose.position(0), carried = !posture && kind.carriage ? carriage(body.pose, kind.chains, kind.carriage, kind.gait, seedOf(start.x, start.z)) : null;
    let round = false;
    yield* action<Frame>({ update: (f) => {
      const { go } = takeAsks(body.asks, asks), still = _still.set(0, 0, 0), g = body.locomotion;
      posture?.prepare(f, legs, attention, asks.look);
      if (carried) { carried.step(f, legs); carried.write(f); }
      const goal = go?.to ?? f.prev.position(0), velocity = go?.velocity ?? still, accel = go?.accel ?? 1;
      const gap = _gap.copy(goal).sub(f.prev.position(0)).setY(0).length();
      const pace = Math.max(kind.gait.slowest, velocity.length());
      // (the legs travel only toward goals within π/4 of the facing: a still one further round it steers to on an arc, toward a
      // point at the edge of a narrower cone ahead, till the goal is within that cone; a moving one it waits for)
      const from = f.prev.position(0), off = wrapAngle(Math.atan2(goal.x - from.x, goal.z - from.z) - body.yaw);
      round = !go?.velocity && gap > TURN.gap && Math.abs(off) > (round ? TURN.cone : Math.PI / 4);
      const to = round ? forwardOf(body.yaw + Math.sign(off) * TURN.cone, _to).multiplyScalar(TURN.ahead).add(from) : goal;
      legs.toward(f, { position: to, velocity: round ? still : velocity }, { speed: Math.min(go?.speed ?? 0, Math.sqrt(pace ** 2 + 2 * accel * gap)), accel, ...(round ? TURN.motion : {}) });
      g.velocity.subVectors(f.current.position(0), f.prev.position(0)).divideScalar(f.dt).setY(0);
      [g.facing, g.moving, g.settled] = [body.yaw, g.velocity.length() > 0.05 || !legs.settled, legs.settled && g.velocity.length() < 0.05];
    } });
  };
}

/**
 * The creature on the stepper: the planner takes its root toward `asks.go` as a player's input would (turning on the spot to a goal
 * off its way, walking on as far as the legs keep up), the stepper keeps its feet under it, its posture or carriage rides on the
 * stride, and each leg is posed down to its foot.
 */
function stepping(body: Body, attention: Attention): Behaviour {
  const kind = body.species.legs!, gait = kind.gait;
  return function* () {
    const skeleton = body.pose.skeleton, rest = new Pose(skeleton), posers = kind.chains.map((chain) => new ChainLeg(chain, rest));
    const feet = feetOf(kind.chains, rest, posers.map((poser) => poser.depth)), record = steppingOf(gait, feet, Math.min(...posers.map((poser) => poser.turn)), Math.max(...posers.map((poser) => poser.ball)));
    const standing = kind.chains.map((chain) => ({ position: body.pose.position(chain.joints[chain.joints.length - 1].bone).clone().setY(feet.ankleHeight), yaw: body.yaw }));
    const stepper = (body.stepper = new Stepper(record, feet, standing, body.yaw));
    const radius = Math.max(...feet.legs.map((leg) => Math.hypot(leg.hip ?? feet.hip, leg.ahead ?? 0)));
    const planner = new Planner(body.pose.position(0).clone().setY(0), body.yaw, gait, radius, false);
    // (it turns no faster than a planted foot, stepping in its turn, swings from one side of where its leg reaches to the other)
    const slowest = strideAt(gait, gait.slowest, 0), turning = TURNING * 2 * Math.min(...feet.legs.map((leg) => leg.stray ?? 0)) / (radius * slowest.duty / slowest.frequency);
    const posture = kind.posture?.(body.pose), asks = createAsks();
    const start = body.pose.position(0), carried = !posture && kind.carriage ? carriage(body.pose, kind.chains, kind.carriage, gait, seedOf(start.x, start.z)) : null;
    const phases = kind.chains.map(() => ({ phase: 0 })), pitches: number[] = kind.chains.map(() => 0);
    let going = false, followed: Vector3 | null = null;
    const legs: Striding & { height: number } = { legs: phases, height: start.y, rest: (p) => p.forEach((pitch, i) => { pitches[i] = pitch; }) };
    yield* action<Frame>({ update: (f) => {
      const { go } = takeAsks(body.asks, asks), g = body.locomotion;
      if (f.time > f.dt) posers.forEach((poser) => poser.check(f));
      const stance = stepper.legs.reduce((sum, leg) => sum + wrapAngle(leg.yaw - planner.root.yaw), 0) / stepper.legs.length + planner.root.yaw;
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
      const to = going ? asked : root.clone(), heading = Math.atan2(to.x - root.x, to.z - root.z);
      const faced = asks.face?.yaw ?? (to.distanceTo(root) > radius && Math.abs(wrapAngle(heading - planner.root.yaw)) >= Math.PI / 4 ? heading : undefined);
      const r = planner.step(f, { position: to, velocity: go?.velocity, yaw: faced },
        { accel: go?.accel ?? 1, speed: going ? go?.speed ?? 0 : 0, turnSpeed: Math.min(asks.face?.rate ?? Infinity, turning) }, stance, (forecast) => stepper.reachable(forecast));
      stepper.move(f, r);
      f.current.setLocal(0, _yaw.setFromAxisAngle(UP, stepper.yaw));
      // (each leg's phase through its stride, 0 as it lands: its stance, then its swing — run on at the cadence and drawn toward where the
      // foot is, `LOCKING` /s, so a change of cadence does not jolt what rides on it)
      stepper.legs.forEach((leg, i) => {
        const at = leg.swing ? (stepper.Ts + leg.swing.u * (stepper.cycle - stepper.Ts)) / stepper.cycle : (leg.planted / stepper.cycle) % 1;
        const p = phases[i], ahead = p.phase + f.dt / stepper.cycle, off = at - ahead - Math.round(at - ahead);
        p.phase = f.time <= f.dt ? at : (((ahead + off * Math.min(1, LOCKING * f.dt)) % 1) + 1) % 1;
      });
      legs.height = f.current.position(0).y;
      posture?.prepare(f, legs, attention, asks.look);
      if (carried) { carried.step(f, legs); carried.write(f); }
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
    } });
  };
}

/** Tuned: a still goal further off than `gap` (m) and round is steered to by a point `ahead` (m) at `cone` (rad) off the facing, turning at `motion`'s pace (rad/s², rad/s): on an arc */
const TURN = { gap: 0.3, cone: 0.35, ahead: 1, motion: { turnAccel: 2, turnSpeed: 1 } };
/** Tuned: a walk sets off for a goal further than `start` (m) and stops within `distance` (m) of it, slower than `speed` (m/s) */
const STOP = { start: 0.05, distance: 0.03, speed: 0.1 };
/** the share of the turn its feet's stray lets it make */
const TURNING = 2;
/** Tuned (1/s): how fast a followed goal on the move is drawn to where it is */
const FOLLOWING = 3;
/** Tuned (1/s): how fast the phase the carriage rides on is drawn to the feet's */
const LOCKING = 6;
const UP = new Vector3(0, 1, 0);
const _gap = new Vector3(), _still = new Vector3(), _to = new Vector3(), _yaw = new Quaternion();
