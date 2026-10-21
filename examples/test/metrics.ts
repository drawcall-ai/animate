// Scenario statistics and task accuracy: these are regression tests, not runtime invariants.
import { ArmTurns, FreeArms } from './arms';
import { Clearance } from './clearance';
import { Feet, FinalStance, Landings } from './body';
import type { Frame } from './frame';
import { GaitKinematics, RUNNING } from './gait';
import { Targets } from './targets';

export interface MetricsOptions {
  strides?: { straight: number; curve: number };
  wrist?: number;
  head?: number;
  startStop: number | null;
  clearance?: number;
}
const TRACKED = 0.8;
const LATE_RETARGET = 0.03;
const GAZE = 5;
const WIDE = 1.5;
const ASYMMETRY = 0.05;
/** every metric over a run of scenario `id`: `steps` gives each fixed step's frames, one per actor (the feet are every actor's, the rest the first's) */
export function measure(id: string, steps: Iterable<readonly Frame[]>) {
  const feet = new Feet();
  const landings = new Landings();
  const targets = new Targets();
  const gait = new GaitKinematics();
  const arms = new FreeArms();
  const turns = new ArmTurns();
  const stance = new FinalStance();
  const clearance = new Clearance();
  let frames = 0;
  for (const step of steps) {
    frames++;
    step.forEach((f, i) => {
      feet.see(f);
      landings.see(f);
      if (i > 0) return;
      for (const m of [targets, gait, arms, turns, stance, clearance]) m.see(f);
    });
  }
  const report = [`== ${id} (${frames} frames)`, feet, landings, targets, gait, arms, turns, stance, clearance].join('\n');
  return { report, feet, landings, targets, gait, arms, turns, stance, clearance };
}

export type Measured = ReturnType<typeof measure>;

interface Check {
  what: string;
  value: number;
  bound: 'max' | 'min' | 'is';
  limit: number;
  at?: number;
  where?: string;
}
export const failed = (c: Check) => !(c.bound === 'max' ? c.value <= c.limit : c.bound === 'min' ? c.value >= c.limit : c.value === c.limit);

