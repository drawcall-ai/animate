import { Vector3 } from 'three';
import type { Frame } from '../kernel/frame';
import type { Go, Stance } from '../kernel/go';
import { loadFactor } from '../kernel/load';
import { forwardOf, headingOf, wrapAngle } from '../kernel/math';
import type { Legged } from './legged';
import { remaining, SETTLED_AFTER } from './step/state';

/** a walk unless asked otherwise: its top speed (m/s) and how quickly it speeds up (m/s²) */
const STROLL = { speed: 1.3, accel: 1.2 };
/** arrived: the body this close to its goal (m, default body) and turned this close to its facing (rad), at rest on both feet */
const ARRIVED = { distance: 0.15, yaw: 0.15 };
/** within reach of a point, the way to it is fixed this much further off than the reach (m, default body) */
const CLOSE = 1;
/** stalled: a walk that is to end on arriving, no nearer its goal by this much (m, default body; a radian of facing left
 * counting as `turn` m) for this long (s) — longer than a creature takes to come round on an arc to a goal behind it */
const STALL = { nearer: 0.02, turn: 0.3, seconds: 6 };
/** about how fast the body turns (rad/s; measured: a person turning in place, 1.2–1.4 rad/s), and its minimum estimated starting pace (m/s) */
const TURNING = 1.25, SETTING_OFF = 0.5;
/** the turn rate the hands time their reach to (rad/s; tuned: quicker than the body turns, so they set off as it comes round) */
const LEADING_TURN = 2;

/** Where a walk goes, a sub-step at a time. */
export interface Route {
  /** where to go, on the floor (default: where it stands when it sets off: a turn in place) */
  to?: (f: Frame) => Readonly<Vector3>;
  /** the facing to arrive with (rad; null: the way it arrives, or toward `to` with `within`) */
  face?: (f: Frame) => number | null;
  /** stop with `to` this far ahead (m): in reach of it */
  within?: number;
  /** the goal's own velocity (m/s), when it moves and is known: followed rather than read off its motion */
  velocity?: (f: Frame) => Vector3 | undefined;
  /** an explicit pace; otherwise a stroll, slowed by the weight held, quickened by the body's tempo */
  speed?: number;
  accel?: number;
  stance?: Partial<Stance>;
  /** arriving, square the feet into the stance (default true) */
  plant?: boolean;
  /** points to pass on the way first */
  via?: readonly ((f: Frame) => Readonly<Vector3>)[];
}

/**
 * A walk to `way`, a sub-step at a time (`step`): it asks balance to go there (and face so), and says when it will stand there facing so
 * (`there`, as the body turns; `eta`, a little sooner: what the hands time their reach to), when it will end (`ends`: its feet squared
 * and settled too) and whether it has (`arrived`: there, turned and settled on its squared feet). Within reach (`within`), it stops
 * short with the point that far ahead, facing it. One that should end on arriving says once in the dev log if it stalls (`stalled`), and
 * goes on.
 */
export class Walk {
  eta = Infinity;
  there = Infinity;
  ends = Infinity;
  /** how far (rad) the body is still to turn to the facing it arrives with */
  unturned = Infinity;
  stalled = false;
  private readonly go: Go = { to: new Vector3(), speed: STROLL.speed, accel: STROLL.accel };

  private readonly end = new Vector3();
  private start: Vector3 | null = null;
  private leg = 0;
  /** within reach, the way to the point is fixed once close: from where the body then stands it would drift as it settles off it */
  private fixed: number | null = null;
  /** the stall watch: the least left of the walk so far and since when; whether a goal that is no point was said */
  private best = Infinity; private since = 0; private nowhere = false;
  /** since when it has stood there facing as asked, its feet still to square and settle (null: not there) */
  private stood: number | null = null;

  constructor(private readonly self: Legged, private readonly way: Route, private readonly arrives = true) {
    this.go.plant = way.plant;
  }

  /** where it asks the legs to take the body this sub-step (none: a goal that is no point) */
  step(f: Frame): Go | undefined {
    const { self, way, go } = this, yaw = this.where(f);
    if (this.arrives && !this.stalled) this.watch(f, yaw);
    go.velocity = way.velocity?.(f);
    // (a live goal that turns out no point — live input — is a problem in the dev log, once: the body stands)
    if (![go.to.x, go.to.z, ...(go.velocity?.toArray() ?? [])].every(Number.isFinite)) {
      if (!this.nowhere) f.dev?.append(f.time, { check: 'walk goal not finite', value: 1, limit: 0, where: 'goal' });
      this.nowhere = true;
      return undefined;
    }
    go.stance = way.stance;
    const via = way.via ?? [];
    let previous: Readonly<Vector3> = go.to, onward = 0;
    for (let i = this.leg + 1; i <= via.length; i++) {
      const next = i < via.length ? via[i](f) : this.end;
      onward += Math.hypot(next.x - previous.x, next.z - previous.z) / go.speed;
      previous = next;
    }
    const body = placeOf(self, f);
    this.there = etaOf(self, body, go, yaw, TURNING) + onward;
    this.eta = etaOf(self, body, go, yaw, LEADING_TURN) + onward;
    this.stood = this.there > 0 ? null : this.stood ?? f.time;
    this.ends = this.there + closing(self, this.stood === null ? null : f.time - this.stood);
    go.face = yaw === null ? undefined : { yaw };
    // (to the facing it arrives with, whichever leg of its way it is on)
    const arriving = way.face?.(f) ?? null;
    this.unturned = arriving === null ? 0 : Math.abs(wrapAngle(arriving - self.locomotion.facing));
    return go;
  }

