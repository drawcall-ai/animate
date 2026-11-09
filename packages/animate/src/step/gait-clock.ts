// The clock a gait's feet keep (a four-legged one's), and a person's cadence in its place: how long a stride takes, and for a gait whose turn each foot's lift is.
import { MathUtils, Vector3 } from 'three';
import type { Frame } from '../kernel/frame';
import { clamp, lerp, mod } from '../kernel/math';
import { offsetAt, strideAt, type Gait } from '../species/gait';
import { velocityAhead } from './leg-reach';
import { STROLL } from './leg-goal';
import { type Steps } from './steps';
import type { CadencedStepping, Feet, Leg, Reading, Timing } from './types';
import { remaining } from './swing-path';

/** A stride's time as it steps now (s): its cycle, a foot's share of it standing and its stance. */
interface StrideTime { C: number; duty: number; Ts: number }

/** A person's stride: its cadence and duty at a pace, its stance cut to its travel by quickening the whole stride. */
export class Cadence {
  constructor(private readonly st: CadencedStepping) {}

  /**
   * The fastest a planner takes a person (m/s): a run's whole stride quickens with its speed, its stance cut to its travel, until its swing
   * is down to `LEAST_SWING`. A gait's swing keeps its time: nothing but its legs keeping up holds it.
   */
  get top(): number {
    const { travel, duty, scale } = this.st;
    return travel.run * scale * (1 - duty.run) / duty.run / (LEAST_SWING * Math.sqrt(scale));
  }

  /** the speed it steps for, before its turn: as it goes */
  coming({ v }: Reading): number {
    return v;
  }

  stride({ f, v, run }: Reading, pacing: number, most: number, across: number): StrideTime {
    const { st } = this;
    // (side-stepping, quicker: short open-and-close steps rather than long straddles)
    const sideways = Math.abs(across) * MathUtils.smoothstep(v, 0, SIDE_SPEED * st.scale);
    let C = 1 / st.cadence(pacing, sideways, f.time);
    const duty = lerp(lerp(st.duty.walk, st.duty.side, Math.abs(across)), st.duty.run, run);
    // (a stance travelling further than it may is cut short: the whole stride quickens)
    if (v * duty * C > most) C = most / (v * duty);
    return { C, duty, Ts: duty * C };
  }
}

/**
 * A gait's clock: its footfalls shifting toward the gait's at the pace it keeps — a walk's, a trot's, a gallop's — no faster than `SHIFT`
 * of a cycle a cycle; each foot lifting its own stance after it lands (a leg whose gait has it stand shorter lifts sooner — a horse's
 * hinds at a walk), in its turn as the clock passes it; the clock running while the feet step or would: walking, turning, squaring up.
 */
export class GaitClock {
  /** where in the gait's cycle it is (cycles, 0 … 1) */
  at = 0;
  /** how far it has run since it set off from standing (cycles): a foot is in its turn only for a turn that has come round since, and
   * overdue only for a stance it has stood since — standing, every foot has stood long, and the one before the first in the gait is
   * still in its turn as the clock starts */
  since = 0;
  /** whether the cycle is under way */
  going = false;
  /** each foot's footfall in the cycle (0 … 1), as it shifts toward the gait's at its pace */
  footfalls: number[];
  /** where in the cycle each foot lifts */
  lifts: number[] = [];
  /** how many of the other feet the gait has down as each lifts */
  scheduled: number[] = [];
  /** whether each foot let its turn pass held down, and steps as soon as it may */
  readonly owed: boolean[] = [];
  /** the turn (rad/s) a walk's stride is quickened for: let go of no faster than `SWEEPING` (rad/s²) */
  private sweeping = 0;
  /** how fast (1/m … per rad) a turn uses up the feet's stray: the hips' furthest from the root over the feet's narrowest sweep */
  private readonly sweep: number;
  /** which soles were off the floor in the last final pose `check` read */
  private aloft: boolean[] | null = null;

  constructor(private readonly gait: Gait, offsets: readonly number[], feet: Feet, private readonly legs: readonly Leg[]) {
    this.footfalls = [...offsets];
    const strays = feet.legs.map((leg) => leg.stray);
    const furthest = Math.max(...feet.legs.map((leg) => Math.hypot(leg.hip ?? feet.hip, leg.ahead ?? 0)));
    const sweeps = strays.every((stray) => stray !== undefined && stray > 0);
    this.sweep = sweeps ? furthest / (2 * Math.min(...strays.map((stray) => stray ?? Infinity))) : Infinity;
  }

