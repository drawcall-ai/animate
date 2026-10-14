import { Quaternion, Vector3 } from 'three';
import type { Item, Side } from '@drawcall/animate';
import { eyesOf, jointOf } from '../src/joints';
import { FIXED_DT } from '../src/scenario';
import type { Frame } from './frame';
import type { Check } from './judge';
import { beyondEyes } from './targets';

// Flow: whether one thing runs into the next, as people do, or the motion goes step by step —
// standing dead between beats, the eyes arriving with the hand, reaches gliding at one speed or
// stopping at every waypoint, both hands as mirror images, a walk stopped and set off again.

/** below this speed (m/s) a point is still: the rest jitter of a standing body */
const STILL = 0.05;
/** still this long (s), everything at once, is dead time */
const DEAD = 0.3;
/** a hand moving faster than this relative to the hips (m/s) is on its way somewhere */
const MOVING = 0.05;
/** a reach: a hand's movement this long at least (m), mostly standing (a walk's arm swing is not one) */
const REACH = 0.15;
/** the body walks above this ground speed (m/s) and has stopped below STOPPED */
const WALKING = 0.3;
const STOPPED = 0.05;
/** a walk lasts this long at least (s): shorter is a step */
const WALK = 0.5;
/** how far back a gaze is looked for before a contact (s) */
const LOOKBACK = 5;
/** after arriving, the body counts as stalled if its hands and eyes rest from within this long (s) */
const SETTLING = 0.5;
/** after arriving, a hand or the eyes faster than this (m/s) set off again: above the arms' swing dying away */
const STIRRING = 0.1;
/** a hand at rest less than this between two moves (s) stopped dead at a waypoint, unless it took hold or let go within HANDLING (s) of it */
const HALT = 0.25;
const HANDLING = 0.3;
/** two hands taking hold within this of each other (s) take hold together */
const TOGETHER = 0.3;
/** two hands mirror each other setting off within this (s) and lasting as long within this share */
const MIRROR = { onset: 0.05, duration: 0.1 };

/** a hand's movement relative to the hips: from, to (s), its path (m), its peak speed over its mean, the share of it walked */
export interface Movement {
  side: Side;
  from: number;
  to: number;
  path: number;
  ratio: number;
  walked: number;
}

/** the flow of a run: each over the window `from`–`to` (s) its beats run in */
export interface FlowReport {
  from: number;
  to: number;
  /** spans everything stood still (s) */
  dead: { from: number; to: number }[];
  /** each hand taking hold: when, which, how long the eyes were on the grip or the item before (s; −∞: not on it as the hand closed) */
  gaze: { t: number; side: Side; lead: number }[];
  /** the discrete reaches (standing) */
  reaches: Movement[];
  /** a hand stopping dead between two moves (a waypoint): when, which, how long (s) */
  halts: { t: number; side: Side; gap: number }[];
  /** both hands setting off together as mirror images: when, their onsets apart (s) */
  mirrored: { t: number; dt: number }[];
  /** a walk stopped and set off again: when it stopped, how long it stood (s) */
  stopStarts: { t: number; gap: number }[];
  /** each arrival: when, how long hands and eyes stood still after it (s) */
  arrivals: { t: number; stall: number }[];
}

interface Sample {
  t: number;
  /** the points that show motion: the hands, feet, hips and `sight` */
  points: Vector3[];
  /** a point 30 cm ahead of the eyes on the head's line: it moves as the head turns */
  sight: Vector3;
  /** the hands relative to the hips */
  hands: [Vector3, Vector3];
  ground: number;
  eyes: Vector3;
  /** the head turned the other way: the world into its frame */
  unturn: Quaternion;
  ahead: Vector3;
  /** what each hand holds */
  held: [Item | null, Item | null];
}

/** a hand taking hold: when, which, the points the eyes may be on (the grip, the item) */
interface Contact {
  t: number;
  side: Side;
  points: Vector3[];
}

const SIDES = ['left', 'right'] as const;

/**
 * a minimum-jerk reach's peak speed over its mean (Flash & Hogan 1985): a bell. Well under it is a
 * glide at one speed, well over it a jab; the band is not sourced, so it is advisory
 */
