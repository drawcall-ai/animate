import { Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import type { Frame } from '../core/body';
import { live, type Behaviour, type Live } from '../core/goal';
import type { UntilCondition } from '@pmndrs/timeline';
import type { Go } from './asks';
import { heldMass } from './hands/grips';
import { loadFactor } from '../core/load';
import { when } from '../core/when';
import type { Humanoid } from './humanoid';
import { forwardOf, headingOf, wrapAngle } from '../core/math';
import type { Stance } from './stance';

/** a walk unless asked otherwise: its top speed (m/s) and how quickly it speeds up (m/s²) */
const STROLL = { speed: 1.3, accel: 1.2 };
/** arrived: the body this close to its goal (m, default body) and turned this close to its facing (rad), at rest on both feet */
const ARRIVED = { distance: 0.15, yaw: 0.15 };
/** within reach of a point, the way to it is fixed this much further off than the reach (m, default body) */
const CLOSE = 1;

/** A walk arrives within `seconds`, or no walk runs and the body is settled.
 * Observe an idle body on two sub-steps so a parallel walk can publish its goal first.
 */
export function arriving<W>(h: Humanoid<W>, seconds: number) {
  let idleAt = NaN;
  return (f: Frame<W>): boolean => {
    if (h.gait.eta !== Infinity) {
      idleAt = NaN;
      return h.gait.eta <= seconds;
    }
    if (Number.isNaN(idleAt)) idleAt = f.time;
    return f.time > idleAt && h.gait.settled;
  };
}

/** Wait until a sibling walk has relinquished the feet and its arrival estimate. */
export function* waitForWalk<W>(h: Humanoid<W>) {
  if (h.asks.go) yield* when(() => h.gait.eta === Infinity);
}

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
 * facing the point). Within 0.6 m, at a travel speed below 0.6 m/s, short side steps to a
 * still goal and back steps toward a goal behind retain the requested facing.
 */
export function walkTo<W>(h: Humanoid<W>, options: WalkOptions<W>): Behaviour<W> {
  return route(h, options);
}

/** Internal approach route: ETA includes every intermediate point. */
export function route<W>(h: Humanoid<W>, options: WalkOptions<W>, via: readonly Live<Vector3, W>[] = []): Behaviour<W> {
  const { within = 0, speed = STROLL.speed, accel = STROLL.accel, plant } = options;
  return function* () {
    // A sibling walk owns the feet until its cleanup publishes an infinite ETA.
    yield* waitForWalk(h);
    const go: Go = { to: new Vector3(), speed, accel, plant };
    const face = { yaw: 0 };
    let at: Vector3 | null = null;
    const end = new Vector3();
    let leg = 0;
    // (within reach, the way to the point is fixed once close: from where the body then stands it
    // would drift as the body settles off the line to it)
    let fixed: number | null = null;
    const where = (f: Frame<W>) => {
      const mass = heldMass(h);
      const effort = loadFactor(mass);
      go.speed = options.speed ?? speed / effort;
      go.accel = options.accel ?? accel / effort;
      const body = f.prev.com(_com).setY(0);
      at ??= body.clone();
      if (leg < via.length && body.distanceTo(_v.copy(live(via[leg], f)).setY(0)) < ARRIVED.distance * h.scale) {
        leg++;
        fixed = null;
      }
      const to = options.to === undefined ? at : live(options.to, f);
      const close = Math.hypot(to.x - body.x, to.z - body.z) < within + CLOSE * h.scale;
      const toward = close && fixed !== null ? fixed : headingOf(to.x - body.x, to.z - body.z);
      fixed = close ? toward : null;
      const yaw = options.face === undefined ? (within > 0 ? toward : null) : live(options.face, f);
      end.copy(to).setY(0).addScaledVector(forwardOf(yaw ?? toward, _v), -within);
      go.to.copy(leg < via.length ? live(via[leg], f) : end).setY(0);
      return leg < via.length ? null : yaw;
    };
    yield* action<Frame<W>>({
      init: () => () => { h.gait.eta = Infinity; },
      update: (f) => {
        const yaw = where(f);
        h.asks.go = go;
        if (options.stance) h.asks.stance = options.stance;
        h.gait.eta = etaOf(h, f.prev.com(_com), go, yaw);
        if (leg < via.length) {
          let previous = go.to;
          for (let i = leg + 1; i <= via.length; i++) {
            const next = i < via.length ? live(via[i], f) : end;
            h.gait.eta += Math.hypot(next.x - previous.x, next.z - previous.z) / go.speed;
            previous = next;
          }
        }
        if (yaw === null) return;
        face.yaw = yaw;
        h.asks.face = face;
      },
      until: (f, clock, time) => {
        if (time === 0) return false;
        const yaw = where(f);
        if (leg < via.length) return false;
        if (options.until) return options.until(f, clock, time);
        const body = f.prev.com(_com);
        const there = Math.hypot(body.x - go.to.x, body.z - go.to.z) < ARRIVED.distance * h.scale;
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
  const left = Math.hypot(go.to.x - body.x, go.to.z - body.z) - ARRIVED.distance * h.scale;
  const v = Math.min(go.speed, Math.max(h.gait.velocity.length(), SETTING_OFF));
  const walk = left > 0 ? left / v + v / (2 * go.accel) : 0;
  const turn = yaw === null ? 0 : Math.max(0, Math.abs(wrapAngle(yaw - h.gait.facing)) - ARRIVED.yaw) / TURNING;
  return Math.max(walk, turn);
}

const _com = new Vector3();
const _v = new Vector3();