  /** a gait's swing keeps its time: nothing but its legs keeping up holds it */
  get top(): number {
    return Infinity;
  }

  /**
   * the speed it steps for, before its turn: as fast as it will be going by mid-stance — setting off, it steps as quickly as it is about
   * to go, not as it stood — and trotting, held back from going faster than a stroll, as fast as it would be going: slowed to the pace
   * held, each foot's turn came later, the wait held it back more, and it trotted stop-go at a walk's pace however fast it was asked
   */
  coming(root: Reading): number {
    const { r, v } = root;
    if (!r.forecast) return v;
    const goes = r.wanted?.velocity.length() ?? 0, hurried = goes > STROLL.speed + 1e-6 && !this.walking;
    return Math.max(v, hurried ? goes : velocityAhead(root, PACING, _ahead).length());
  }

  stride({ v, pressed, dt }: Reading, pacing: number, most: number): StrideTime {
    const { frequency, duty } = strideAt(this.gait, pacing, 0);
    let C = 1 / frequency;
    const swingTime = (1 - duty) * C;
    // (a stance travelling further than it may is cut short: its swing keeps its time)
    if (v * duty * C > most) C = most / v + swingTime;
    // (a stance turning cut short too as its hips sweep across their feet: each foot from as far one way as it strays to as far the other,
    // the hips swinging round at the turn's rate about the root — a run's swing keeping its time; a walk's whole stride quickening, quicker
    // smaller steps, its swing no more than `PAIRED` of its stance: its feet half a cycle apart never in the air together)
    let swing = swingTime;
    const walking = this.walking, turn = this.sweeping = walking ? Math.max(Math.abs(pressed), this.sweeping - SWEEPING * dt) : Math.abs(pressed);
    if (this.sweep < Infinity && turn * this.sweep * (C - swing) > 1) {
      const cut = 1 / (turn * this.sweep);
      swing = walking && duty >= 0.5 ? Math.min(swing, cut * PAIRED) : swing;
      C = cut + swing;
    }
    return { C, duty, Ts: C - swing };
  }

  /** the footfalls a sub-step nearer the gait's at `pacing`, and each foot's lift and how many stand then */
  retime({ pacing, dt, C, duty, Ts, Tsw }: Timing & { dt: number }): void {
    const { gait, legs } = this;
    this.footfalls = legs.map((leg) => {
      const at = this.footfalls[leg.i], to = offsetAt(gait, pacing, leg.i), off = to - at - Math.round(to - at);
      return mod(at + clamp(off, -SHIFT * dt / C, SHIFT * dt / C));
    });
    this.lifts = legs.map((leg) => this.footfalls[leg.i] + (strideAt(gait, pacing, leg.i).duty - duty) * Ts / (duty * C));
    // (each in the air for its swing's share after its own turn comes round)
    const down = (leg: Leg) => legs.filter((other) => other !== leg && mod(this.lifts[leg.i] - this.lifts[other.i]) >= Tsw / C - 1e-9);
    this.scheduled = legs.map((leg) => down(leg).length);
  }

  /** the cycle started with `first`'s turn */
  setOff(first: Leg): void {
    [this.at, this.since] = [this.lifts[first.i], 0];
  }

  /** the clock on a sub-step: a foot whose turn passes while it is held down still owes its step, taken as soon as it may, not a cycle on */
  tick(input: { dt: number; C: number; duty: number; moving: number }): void {
    const { dt, C, moving } = input, was = this.legs.map((leg) => this.inTurn(leg));
    this.at = (this.at + dt / C) % 1;
    this.since += dt / C;
    for (const leg of this.legs) {
      const passed = was[leg.i] && mod(this.at - this.lifts[leg.i]) >= SLOT;
      if (!leg.swing && passed && this.stood(input, leg) && moving > 0) this.owed[leg.i] = true;
    }
  }

  /** whether a foot's turn has come round since it set off, within `SLOT` of a cycle */
  inTurn(leg: Leg): boolean {
    const into = mod(this.at - this.lifts[leg.i]);
    return into < SLOT && into <= this.since + 1e-9;
  }

