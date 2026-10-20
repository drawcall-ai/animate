import { Vector3 } from 'three';
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
    yield* action<Frame>({ update: (f) => {
      const { go } = takeAsks(body.asks, asks), still = _still.set(0, 0, 0), g = body.locomotion;
      posture?.prepare(f, legs, attention, asks.look);
      const goal = go?.to ?? f.prev.position(0), velocity = go?.velocity ?? still, accel = go?.accel ?? 1;
      const gap = _gap.copy(goal).sub(f.prev.position(0)).setY(0).length();
      const pace = Math.max(kind.gait.slowest, velocity.length());
      legs.toward(f, { position: goal, velocity }, { speed: Math.min(go?.speed ?? 0, Math.sqrt(pace ** 2 + 2 * accel * gap)), accel });
      g.velocity.subVectors(f.current.position(0), f.prev.position(0)).divideScalar(f.dt).setY(0);
      [g.facing, g.moving, g.settled] = [body.yaw, g.velocity.length() > 0.05 || !legs.settled, legs.settled && g.velocity.length() < 0.05];
    } });
  };
}

const _gap = new Vector3(), _still = new Vector3();