export const BELL = { ideal: 1.875, low: 1.5, high: 2.6 };
/**
 * how long the eyes are on what a hand takes before it closes (s): people fixate an object about
 * 0.4–0.6 s before the hand gets there (Land, Mennie & Rusted 1999; Land & Hayhoe 2001), and the
 * eyes always arrive first (Johansson et al. 2001)
 */
export const GAZE_LEAD = 0.4;

/** the flow as checks: the gaze leading each hand is held to its source, the rest are advisory */
export function flowChecks(r: FlowReport): Check[] {
  const out: Check[] = [];
  const worst = <T>(xs: T[], by: (x: T) => number) => xs.reduce<T | null>((w, x) => (w === null || by(x) > by(w) ? x : w), null);
  const lead = worst(r.gaze, (g) => -g.lead);
  if (lead) out.push({ what: 'eyes on what the hand takes before it closes (s)', value: lead.lead, bound: 'min', limit: GAZE_LEAD, at: lead.t, where: `${lead.side}Hand`, fix: 'look first: `withGaze(h, at, task)`, or `grab` with `look`; set the eyes off ~0.6 s before the hand (`overlap` with a walk `eta`)' });
  const dead = worst(r.dead, (d) => d.to - d.from);
  out.push({ what: 'dead time: everything still (s)', value: dead ? dead.to - dead.from : 0, bound: 'max', limit: 0.3, at: dead?.from, fix: "overlap the next beat with this one's end (`overlap`, a walk's `eta`): its eyes and feet set off while the hands finish", advisory: true });
  const glide = worst(r.reaches, (m) => -m.ratio);
  if (glide) out.push({ what: `reach speed peak/mean, lowest (min-jerk ${BELL.ideal})`, value: glide.ratio, bound: 'min', limit: BELL.low, at: glide.from, where: `${glide.side}Hand`, fix: 'a glide at one speed: give a discrete reach `seconds` (a minimum-jerk bell) rather than a speed cap (`CALM`)', advisory: true });
  const jab = worst(r.reaches, (m) => m.ratio);
  if (jab) out.push({ what: `reach speed peak/mean, highest (min-jerk ${BELL.ideal})`, value: jab.ratio, bound: 'max', limit: BELL.high, at: jab.from, where: `${jab.side}Hand`, fix: 'a jab: a goal that jumps or a reach too short in time — give it `seconds` from its distance', advisory: true });
  out.push({ what: 'hand stopping dead at a waypoint (count)', value: r.halts.length, bound: 'max', limit: 0, at: r.halts[0]?.t, where: r.halts[0] && `${r.halts[0].side}Hand`, fix: 'one course through the places (`carry` legs pass them without stopping), not moves that each stop', advisory: true });
  out.push({ what: 'both hands mirrored (count)', value: r.mirrored.length, bound: 'max', limit: 0, at: r.mirrored[0]?.t, fix: 'let one hand lead (the right, the left a moment later and a little slower), as `grab` does', advisory: true });
  out.push({ what: 'walk stopped and set off again (count)', value: r.stopStarts.length, bound: 'max', limit: 0, at: r.stopStarts[0]?.t, fix: 'one walk to the last goal (or a moving `to`), the turn asked as it walks, not walk–stop–walk', advisory: true });
  const stall = worst(r.arrivals, (a) => a.stall);
  if (stall) out.push({ what: 'arrival stall: standing still after a walk (s)', value: stall.stall, bound: 'max', limit: 0.3, at: stall.t, fix: "start the next task before arriving: `overlap(walkTo({ eta }), next, before(eta, 0.6))`", advisory: true });
  return out;
}

/** the flow metrics: frames seen, read against the beats a run's tasks made (beats.ts) */
export class Flow {
  private readonly samples: Sample[] = [];
  /** each hand taking hold */
  private readonly contacts: Contact[] = [];
  /** each hand taking hold or letting go: when */
  private readonly changes: number[] = [];
  /** what the body wore last step (a hand may take a worn thing off in the step it takes hold) */
  private worn = new Set<Item>();