  /** whether a foot has stood `SLOT` of a cycle, or half the gait's stance if that is shorter (a gallop's) */
  stood({ C, duty }: { C: number; duty: number }, leg: Leg): boolean {
    return leg.planted >= Math.min(SLOT, duty / 2) * C;
  }

  /** whether a foot is due, walking or turning: within `SLOT` of a cycle after its turn comes round, owed it, or overdue by `after` cycles */
  due({ C }: { C: number }, leg: Leg, after: number): boolean {
    return this.inTurn(leg) || this.owed[leg.i] || (leg.planted >= C * after && this.since >= after);
  }

  /** whether each foot leaves the floor in a turn of its own (a walk's), none with another (a trot's diagonals) */
  get walking(): boolean {
    return this.legs.every((a) => this.legs.every((b) => a === b || !this.together(a, b)));
  }

  /** whether two feet are never in the air together: their turns a swing or more apart either way round */
  exclusive(a: Leg, b: Leg, { Tsw, C }: Pick<Timing, 'Tsw' | 'C'>): boolean {
    const d = mod(this.lifts[a.i] - this.lifts[b.i]);
    return Math.min(d, 1 - d) >= Tsw / C - 1e-9;
  }

  /** whether two feet leave the floor together: their footfalls within `TOGETHER` of a cycle */
  together(a: Leg, b: Leg): boolean {
    const apart = this.footfalls[a.i] - this.footfalls[b.i];
    return Math.abs(apart - Math.round(apart)) < TOGETHER;
  }

  /** whether the gait holds down a foot that would lift, whatever is asked of it */
  holdsDown(leg: Leg, input: Pick<Timing, 'Tsw' | 'C'> & { airborne: boolean; dt: number }): boolean {
    const { legs } = this, { airborne, dt, C } = input;
    // (it lifts no foot it has only just put down: a step lands and bears weight before the next)
    if (leg.planted < SETTLING * C) return true;
    if (airborne) return false;
    // (a body never leaves fewer than `STANDING` feet on the floor — nor than its gait has down as this one lifts: a trot quicker than half
    // its cycle in stance has a moment in the air — one out of reach waits, the others land first; one of a pair lifting this sub-step
    // still counts as down: the pair leaves the floor together)
    const down = legs.filter((o) => o !== leg && (!o.swing || (o.swing.age <= dt && this.together(leg, o)))).length;
    if (down < Math.min(STANDING, this.scheduled[leg.i])) return true;
    // (nor, walking, while one its gait never has in the air with it is, out of reach or not: it waits for it to land, as the planner foresees)
    if (this.walking && legs.some((o) => o.swing && this.exclusive(leg, o, input))) return true;
    // (nor just after one its gait sets apart from it, out of reach or not: the feet leave the floor one by one, `TOGETHER` apart)
    return legs.some((o) => o !== leg && o.lifted < TOGETHER * C && !this.together(leg, o));
  }

  /**
   * how long (s) a planted foot may have to stand before it next lifts, a stride taking `cycle` s: till the others in the air have landed,
   * or as its turn comes round if the gait has it leave the floor before they do; turning on the spot, till its own turn comes round;
   * walking, toward its own turn too, `AWAIT` of a cycle at most, and till what it waits for to lift lands
   */
  wait(leg: Leg, cycle: number, moving: number, input: Pick<Timing, 'Tsw' | 'C'> | undefined): number {
    const { legs } = this, landed = Math.max(0, ...legs.map((l) => l.swing ? remaining(l.swing) : 0));
    const own = mod(this.lifts[leg.i] - this.at) * cycle;
    let wait = Math.max(Math.min(landed, this.scheduled[leg.i] < STANDING ? own : Infinity), moving > 0.05 ? 0 : own);
    if (!input || !this.walking) return wait;
    if (!this.owed[leg.i]) wait = Math.max(wait, this.inTurn(leg) ? 0 : Math.min(own, AWAIT * cycle));
    return Math.max(wait, ...legs.map((o) => o.swing && this.exclusive(leg, o, input) ? remaining(o.swing) : 0));
  }

