import { Vector3 } from 'three';
import type { Frame } from '../kernel/frame';
import { STROLL, type Go, type Stance } from './go';
import type { Miss, Request } from '../kernel/requests';
import { loadFactor } from '../kernel/load';
import { forwardOf, headingOf, wrapAngle } from '../kernel/math';
import { remaining, SETTLED_AFTER } from './steps';
import { FLAT } from './floor';
import type { Self } from '../body/self';

/** Tuned: this share of a speed asked counts as reaching it */
const NEAR = 0.9;
/** arrived: the body this close to its goal (m, default body) and turned this close to its facing (rad), at rest on both feet; a creature
 * whose legs have stopped short counts as there within `stopped` (measured over the examples: at most 0.39 of it) */
const ARRIVED = { distance: 0.15, yaw: 0.15, stopped: 0.5 };
/** within reach of a point, the way to it is fixed this much further off than the reach (m, default body) */
const CLOSE = 1;
/** stalled: a walk no nearer its goal by this much (m, default body; a radian of facing left counting as `turn` m) for this long (s) —
 * longer than a creature takes to come round on an arc to a goal behind it — one followed (ended on `until`) as long as it stands still */
const STALL = { nearer: 0.02, turn: 0.3, seconds: 6 };
/** how far behind a target (m, default body) a walk says it cannot keep up, its target's pace (over a second or so: a head bobs) past this share of its own */
const BEHIND = 1, KEEPING = 1.1;
/** about how fast the body turns (rad/s; measured: a person turning in place, 1.2–1.4 rad/s), and its minimum estimated starting pace (m/s) */
const TURNING = 1.25, SETTING_OFF = 0.5;
/** the turn rate the hands time their reach to (rad/s; tuned: quicker than the body turns, so they set off as it comes round) */
const LEADING_TURN = 2;
/**
 * Tuned: on a floor that rises or falls by `rise` (m, default body) within `ahead` (m) on its way or `behind` (m) — a stair's — a walk goes at most
 * at a stair's `pace` (m/s; recalled: people climb and descend stairs at ~0.5–0.7 m/s over the floor, slower than they walk), read at
 * `reads` points
 */
const STAIRS = { pace: 0.7, ahead: 1.5, behind: 1, rise: 0.05, reads: 20 };

/** Where a walk goes, a sub-step at a time. */
interface Route {
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
  stance?: Partial<Stance>;
  /** arriving, square the feet into the stance (default true) */
  plant?: boolean;
  /** points to pass on the way first */
  via?: readonly ((f: Frame) => Readonly<Vector3>)[];
  /** a few steps back or aside, asked to face as the body faces, it keeps its facing (`Go.backs`) */
  backs?: boolean;
}

/**
 * A walk to `way`, a sub-step at a time (`step`): it asks balance to go there (and face so), and says when it will stand there facing so
 * (`there`, as the body turns; `eta`, a little sooner: what the hands time their reach to), when it will end (`ends`: its feet squared
 * and settled too) and whether it has (`arrived`: there, turned and settled on its squared feet). Within reach (`within`), it stops
 * short with the point that far ahead, facing it. It says if it stalls (`stall`: no nearer its goal; one followed, no nearer it standing
 * still), and goes on.
 */
export class Walk {
  eta = Infinity;
  there = Infinity;
  ends = Infinity;
  /** how far (rad) the body is still to turn to the facing it arrives with */
  unturned = Infinity;
  /** what stopped it, once it has stalled */
  stall: Miss | null = null;
  private readonly go: Go = { to: new Vector3(), speed: STROLL.speed, accel: STROLL.accel };

  private readonly end = new Vector3();
  private start: Vector3 | null = null;
  private leg = 0;
  /** within reach, the way to the point is fixed once close: from where the body then stands it would drift as it settles off it */
  private fixed: number | null = null;
  /** the stall watch: the least left of the walk so far, since when, and where the goal stood then */
  private best = Infinity; private since = 0; private readonly watched = new Vector3();
  /** since when it has stood there facing as asked, its feet still to square and settle (null: not there) */
  private stood: number | null = null;
  /** the fastest it has gone (m/s), and the furthest it has had to go (m) */
  private peak = 0; private farthest = 0;
  /** how fast its goal goes (m/s) */
  private goalPace = 0;

  constructor(private readonly self: Self, private readonly way: Route, private readonly arrives = true) {
    this.go.plant = way.plant;
    this.go.settles = arrives;
  }

