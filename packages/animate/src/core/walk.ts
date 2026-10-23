import { Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import type { Frame } from './body';
import { live, type Behaviour, type Live } from './goal';
import type { UntilCondition } from '@pmndrs/timeline';
import type { Go } from './asks';
import { heldMass } from './worn';
import { loadFactor } from './load';
import { when } from './when';
import type { Body } from './body';
import { forwardOf, headingOf, wrapAngle } from './math';
import type { Stance } from './asks';

/** a walk unless asked otherwise: its top speed (m/s) and how quickly it speeds up (m/s²) */
const STROLL = { speed: 1.3, accel: 1.2 };
/** arrived: the body this close to its goal (m, default body) and turned this close to its facing (rad), at rest on both feet */
const ARRIVED = { distance: 0.15, yaw: 0.15 };
/** within reach of a point, the way to it is fixed this much further off than the reach (m, default body) */
const CLOSE = 1;
/** stalled: a walk that is to end on arriving, no nearer its goal by this much (m, default body; a radian of facing left
 * counting as `turn` m) for this long (s) — longer than a creature takes to come round on an arc to a goal behind it */
const STALL = { nearer: 0.02, turn: 0.3, seconds: 6 };

/** A walk arrives within `seconds`, or no walk runs and the body is settled.
 * Observe an idle body on two sub-steps so a parallel walk can publish its goal first.
 */
export function arriving(h: Body, seconds: number) {
  let idleAt = NaN;
  return (f: Frame): boolean => {
    if (h.locomotion.eta !== Infinity) {
      idleAt = NaN;
      return h.locomotion.eta <= seconds;
    }
    if (Number.isNaN(idleAt)) idleAt = f.time;
    return f.time > idleAt && h.locomotion.settled;
  };
}

/** Wait until a sibling walk has relinquished the feet and its arrival estimate. */
export function* waitForWalk(h: Body) {
  if (h.asks.go) yield* when(() => h.locomotion.eta === Infinity);
}

/** about how fast the body turns (rad/s), and its minimum estimated starting pace (m/s) */
const TURNING = 2;
const SETTING_OFF = 0.5;

export interface WalkOptions {
  /** where to go, on the floor (default: where it stands: a turn in place) */
  to?: Live<Vector3>;
  /** the facing to arrive with (rad; default the way it arrives, or toward `to` with `within`) */
  face?: Live<number>;
  /** stop with `to` this far ahead (m): in reach of it */
  within?: number;
  /** the goal's own velocity (m/s), when it moves: followed rather than read off its motion */
  velocity?: Live<Vector3>;
  /** Explicit pace; otherwise the default walk slows with the weight held. */
  speed?: number;
  accel?: number;
  stance?: Partial<Stance>;
  /** arriving, square the feet into the stance (default true) */
  plant?: boolean;
  /** ends once met (the body comes to a stop where it can), and only then: until it, it follows `to` however it moves, standing at it while it is still */
  until?: UntilCondition<Frame>;
}

/**
 * Walking to `to` (or turning in place to `face`): it asks the base to go there (and face so) every
 * sub-step, and ends once the body has arrived, turned and settled on its
 * squared feet (`h.locomotion.settled`); given `until`, when that is met instead (a point that moves on is followed). It writes no
 * bones. With `within`, it stops short with the point that far ahead, facing `face` (default:
 * facing the point). Following a body, give its `velocity` too. Within 0.6 m, at a travel speed below 0.6 m/s, short side steps to a
 * still goal and back steps toward a goal behind retain the requested facing. A creature goes round on an arc to a still goal behind
 * it, steps back to one just behind it when asked a facing, and waits for one behind it that moves.
 */
export function walkTo(h: Body, options: WalkOptions): Behaviour {
  checkWalk(options);
  return route(h, options);
}

/** a walk asked for what can be no walk is a misuse, said at once: a goal or a facing that is no number, a pace that is none (a live
 * goal that turns out no point is the dev log's, as live input) */
function checkWalk({ to, face, speed, accel, within }: WalkOptions): void {
  const finite = (x: number) => Number.isFinite(x);
  if (to !== undefined && typeof to !== 'function' && !(finite(to.x) && finite(to.z))) throw new Error('walkTo: the goal is no point on the floor');
  if (typeof face === 'number' && !finite(face)) throw new Error('walkTo: the facing is no angle');
  for (const [name, value] of [['speed', speed], ['accel', accel]] as const) if (value !== undefined && !(finite(value) && value > 0)) throw new Error(`walkTo: ${name} ${value} is no pace`);
  if (within !== undefined && !(finite(within) && within >= 0)) throw new Error(`walkTo: within ${within} is no distance`);
}

/** Internal approach route: ETA includes every intermediate point. One that is to end on arriving (no `until`, or
 * `arrives`: its `until` is an arrival) logs once if it stalls (STALL), and goes on. */
export function route(h: Body, options: WalkOptions, via: readonly Live<Vector3>[] = [], arrives = !options.until): Behaviour {
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
    const where = (f: Frame) => {
      const mass = heldMass(h);
      const effort = loadFactor(mass);
      go.speed = options.speed ?? speed / effort;
      go.accel = options.accel ?? accel / effort;
      const body = placeOf(h, f).setY(0);
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
    let best = Infinity, since = 0, stalled = false, nowhere = false;
    yield* action<Frame>({
      init: () => () => { h.locomotion.eta = Infinity; },
      update: (f) => {
        const yaw = where(f);
        if (arrives && !stalled && f.dev) {
          const body = placeOf(h, f);
          const left = Math.hypot(body.x - go.to.x, body.z - go.to.z) + (yaw === null ? 0 : Math.abs(wrapAngle(yaw - h.locomotion.facing)) * STALL.turn * h.scale);
          if (!Number.isFinite(left)) since = f.time;
          else if (left < best - STALL.nearer * h.scale) { best = left; since = f.time; }
          else if (f.time - since > STALL.seconds) {
            stalled = true;
            f.dev.append(f.time, {
              check: `stalled walk: no nearer its goal for ${STALL.seconds} s (m left)`,
              value: Math.hypot(body.x - go.to.x, body.z - go.to.z),
              limit: ARRIVED.distance * h.scale,
              where: 'walk',
            });
          }
        }
        go.velocity = options.velocity === undefined ? undefined : live(options.velocity, f);
        // (a live goal that turns out no point — live input — is a problem in the dev log, once: the body stands)
        if (![go.to.x, go.to.z, ...(go.velocity?.toArray() ?? [])].every(Number.isFinite)) {
          if (!nowhere) f.dev?.append(f.time, { check: 'walk goal not finite', value: 1, limit: 0, where: 'goal' });
          nowhere = true;
          return;
        }
        h.asks.go = go;
        if (options.stance) h.asks.stance = options.stance;
        h.locomotion.eta = etaOf(h, placeOf(h, f), go, yaw);
        if (leg < via.length) {
          let previous = go.to;
          for (let i = leg + 1; i <= via.length; i++) {
            const next = i < via.length ? live(via[i], f) : end;
            h.locomotion.eta += Math.hypot(next.x - previous.x, next.z - previous.z) / go.speed;
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
        const body = placeOf(h, f);
        const there = Math.hypot(body.x - go.to.x, body.z - go.to.z) < ARRIVED.distance * h.scale || h.locomotion.there;
        const turned = yaw === null || Math.abs(wrapAngle(yaw - h.locomotion.facing)) < ARRIVED.yaw;
        return there && turned && h.locomotion.settled;
      },
    });
  };
}

/**
 * about how long (s) the body at `body` takes to stand at `go`'s point facing `yaw`: the way left at
 * the pace it walks (at least as if setting off), plus slowing to a stop, or the turn left, whichever
 * is longer (the trajectory a motion-matching query predicts, here from the walk's own goal)
 */
function etaOf(h: Body, body: Readonly<Vector3>, go: Go, yaw: number | null): number {
  const left = Math.hypot(go.to.x - body.x, go.to.z - body.z) - ARRIVED.distance * h.scale;
  const v = Math.min(go.speed, Math.max(h.locomotion.velocity.length(), SETTING_OFF));
  const walk = left > 0 ? left / v + v / (2 * go.accel) : 0;
  const turn = yaw === null ? 0 : Math.max(0, Math.abs(wrapAngle(yaw - h.locomotion.facing)) - ARRIVED.yaw) / TURNING;
  return Math.max(walk, turn);
}

/** where a walk takes the body: a species' legs carry its root there (`Species.legs`), a person's balance its centre of mass */
const placeOf = (h: Body, f: Frame) => (h.species.legs ? _com.copy(f.prev.position(0)) : f.prev.com(_com)).setY(0);
const _com = new Vector3();
const _v = new Vector3();
