import { Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import type { Frame } from '../core/body';
import { live, type Behaviour, type Live } from '../core/goal';
import type { UntilCondition } from '@pmndrs/timeline';
import { loadFactor } from '../core/carrier';
import type { Go } from './asks';
import { SIDES } from './bones';
import type { Humanoid } from './humanoid';
import { forwardOf, headingOf, wrapAngle } from '../core/math';
import type { Stance } from './stance';

/** a walk unless asked otherwise: its top speed (m/s) and how quickly it speeds up (m/s²) */
const STROLL = { speed: 1.3, accel: 1.2 };
/** arrived: the body this close to its goal (m, default body) and turned this close to its facing (rad), at rest on both feet */
const ARRIVED = { distance: 0.15, yaw: 0.15 };
/** within reach of a point, the way to it is fixed this much further off than the reach (m, default body) */
const CLOSE = 1;

/** a condition: the walk now running arrives within `seconds`; false when no walk is running */
export const arriving =
  <W>(h: Humanoid<W>, seconds: number) =>
  (): boolean =>
    h.gait.eta <= seconds;

/** about how fast the body turns (rad/s), and its minimum estimated starting pace (m/s) */
const TURNING = 2;
const SETTING_OFF = 0.5;

export interface WalkOptions<W> {
  /** where to go, on the floor (default: where it stands: a turn in place) */
  to?: Live<Vector3, W>;
  /** the facing to arrive with (rad; default the way it arrives, or toward `to` with `within`) */
  face?: Live<number, W>;
  /** stop with `to` this far ahead (m): in reach of it */
  within?: number;
  /** Explicit pace; otherwise the default walk slows with the weight held. */
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
 * facing the point). A goal moving slower than 0.08 m/s, less than 0.6 m behind, at an actual travel speed below
 * 0.6 m/s, permits stepping back while keeping the facing.
 */
export function walkTo<W>(h: Humanoid<W>, options: WalkOptions<W>): Behaviour<W> {
  const { within = 0, speed = STROLL.speed, accel = STROLL.accel, plant } = options;
  return function* () {
    const go: Go = { to: new Vector3(), speed, accel, plant };
    const face = { yaw: 0 };
    let at: Vector3 | null = null;
    // (within reach, the way to the point is fixed once close: from where the body then stands it
    // would drift as the body settles off the line to it)
    let fixed: number | null = null;
    const where = (f: Frame<W>) => {
      const items = new Set(SIDES.flatMap((side) => h.holding[side]?.item ?? []));
      const mass = [...items].reduce((sum, item) => sum + (item.supported ? 0 : item.mass), 0);
      // Recalled tuning: added weight lowers the default walk's pace; an explicit pace is kept.
      const effort = loadFactor(mass);
      go.speed = options.speed ?? speed / effort;
      go.accel = options.accel ?? accel / effort;
      const body = f.prev.com(_com).setY(0);
      at ??= body.clone();
      const to = options.to === undefined ? at : live(options.to, f);
      const close = Math.hypot(to.x - body.x, to.z - body.z) < within + CLOSE * h.proportions.scale;
      const toward = close && fixed !== null ? fixed : headingOf(to.x - body.x, to.z - body.z);
      fixed = close ? toward : null;
      const yaw = options.face === undefined ? (within > 0 ? toward : null) : live(options.face, f);
      // (within: the point that far ahead, as the body will face it)
      go.to.copy(to).setY(0);
      if (within > 0) go.to.addScaledVector(forwardOf(yaw ?? toward, _v), -within);
      return yaw;
    };
    yield* action<Frame<W>>({
      init: () => () => {
        h.gait.eta = Infinity;
      },
      update: (f) => {
        const yaw = where(f);
        h.asks.go = go;
        if (options.stance) h.asks.stance = options.stance;
        h.gait.eta = etaOf(h, f.prev.com(_com), go, yaw);
        if (yaw === null) return;
        face.yaw = yaw;
        h.asks.face = face;
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

/**
 * about how long (s) the body at `body` takes to stand at `go`'s point facing `yaw`: the way left at
 * the pace it walks (at least as if setting off), plus slowing to a stop, or the turn left, whichever
 * is longer (the trajectory a motion-matching query predicts, here from the walk's own goal)
 */
function etaOf<W>(h: Humanoid<W>, body: Readonly<Vector3>, go: Go, yaw: number | null): number {
  const left = Math.hypot(go.to.x - body.x, go.to.z - body.z) - ARRIVED.distance * h.proportions.scale;
  const v = Math.min(go.speed, Math.max(h.gait.velocity.length(), SETTING_OFF));
  const walk = left > 0 ? left / v + v / (2 * go.accel) : 0;
  const turn = yaw === null ? 0 : Math.max(0, Math.abs(wrapAngle(yaw - h.gait.facing)) - ARRIVED.yaw) / TURNING;
  return Math.max(walk, turn);
}

const _com = new Vector3();
const _v = new Vector3();