  /** where it asks the legs to take the body this sub-step (none: a goal that is no point) */
  step(f: Frame): Go | undefined {
    const { self, way, go } = this, yaw = this.where(f);
    this.peak = Math.max(this.peak, self.locomotion.velocity.length());
    if (!this.stall) this.watch(f, yaw);
    go.velocity = way.velocity?.(f);
    if (![go.to.x, go.to.z, ...(go.velocity?.toArray() ?? [])].every(Number.isFinite)) throw new Error(`walk: a goal that is no point: (${go.to.x}, ${go.to.z})`);
    go.stance = way.stance;
    const via = way.via ?? [];
    let previous: Readonly<Vector3> = go.to, onward = 0;
    for (let i = this.leg + 1; i <= via.length; i++) {
      const next = i < via.length ? via[i](f) : this.end;
      onward += Math.hypot(next.x - previous.x, next.z - previous.z) / go.speed;
      previous = next;
    }
    const body = placeOf(self, f);
    this.goalPace += ((go.velocity?.length() ?? 0) - this.goalPace) * f.dt;
    if (f.dev && this.goalPace > KEEPING * go.speed && Math.hypot(go.to.x - body.x, go.to.z - body.z) > BEHIND * self.scale) f.dev.append(f.time, { check: 'walk cannot keep up with its target (m/s)', value: this.goalPace, limit: go.speed, where: 'root' });
    this.farthest = Math.max(this.farthest, Math.hypot(go.to.x - body.x, go.to.z - body.z));
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

  /** Says in a dev log, as a walk to a place ends, a speed above a stroll it had the room to reach (speeding up as it brakes, v² = a·d) and came nowhere near. */
  report(f: Frame): void {
    const asked = this.way.speed, { go, peak } = this;
    if (!f.dev || asked === undefined || asked <= STROLL.speed || !this.arrives) return;
    const limit = Math.min(asked, Math.sqrt(go.accel * this.farthest));
    if (peak < NEAR * limit) f.dev.append(f.time, { check: 'walk speed not reached (m/s)', value: peak, limit, where: 'root' });
  }

  /** whether it stands at its goal (or as near as its legs take it), turned to its facing */
  stands(f: Frame): boolean {
    const yaw = this.where(f);
    if (this.leg < (this.way.via?.length ?? 0)) return false;
    const body = placeOf(this.self, f), locomotion = this.self.locomotion;
    const off = Math.hypot(body.x - this.go.to.x, body.z - this.go.to.z) / this.self.scale;
    const near = off < ARRIVED.distance || (locomotion.there && off < ARRIVED.stopped);
    return near && (yaw === null || Math.abs(wrapAngle(yaw - locomotion.facing)) < ARRIVED.yaw);
  }

  /** whether it has arrived: there, and come to rest (settled feet under a body still edging onto its goal would have it shift its weight,
   * and step, as the walk ends) */
  arrived(f: Frame): boolean {
    const { settled, velocity } = this.self.locomotion;
    return this.stands(f) && settled && velocity.lengthSq() === 0;
  }

  /** where it goes this sub-step (`go.to`), and the facing it arrives with (null: none) */
  private where(f: Frame): number | null {
    const { self, way, go } = this, within = way.within ?? 0, via = way.via ?? [];
    const effort = loadFactor(self.load), body = placeOf(self, f).setY(0);
    go.speed = Math.min(way.speed ?? STROLL.speed * self.tempo / effort, self.stepper?.top ?? Infinity);
    // (asked faster than a stroll it speeds up and brakes the quicker, as fast as it is asked or going: a gallop's stop within a gallop's reach.
    // Fit: 2, 3.9 and 2.1–3.9 m/s² at 3.5, 14 and 4 m/s, a lion's as tuned by hand before: 2, 3 and 3)
    const quicker = (way.speed ?? 0) > STROLL.speed ? Math.sqrt(Math.max(way.speed!, self.locomotion.velocity.length()) / STROLL.speed) : 1;
    go.accel = STROLL.accel * quicker * self.tempo / effort;
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
    // (on stairs at a stair's pace, and facing the way it goes: nobody backs up or down a flight)
    const stairs = stepped(self, body, go.to);
    if (stairs) go.speed = Math.min(go.speed, STAIRS.pace * self.scale);
    go.backs = way.backs && !stairs;
    return this.leg < via.length ? null : yaw;
  }

  /**
   * a walk no nearer its goal for `STALL.seconds` — nor turned nearer its facing, or with none asked the way to its goal; one followed,
   * the goal standing still meanwhile — has stalled (there, saying its feet never settled)
   */
  private watch(f: Frame, yaw: number | null): void {
    const { self, go } = this, body = placeOf(self, f), facing = yaw ?? headingOf(go.to.x - body.x, go.to.z - body.z), s = self.scale;
    const off = Math.hypot(body.x - go.to.x, body.z - go.to.z);
    // (a walk that follows, there, has nothing to get nearer: it keeps at its goal until its `until`)
    if (!this.arrives && (off < ARRIVED.distance * s || (self.locomotion.there && off < ARRIVED.stopped * s))) {
      this.since = f.time;
      return;
    }
    const left = off + Math.abs(wrapAngle(facing - self.locomotion.facing)) * STALL.turn * s;
    // (a goal followed — a walk not to end on arriving — that moves starts the watch again: it may be kept at a distance)
    const moved = !this.arrives && this.watched.distanceTo(go.to) > STALL.nearer * s;
    if (!Number.isFinite(left)) this.since = f.time;
    else if (moved || left < this.best - STALL.nearer * s) {
      [this.best, this.since] = [left, f.time];
      this.watched.copy(go.to);
    } else if (f.time - this.since > STALL.seconds) {
      const there = off < ARRIVED.distance * s && Math.abs(wrapAngle(facing - self.locomotion.facing)) < ARRIVED.yaw;
      this.stall = {
        where: `walk, ${off.toFixed(2)} m left`, off, limit: ARRIVED.distance * s,
        why: there
          ? `there and turned, but its feet never settled: a foot keeps wanting to step. An empty on a body moves as it breathes, so walk to a fixed point, or end on \`until: arriving(body, 0.3)\``
          : `no nearer its goal or its facing for ${STALL.seconds} s, ${off.toFixed(2)} m short: something holds it off, or it circles`,
      };
    }
  }
}

/**
 * about how long (s) a walk takes to end once the body stands where it goes facing as asked (`after` s ago; null: not yet): each foot
 * steps once more to square the stance (a stepping cycle steps every foot once; measured: a person's last closing step lands 0.75–1.35 s
 * after it is there, its cycle ~1 s), then all stand still till settled
 */
function closing(self: Self, after: number | null): number {
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
function etaOf(self: Self, body: Readonly<Vector3>, go: Go, yaw: number | null, turning: number): number {
  const left = Math.hypot(go.to.x - body.x, go.to.z - body.z) - ARRIVED.distance * self.scale;
  const v = Math.min(go.speed, Math.max(self.locomotion.velocity.length(), SETTING_OFF));
  const walk = left > 0 ? left / v + v / (2 * go.accel) : 0;
  const turn = yaw === null ? 0 : Math.max(0, Math.abs(wrapAngle(yaw - self.locomotion.facing)) - ARRIVED.yaw) / turning;
  return Math.max(walk, turn);
}

/**
 * whether the floor rises or falls by `STAIRS.rise` or more (m, default body) on the way from `from` to `to`, `STAIRS.ahead` (m) of it
 * at most, and `STAIRS.behind` (m) back: the body keeps its pace till it is past the edge
 */
function stepped(self: Self, from: Readonly<Vector3>, to: Readonly<Vector3>): boolean {
  if (self.floor === FLAT) return false;
  const way = _way.subVectors(to, from).setY(0), along = way.length(), s = self.scale;
  if (along < 1e-6) return false;
  way.divideScalar(along);
  const [back, ahead] = [-STAIRS.behind * s, Math.min(along, STAIRS.ahead * s)];
  let most = -Infinity, least = Infinity;
  for (let k = 0; k <= STAIRS.reads; k++) {
    const d = back + (ahead - back) * k / STAIRS.reads, y = self.floor(from.x + way.x * d, from.z + way.z * d);
    [most, least] = [Math.max(most, y), Math.min(least, y)];
  }
  return most - least >= STAIRS.rise * s;
}

/** where a walk takes the body: a species' legs carry its root there, a person's balance its centre of mass — as it stands without the
 * moment's shift of its weight over its feet (`Steps.shifted`): edged back for it, the body stepped where it would not */
const placeOf = (self: Self, f: Frame) => {
  if (self.species.legs) return _com.copy(f.prev.position(0)).setY(0);
  const com = f.prev.com(_com).setY(0);
  return self.stepper ? com.sub(self.stepper.shifted) : com;
};
const _com = new Vector3(), _way = new Vector3();
const _v = new Vector3();

/** what a walk of `request`'s stalled of: a newer verb taking the legs is why it got no nearer, whatever it looked like from here */
export function stallOf(self: Pick<Self, 'owner'>, request: Request, stall: Miss): Miss {
  const over = self.owner('go')?.request;
  return over && over !== request ? { ...stall, why: `${over.label} took the legs from it` } : stall;
}
