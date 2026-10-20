import { Vector3 } from 'three';
import { forwardOf, wrapAngle } from '../math';
import { action } from '@pmndrs/timeline';
import type { Body, Frame } from '../body';
import { createAsks, takeAsks } from '../asks';
import type { Behaviour } from '../goal';
import type { Attention } from '../species';
import { Legs } from './legs';

/**
 * A creature's base, endless: its species' legs carry it where a walk asks (`asks.go`), no faster than it
 * closes the gap at the walk's acceleration, its posture on top; asked nothing, it stands. It keeps
 * `locomotion` for `walkTo` and `arriving`.
 */
export function creature(body: Body, attention: Attention = {}): Behaviour {
  const kind = body.species.legs;
  if (!kind) throw new Error('idle: the species has no legs');
  return function* () {
    const legs = new Legs(body.pose, kind.chains, kind.gait), posture = kind.posture?.(body.pose), asks = createAsks();
    let round = false;
    yield* action<Frame>({ update: (f) => {
      const { go } = takeAsks(body.asks, asks), still = _still.set(0, 0, 0), g = body.locomotion;
      posture?.prepare(f, legs, attention, asks.look);
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

/** Tuned: a still goal further off than `gap` (m) and round is steered to by a point `ahead` (m) at `cone` (rad) off the facing, turning at `motion`'s pace (rad/s², rad/s): on an arc */
const TURN = { gap: 0.3, cone: 0.35, ahead: 1, motion: { turnAccel: 2, turnSpeed: 1 } };
const _gap = new Vector3(), _still = new Vector3(), _to = new Vector3();