  /**
   * Development check of the last final pose (`f.prev`): a gait's feet leave the floor one by one, in its order — only those whose
   * footfalls it has within `TOGETHER` of a cycle (a trot's diagonals) together; a leap's all at once — and, walking, none lifts while one
   * whose turn is a swing or more from it (a girdle's) is in the air.
   */
  check(f: Frame, steps: Pick<Steps, 'feet' | 'airborne' | 'input' | 'above'>): void {
    if (!f.dev) return;
    const { legs } = this, { feet, airborne, input } = steps, was = this.aloft;
    const aloft = legs.map((leg) => {
      const { foot, toes } = feet.legs[leg.i], rotation = f.prev.rotation(foot);
      return steps.above(feet.soles(leg.i, f.prev.position(foot), rotation, toes === undefined ? rotation : f.prev.rotation(toes))) > LIFTED;
    });
    this.aloft = aloft;
    if (!was || airborne) return;
    const name = (leg: Leg) => f.prev.skeleton.bones[feet.legs[leg.i].foot].name;
    const left = legs.filter((leg) => aloft[leg.i] && !was[leg.i]);
    // (a walk — more than half a cycle on the floor as it steps now, each foot in a turn of its own — lifts none while the one half a cycle
    // from it, a girdle's, is in the air; a stance cut short past half the cycle is a run's, and a pair a run lifted not the walk's after)
    if (input && input.Ts / input.C >= 0.5 && this.walking) for (const a of left) for (const b of legs) {
      const d = mod(this.footfalls[a.i] - this.footfalls[b.i]), value = Math.min(d, 1 - d);
      if (b === a || !aloft[b.i] || value < 0.5 - TOGETHER) continue;
      f.dev.append(f.time - f.dt, { check: 'walk pair in the air together (cycle apart)', value, limit: 0.5 - TOGETHER, where: `${name(a)} with ${name(b)}` });
    }
    for (const a of left) for (const b of left) {
      if (b.i <= a.i || this.together(a, b)) continue;
      const apart = this.footfalls[a.i] - this.footfalls[b.i], value = Math.abs(apart - Math.round(apart));
      f.dev.append(f.time - f.dt, { check: 'gait lift-off together (cycle apart)', value, limit: TOGETHER, where: `${name(a)} with ${name(b)}` });
    }
  }
}

/** how long a gait's foot bears weight once down before it lifts again (share of a cycle) */
export const SETTLING = 0.1;
/** the fewest feet a gait's body leaves on the floor */
export const STANDING = 2;
/** Derived: a gait's feet whose footfalls are within `TOGETHER` of a cycle leave the floor together (a trot's diagonals, 0.02 apart in
 * Clayton-Hobbs' offsets), the others at least that far apart (a walk's neighbours are 0.25 apart: half of that and more is clear of both) */
const TOGETHER = 0.1;
/** Tuned: a quickened walk lets go of the turn it quickened for no faster than this (rad/s²): held back and let go by the planner sub-step
 * by sub-step, its cadence would flicker, a swing quickened mid-air slamming down */
const SWEEPING = 4;
/** how soon after its offset comes round a gait's foot lifts, and how long it stands first (shares of a cycle) */
const SLOT = 0.25;
/** Tuned: a gait's footfalls shift toward another gait's at most this share of a cycle a cycle: a change of gait over a stride or two */
const SHIFT = 0.5;
/**
 * Tuned (s, default legs): past a swing this short, under a player's root as a planner's, the dev log's joint rates and touchdowns grow (a
 * person's top: 4 m/s). Read (the abstract of Weyand et al. 2000, J Appl Physiol 89:1991): swing time does not vary with a runner's top
 * speed. Recalled: ~0.37 s, from the same paper
 */
const LEAST_SWING = 0.4;
/** Tuned: how far ahead (s) a gait's cadence takes the speed it will be going */
const PACING = 0.4;
/** Derived: a walk's swing quickened by a turn is at most this share of its stance — its feet half a cycle apart on a girdle never in the
 * air together (Hildebrand's walk: more than half a cycle on the floor), the one landing `SETTLING` of a cycle before the other lifts */
const PAIRED = (0.5 - SETTLING) / (0.5 + SETTLING);
/** Tuned: walking, a planted foot is kept within reach toward its own turn this share of a cycle at most: the planner holds the root for
 * it rather than the foot stepping out of turn, and not so long the walk holds back a cycle for a foot that is nearly due */
export const AWAIT = 0.1;
/** Tuned: a sole this far (m) above the floor in a final pose has left it (planted, it stands within 0.1 mm of it) */
const LIFTED = 0.005;
/** Tuned (m/s): stepping sideways this fast, a body steps at its side-stepping cadence (slower, toward it) */
const SIDE_SPEED = 0.3;
const _ahead = new Vector3();