/** Regression assertions shared by scenario tests. */
export function checks(m: Measured, limit: MetricsOptions): Check[] {
  const out: Check[] = [];
  const add = (what: string, value: number, bound: Check['bound'], lim: number, at?: number, where?: string) => void out.push({ what, value, bound, limit: lim, at, where });
  add('planted foothold out of reach (m)', m.feet.reach.value, 'max', 0.3, m.feet.reach.at);
  add('knee-backward frames', m.feet.hyper, 'max', 0);
  const [pointed, flexed] = [20, 125];
  add('ankle pointed (°)', 180 - m.feet.ankle.min.value, 'min', pointed - 1, m.feet.ankle.min.at);
  add('ankle flexed up (°)', m.feet.ankle.max.value, 'max', flexed + 1, m.feet.ankle.max.at);
  add('late landing retarget (m)', m.landings.late.value, 'max', LATE_RETARGET, m.landings.late.at);
  // stopping and standing, no wide catching steps: the feet land at most WIDE stances apart
  add('slow step width (× stance)', m.landings.wide.value, 'max', WIDE, m.landings.wide.at);
  add('leg-crossing frames', m.feet.crossings, 'max', 0);
  // (what is held or tracked is judged: a head every frame it is asked, the wrists on most frames, out of reach only while walked to)
  if (limit.wrist !== undefined) add('wrist off its grip or target (m)', m.targets.wrist, 'max', limit.wrist, m.targets.wristAt);

  if (limit.head !== undefined) {
    add('eyes off the tracked head (m)', m.targets.head, 'max', limit.head, m.targets.headAt);
    add('tracked head: frames judged', m.targets.tracked.head, 'min', 1);
  }
  add('tracked wrists: frames judged (share of those asked)', m.targets.tracked.asked ? m.targets.tracked.judged / m.targets.tracked.asked : 1, 'min', TRACKED);
  add("gaze target beyond the eyes' comfortable turn (°)", m.targets.gaze, 'max', GAZE, m.targets.gazeAt);
  // (a gaze asked is judged somewhere: one always behind the body would pass unseen)
  if (m.targets.asked > 0) add('gaze: frames judged', m.targets.judged, 'min', 1);
  if (limit.strides) {
    const count = (curve: boolean) => m.gait.strides.filter((s) => s.curve === curve && s.speed <= RUNNING).length;
    add('steady straight walking strides judged', count(false), 'min', limit.strides.straight);
    add('steady curve walking strides judged', count(true), 'min', limit.strides.curve);
  }
  for (const [curve, run] of [[false, false], [false, true], [true, false], [true, true]]) {
    // (walking and running strides each against their own references)
    const g = m.gait.summary(curve, run);
    if (!g) continue;
    const gait = (what: string, value: number, bound: Check['bound'], lim: number) => add(`${curve ? 'curve' : 'straight'} ${run ? 'running' : 'walking'} strides: ${what}`, value, bound, lim);
    // walking pelvis sway ~3–5 cm peak to peak (Orendurff 2004), a runner's less
    gait('pelvis lateral p2p (m)', g.pelvisLat, 'min', run ? 0.01 : 0.025);
    gait('pelvis lateral p2p (m)', g.pelvisLat, 'max', run ? 0.045 : 0.06);
    // the upper body rides the pelvis's sway, no wider, and stays near vertical over it
    gait('chest lateral p2p (m)', g.chestLat, 'max', g.pelvisLat + 0.005);
    gait('trunk lateral lean (°)', g.lean, 'max', 2.5);
    gait('head roll (°)', g.headRoll, 'max', 2);
    // smooth: one sway per stride, over the stance foot at mid-stance, no jitter
    gait('chest sway beyond the stride frequency', g.chestResidual, 'max', 0.4);
    // the steps alike: left and right as long, on a curve too
    gait('step length asymmetry', g.stepAsymmetry, 'max', ASYMMETRY);
    gait('chest lateral jerk (m/s³)', g.chestJerk, 'max', 50);
    gait('pelvis over the stance foot at mid-stance', g.phase, 'min', 0.7);
    // the whole body moves as in motion capture (CMU walks at 1.0–1.4 m/s, runs at 3.2–3.6):
    // the thorax rolls with its rotation, the forward shoulder up (corr ~0.95); the head goes
    // along with ~55% of that rotation; the trunk nods forward at each double support (±1.2°
    // walking, ±3° running); the ankle pushes off; the knee stays bent late into the swing
    gait('thorax roll with its rotation', g.rollWithYaw, 'min', 0.7);
    if (!Number.isNaN(g.headCarry)) {
      gait("the head's share of the thorax rotation", g.headCarry, 'min', 0.35);
      gait("the head's share of the thorax rotation", g.headCarry, 'max', 0.8);
    }
    gait('trunk nod (°)', g.nod, 'min', run ? 1 : 0.6);
    gait('trunk nod (°)', g.nod, 'max', run ? 3.5 : 3);
    gait('ankle push-off (°)', g.pushOff, 'min', run ? 30 : curve ? 8 : 15);
    gait('knee at 3/4 of the swing (°)', g.lateKnee, 'min', run ? 45 : 15);
    // free arms swing with the legs, one cycle per stride: each forward with the other leg,
    // a pendulum — one smooth sinusoid, turning back once at each end, no jolt there
    if (g.armRange > 10) {
      gait('arm swings per stride', g.armCycles, 'is', 1);
      gait('arm swing against one sinusoid (R²)', g.armFit, 'min', 0.97);
      gait('arm swing turning points per stride', g.armTurns, 'is', 2);
      gait("arm swing peak acceleration (× the sinusoid's)", g.armAcceleration, 'max', 2);
      gait('arm with the other leg', g.armCorrelation, 'min', 0.7);
      gait('arm lag (share of the stride)', Math.abs(g.armLag), 'max', 0.08);
    }
  }
  // setting off and stopping blend in and out of the walk: no pitch faster than walking's own
  const rates = m.gait.rates();
  if (limit.startStop !== null && rates) {
    for (const k of ['trunk', 'pelvis'] as const) {
      add(`setting off: ${k} pitch rate (°/s)`, rates.start[k], 'max', limit.startStop * rates.steady[k]);
      add(`stopping: ${k} pitch rate (°/s)`, rates.stop[k], 'max', limit.startStop * rates.steady[k]);
    }
  }
  // coming to rest in a relaxed stance: feet about hip-width apart (heels 0.10–0.15 H), turned
  // out a little, the pair centred under the body sideways and the pelvis over them (a slight
  // asymmetry at most); fore-aft the centre of mass stands over the feet's rear half
  const rest = m.stance.rest;
  if (m.stance.endsStanding && rest) {
    const stance = (what: string, value: number, bound: Check['bound'], lim: number) => add(`at rest: ${what}`, value, bound, lim);
    stance('heels apart (× height)', rest.heels, 'min', 0.1);
    stance('heels apart (× height)', rest.heels, 'max', 0.15);
    stance("feet's midpoint off the CoM sideways (m)", Math.abs(rest.aside), 'max', 0.02);
    stance("pelvis off the feet's midpoint sideways (m)", Math.abs(rest.pelvis), 'max', 0.02);
    stance("feet's midpoint ahead of the CoM (m)", rest.ahead, 'min', 0);
    stance("feet's midpoint ahead of the CoM (m)", rest.ahead, 'max', 0.065);
    for (const a of rest.toeOut) {
      stance('toe-out (°)', a, 'min', 0);
      stance('toe-out (°)', a, 'max', 12);
    }
  }
  // free arms swing as pendulums, setting off too (a runner's swing takes ~0.3 s): never back and forth quicker
  // (no quicker: a half swing of exactly 15 frames is not)
  add('free arm swing: shortest between turns (s)', m.turns.shortest.gap, 'min', 0.25 - 1e-9, m.turns.shortest.t);
  // relaxed arms hang a little out from the side and swing clear of the thighs, never
  // in front of the pelvis (Collins 2009; Meyns 2013)
  const { standing, walking } = m.arms;
  for (const [what, a] of [['standing', standing], ['walking', walking]] as const) {
    if (!a.frames) continue;
    add(`free arms ${what}: hand outside the hip joint (m)`, a.handOut.min, 'min', a.hipHalf);
    add(`free arms ${what}: hand clear of the thigh (m)`, a.clearance.min, 'min', 0);
  }
  if (standing.frames) {
    add('free arms standing: abduction (°)', standing.abduction.min, 'min', 5);
    add('free arms standing: abduction (°)', standing.abduction.max, 'max', 12);
    add('free arms standing: elbow (°)', standing.elbow.max, 'max', 25);
  }
  if (walking.frames) {
    add('free arms walking: forward swing (°)', walking.flexion.max, 'min', 12);
    add('free arms walking: forward swing (°)', walking.flexion.max, 'max', 35);
    add('free arms walking: back swing (°)', walking.flexion.min, 'max', -8);
    add('free arms walking: back swing (°)', walking.flexion.min, 'min', -30);
  }
  // what the body handles keeps out of it (the hands and arms holding or wearing it may touch it)
  if (limit.clearance !== undefined) {
    add('items: frames judged', m.clearance.frames, 'min', 1);
    add('items into the body (m)', m.clearance.depth, 'max', limit.clearance, m.clearance.at, m.clearance.what);
  }
  return out;
}