  see({ t, h }: Frame) {
    const head = h.model.scene.getObjectByName('head');
    if (!head) throw new Error('no head');
    const turn = head.getWorldQuaternion(new Quaternion());
    const ahead = new Vector3(0, 0, 1).applyQuaternion(turn);
    const eyes = eyesOf(h);
    const hips = jointOf(h, 'hips');
    const hands: [Vector3, Vector3] = [jointOf(h, 'leftHand'), jointOf(h, 'rightHand')];
    const sight = eyes.clone().addScaledVector(ahead, 0.3);
    const points = [...hands, jointOf(h, 'leftFoot'), jointOf(h, 'rightFoot'), hips, sight];
    this.samples.push({ t, points, sight, hands: [hands[0].clone().sub(hips), hands[1].clone().sub(hips)], ground: Math.hypot(h.gait.velocity.x, h.gait.velocity.z), eyes, unturn: turn.invert(), ahead, held: [h.holding.left?.item ?? null, h.holding.right?.item ?? null] });
    const before = this.samples.at(-2)?.held ?? [null, null];
    SIDES.forEach((side, s) => {
      const held = h.holding[side];
      if ((held?.item ?? null) !== before[s]) this.changes.push(t);
      // (a hand taking hold of what the body wears, its own buckle or strap, goes by feel, not by the eyes)
      if (held && !before[s] && !this.worn.has(held.item)) {
        const g = held.item.grips[held.grip];
        if (!g) throw new Error(`the item has no grip "${held.grip}"`);
        this.contacts.push({ t, side, points: [g.position.clone().applyQuaternion(held.item.current.quaternion).add(held.item.current.position), held.item.current.position.clone()] });
      }
    });
    this.worn = new Set(h.worn.keys());
  }

  /**
   * the flow over `from`–`to` (s): where the run's beats run, its end at rest left out; `working`
   * tells when a task has the hands (the reaches are theirs: free arms swing with the body)
   */
  report(from: number, to: number, working: (t: number) => boolean = () => true): FlowReport {
    const within = (t: number) => t >= from && t <= to;
    const moves = SIDES.flatMap((side, s) => this.movements(side, s));
    const reaches = moves.filter((m) => m.walked < 0.5 && m.path >= REACH && within(m.from) && (working(m.from) || working(m.to)));
    // (a hand stops to take hold or let go: that is no waypoint)
    const handled = (from: number, to: number) => this.changes.some((t) => t > from - HANDLING && t < to + HANDLING);
    const halts = SIDES.flatMap((side) => {
      const own = reaches.filter((m) => m.side === side);
      return own.slice(1).flatMap((m, i) => (m.from - own[i].to < HALT && !handled(own[i].to, m.from) ? [{ t: own[i].to, side, gap: m.from - own[i].to }] : []));
    });
    // (two hands carrying one thing between them move alike by necessity)
    const together = (t: number) => {
      const held = this.samples.find((q) => q.t >= t)?.held;
      return !!held?.[0] && held[0] === held[1];
    };
    const mirrored = reaches.filter((l) => l.side === 'left' && !together(l.from)).flatMap((l) => {
      const r = reaches.find((m) => m.side === 'right' && Math.abs(m.from - l.from) < MIRROR.onset && Math.abs(m.to - m.from - (l.to - l.from)) < MIRROR.duration * (l.to - l.from));
      return r ? [{ t: l.from, dt: Math.abs(r.from - l.from) }] : [];
    });
    const walks = this.walks();
    // (stopped for nothing the hands did: one walk would have done)
    const stopStarts = walks.slice(1).flatMap((w, i) => (this.lowest(walks[i].to, w.from) < STOPPED && !handled(walks[i].to, w.from) && within(walks[i].to) ? [{ t: walks[i].to, gap: w.from - walks[i].to }] : []));
    const arrivals = walks.filter((w) => within(w.to)).map((w) => ({ t: w.to, stall: this.stall(w.to, to) }));
    // (the two hands taking hold together: the eyes may be between them)
    const between = (c: Contact) => this.contacts.filter((o) => o !== c && Math.abs(o.t - c.t) < TOGETHER).map((o) => o.points[0].clone().lerp(c.points[0], 0.5));
    const gaze = this.contacts.filter((c) => within(c.t)).map((c) => ({ t: c.t, side: c.side, lead: this.lead(c.t, [...c.points, ...between(c)]) }));
    return { from, to, dead: this.dead(from, to), gaze, reaches, halts, mirrored, stopStarts, arrivals };
  }

