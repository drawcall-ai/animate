import { Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import type { Frame } from '../core/body';
import { live, type Behaviour, type Live } from '../core/goal';
import type { UntilCondition } from '@pmndrs/timeline';
import type { Go } from './asks';
import type { Humanoid } from './humanoid';
import { forwardOf, headingOf, wrapAngle } from './math';
import type { Stance } from './stance';

/** a walk unless asked otherwise: its top speed (m/s) and how quickly it speeds up (m/s²) */
const STROLL = { speed: 1.3, accel: 1.2 };
/** arrived: the body this close to its goal (m, default body) and turned this close to its facing (rad), at rest on both feet */
const ARRIVED = { distance: 0.15, yaw: 0.15 };

export interface WalkOptions<W> {
  /** where to go, on the floor (default: where it stands: a turn in place) */
  to?: Live<Vector3, W>;
  /** the facing to arrive with (rad; default the way it arrives, or toward `to` with `within`) */
  face?: Live<number, W>;
  /** stop with `to` this far ahead (m): in reach of it */
  within?: number;
  speed?: number;
  accel?: number;
  stance?: Partial<Stance>;
  /** arriving, square the feet into the stance (default true) */
  plant?: boolean;
  /** ends once met (the body comes to a stop where it can), and only then: until it, it follows `to` however it moves, standing at it while it is still */
  until?: UntilCondition<Frame<W>>;
}

/**
 * Walking to `to` (or turning in place to `face`): it asks `balance` to go there every sub-step
 * (`h.asks.go`, `h.asks.face`), and ends once the body has arrived, turned and settled on its
 * squared feet (`h.gait.settled`); given `until`, when that is met instead (a point that moves on is followed). It writes no
 * bones. With `within`, it stops short with the point that far ahead, facing `face` (default:
 * facing the point).
 */
export function walkTo<W>(h: Humanoid<W>, options: WalkOptions<W>): Behaviour<W> {
  const { within = 0, speed = STROLL.speed, accel = STROLL.accel, plant } = options;
  return function* () {
    const go: Go = { to: new Vector3(), speed, accel, plant };
    const face = { yaw: 0 };
    let at: Vector3 | null = null;
    const where = (f: Frame<W>) => {
      const body = f.prev.com(_com).setY(0);
      at ??= body.clone();
      const to = options.to === undefined ? at : live(options.to, f);
      const toward = headingOf(to.x - body.x, to.z - body.z);
      const yaw = options.face === undefined ? (within > 0 ? toward : null) : live(options.face, f);
      // (within: the point that far ahead, as the body will face it)
      go.to.copy(to).setY(0);
      if (within > 0) go.to.addScaledVector(forwardOf(yaw ?? toward, _v), -within);
      return yaw;
    };
    yield* action<Frame<W>>({
      update: (f) => {
        const yaw = where(f);
        h.asks.go = go;
        if (yaw === null) return;
        face.yaw = yaw;
        h.asks.face = face;
        if (options.stance) h.asks.stance = options.stance;
      },
      until: (f, clock, time) => {
        if (options.until) return options.until(f, clock, time);
        if (time === 0) return false;
        const yaw = where(f);
        const body = f.prev.com(_com);
        const there = Math.hypot(body.x - go.to.x, body.z - go.to.z) < ARRIVED.distance * h.proportions.scale;
        const turned = yaw === null || Math.abs(wrapAngle(yaw - h.gait.facing)) < ARRIVED.yaw;
        return there && turned && h.gait.settled;
      },
    });
  };
}

const _com = new Vector3();
const _v = new Vector3();