  /** whether it has arrived: at its goal (or as near as its legs take it), turned to its facing and settled */
  arrived(f: Frame): boolean {
    const yaw = this.where(f);
    if (this.leg < (this.way.via?.length ?? 0)) return false;
    const body = placeOf(this.self, f), locomotion = this.self.locomotion;
    const there = Math.hypot(body.x - this.go.to.x, body.z - this.go.to.z) < ARRIVED.distance * this.self.scale || locomotion.there;
    const turned = yaw === null || Math.abs(wrapAngle(yaw - locomotion.facing)) < ARRIVED.yaw;
    return there && turned && locomotion.settled;
  }

  /** where it goes this sub-step (`go.to`), and the facing it arrives with (null: none) */
  private where(f: Frame): number | null {
    const { self, way, go } = this, within = way.within ?? 0, via = way.via ?? [];
    const effort = loadFactor(self.load);
    go.speed = way.speed ?? STROLL.speed * self.tempo / effort;
    go.accel = way.accel ?? STROLL.accel * self.tempo / effort;
    const body = placeOf(self, f).setY(0);
    this.start ??= body.clone();
    if (this.leg < via.length && body.distanceTo(_v.copy(via[this.leg](f)).setY(0)) < ARRIVED.distance * self.scale) {
      this.leg++;
      this.fixed = null;
    }
    const to = way.to?.(f) ?? this.start;
    const close = Math.hypot(to.x - body.x, to.z - body.z) < within + CLOSE * self.scale;
    const toward = close && this.fixed !== null ? this.fixed : headingOf(to.x - body.x, to.z - body.z);
    this.fixed = close ? toward : null;
    const asked = way.face?.(f) ?? null;
    const yaw = asked ?? (within > 0 ? toward : null);
    this.end.copy(to).setY(0).addScaledVector(forwardOf(yaw ?? toward, _v), -within);
    go.to.copy(this.leg < via.length ? via[this.leg](f) : this.end).setY(0);
    return this.leg < via.length ? null : yaw;
  }

  /** a walk no nearer its goal for `STALL.seconds` — nor turned nearer its facing, or with none asked the way to its goal — has stalled: a problem in the dev log, once */
  private watch(f: Frame, yaw: number | null): void {
    const { self, go } = this, body = placeOf(self, f), facing = yaw ?? headingOf(go.to.x - body.x, go.to.z - body.z);
    const left = Math.hypot(body.x - go.to.x, body.z - go.to.z) + Math.abs(wrapAngle(facing - self.locomotion.facing)) * STALL.turn * self.scale;
    if (!Number.isFinite(left)) this.since = f.time;
    else if (left < this.best - STALL.nearer * self.scale) [this.best, this.since] = [left, f.time];
    else if (f.time - this.since > STALL.seconds) {
      this.stalled = true;
      f.dev?.append(f.time, {
        check: `stalled walk: no nearer its goal for ${STALL.seconds} s (m left)`,
        value: Math.hypot(body.x - go.to.x, body.z - go.to.z),
        limit: ARRIVED.distance * self.scale,
        where: 'walk',
      });
    }
  }
}

/**
 * about how long (s) a walk takes to end once the body stands where it goes facing as asked (`after` s ago; null: not yet): each foot
 * steps once more to square the stance (a stepping cycle steps every foot once; measured: a person's last closing step lands 0.75–1.35 s
 * after it is there, its cycle ~1 s), then all stand still till settled
 */
function closing(self: Legged, after: number | null): number {
  const stepper = self.stepper;
  if (!stepper) throw new Error('walk: the body has no stepping legs');
  if (after === null) return stepper.cycle + SETTLED_AFTER;
  if (self.locomotion.settled) return 0;
  const legs = stepper.legs, step = stepper.cycle / legs.length;
  const swinging = Math.max(0, ...legs.map((leg) => (leg.swing ? remaining(leg.swing) : 0)));
  // (the feet that have not stepped since it was there: each to square yet)
  const pending = legs.filter((leg) => !leg.swing && leg.planted >= after).length;
  const standing = Math.min(...legs.map((leg) => (leg.swing ? 0 : leg.planted)));
  return swinging + pending * step + Math.max(0, SETTLED_AFTER - (swinging > 0 || pending > 0 ? 0 : standing));
}

/**
 * about how long (s) the body at `body` takes to stand at `go`'s point facing `yaw`: the way left at the pace it walks (at least as if
 * setting off), plus slowing to a stop, or the turn left at `turning` rad/s, whichever is longer (the trajectory a motion-matching query
 * predicts, here from the walk's own goal)
 */
function etaOf(self: Legged, body: Readonly<Vector3>, go: Go, yaw: number | null, turning: number): number {
  const left = Math.hypot(go.to.x - body.x, go.to.z - body.z) - ARRIVED.distance * self.scale;
  const v = Math.min(go.speed, Math.max(self.locomotion.velocity.length(), SETTING_OFF));
  const walk = left > 0 ? left / v + v / (2 * go.accel) : 0;
  const turn = yaw === null ? 0 : Math.max(0, Math.abs(wrapAngle(yaw - self.locomotion.facing)) - ARRIVED.yaw) / turning;
  return Math.max(walk, turn);
}

/** where a walk takes the body: a species' legs carry its root there, a person's balance its centre of mass */
const placeOf = (self: Legged, f: Frame) => (self.species.legs ? _com.copy(f.prev.position(0)) : f.prev.com(_com)).setY(0);
const _com = new Vector3();
const _v = new Vector3();