  /** spans longer than DEAD with every point still, within `from`–`to` */
  private dead(from: number, to: number) {
    const spans: { from: number; to: number }[] = [];
    let start: number | null = null;
    this.samples.forEach((q, i) => {
      const still = i > 0 && q.t >= from && q.t <= to && q.points.every((p, k) => p.distanceTo(this.samples[i - 1].points[k]) / FIXED_DT < STILL);
      if (still) start ??= q.t;
      else if (start !== null) {
        if (q.t - start > DEAD) spans.push({ from: start, to: q.t });
        start = null;
      }
    });
    const last = this.samples.at(-1);
    if (start !== null && last && last.t - start > DEAD) spans.push({ from: start, to: last.t });
    return spans;
  }

  /** how long before `t` the eyes came onto one of `points` and stayed on them (s); −∞ if not on them at `t` */
  private lead(t: number, points: Vector3[]): number {
    // (on it: within what the eyes turn comfortably in the head, as the gaze is judged in targets.ts)
    const on = (q: Sample) =>
      points.some((p) => {
        const toward = p.clone().sub(q.eyes);
        return beyondEyes(toward.clone().applyQuaternion(q.unturn), (q.ahead.angleTo(toward) * 180) / Math.PI) === 0;
      });
    const before = this.samples.filter((q) => q.t <= t && q.t > t - LOOKBACK);
    let i = before.length - 1;
    if (i < 0 || !on(before[i])) return -Infinity;
    while (i > 0 && on(before[i - 1])) i--;
    return t - before[i].t;
  }

  /** hand `side`'s movements relative to the hips: spans faster than MOVING */
  private movements(side: Side, s: number): Movement[] {
    const out: Movement[] = [];
    let span: { from: number; speeds: number[]; walked: number } | null = null;
    const close = (to: number) => {
      if (!span) return;
      const path = span.speeds.reduce((a, v) => a + v * FIXED_DT, 0);
      const mean = path / (span.speeds.length * FIXED_DT);
      out.push({ side, from: span.from, to, path, ratio: Math.max(...span.speeds) / mean, walked: span.walked / span.speeds.length });
      span = null;
    };
    this.samples.forEach((q, i) => {
      if (i === 0) return;
      const v = q.hands[s].distanceTo(this.samples[i - 1].hands[s]) / FIXED_DT;
      if (v < MOVING) return close(q.t);
      span ??= { from: this.samples[i - 1].t, speeds: [], walked: 0 };
      span.speeds.push(v);
      if (q.ground > WALKING) span.walked++;
    });
    close(this.samples.at(-1)?.t ?? 0);
    return out;
  }

  /** the walks: spans of WALK s or longer above WALKING, each to where it slowed below WALKING */
  private walks() {
    const out: { from: number; to: number }[] = [];
    let from: number | null = null;
    for (const q of this.samples) {
      if (q.ground > WALKING) from ??= q.t;
      else if (from !== null) {
        if (q.t - from >= WALK) out.push({ from, to: q.t });
        from = null;
      }
    }
    return out;
  }

  /** the lowest ground speed between `from` and `to` (s) */
  private lowest(from: number, to: number) {
    return Math.min(...this.samples.filter((q) => q.t >= from && q.t <= to).map((q) => q.ground));
  }

  /**
   * how long the hands and eyes stood still after a walk that slowed at `t`: the first rest that
   * begins within SETTLING s, until any of them moves again (by `end` at the latest)
   */
  private stall(t: number, end: number): number {
    const i = this.samples.findIndex((q) => q.t > t);
    if (i < 1) return 0;
    let start: number | null = null;
    for (let k = i; k < this.samples.length; k++) {
      const q = this.samples[k];
      const prev = this.samples[k - 1];
      const moving = q.hands.some((p, s) => p.distanceTo(prev.hands[s]) / FIXED_DT > STIRRING) || q.sight.distanceTo(prev.sight) / FIXED_DT > STIRRING;
      if (start === null && moving && q.t - t > SETTLING) return 0;
      if (start === null && !moving) start = q.t;
      if (start !== null && (moving || q.t >= end)) return q.t - start;
    }
    return 0;
  }
}
