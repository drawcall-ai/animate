// Scenario statistics and task accuracy: these are regression tests, not runtime invariants.
import { ArmTurns, FreeArms } from './arms';
import { Clearance } from './clearance';
import { FinalStance, Landings } from './body';
import type { Frame } from './frame';
import { leftOf } from './actor';
import { GaitKinematics, RUNNING, type Stride } from './gait';
import { Targets } from './targets';

export interface MetricsOptions {
  strides?: { straight: number; curve: number };
  /** the most a hand is off the grip of what it holds (m) */
  wrist?: number;
  /** setting off and stopping, the most the trunk and the pelvis pitch, against walking's own peak pitch rate (×) */
  startStop: { trunk: number; pelvis: number } | null;
  clearance?: number;
}
const TRACKED = 0.8;
const LATE_RETARGET = 0.03;
/** a gaze target past the eyes' comfortable turn by `PAST` at most this long (s, tuned), and at most this far in the head (°) */
const GAZE = { held: 0.3, eyes: 45 };
/**
 * the most one step's length differs from the next (share of their mean): straight 0.05; on a curve 0.10 — read (Courtine & Schieppati
 * 2003, Eur J Neurosci 18:191, "Human walking along a curved path. II", abstract): the inner and outer strides diverge in length and
 * the two legs move with a 7% phase lag of the cycle, so on a curve one step takes up to ~14% more of the cycle than the next; 0.10 keeps
 * within that (decided 2026-10-21)
 */
const ASYMMETRY = { straight: 0.05, curve: 0.10 };
/** every metric over a run of scenario `id`: `steps` gives each fixed step's frames, one per actor (the feet are every actor's, the rest the first's) */
export function measure(steps: Iterable<readonly Frame[]>) {
  let crossings = 0;
  const landings = new Landings();
  const targets = new Targets();
  const gait = new GaitKinematics();
  const arms = new FreeArms();
  const turns = new ArmTurns();
  const stance = new FinalStance();
  const clearance = new Clearance();
  for (const step of steps) {
    step.forEach((f, i) => {
      if (f.h.joint('leftFoot').sub(f.h.joint('rightFoot')).dot(leftOf(f.h.locomotion.facing)) < 0.02) crossings++;
      landings.see(f);
      if (i > 0) return;
      for (const m of [targets, gait, arms, turns, stance, clearance]) m.see(f);
    });
  }
  return { crossings, landings, targets, gait, arms, turns, stance, clearance };
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

/**
 * A walk's form over its steady strides (`g`, their medians; `run`: running strides, judged by none of these yet), any body's: as
 * measured of people walking at ~1.0–1.6 m/s.
 * - The stance takes ~60–62% of the stride, toe-off at ~60% (read: musculoskeletalkey.com, "Gait Evaluation and Management", stance
 *   ~61%, double support ~10% at each end; Wikipedia, "Bipedal gait cycle", 60%), less as the pace quickens (read: Hebenstreit et al.
 *   2015, Hum Mov Sci 43:118, abstract: −0.3% of the cycle per 0.1 m/s over 0.6–1.7 m/s): 0.57–0.65 here.
 * - The trunk leans forward ~6° walking, more the faster (read: Thorstensson et al. 1984, Acta Physiol Scand 121:9, abstract: the
 *   trunk's mean forward inclination grows from 6° to ~13° with speed, walking 1.0–2.5 m/s and running to 6 m/s): 4–9° here.
 * - The elbow never straightens: ~33° flexed on average, 132–167° inside (13–48° flexed) at the extremes, swinging 21 ± 8° (read:
 *   De Blasiis et al. 2022, J Funct Morphol Kinesiol 7:57, Table 3, at 1.06 m/s; recalled: Murray et al. 1967, 15–30° of swing): 10–50°
 *   flexed, swinging 10–35°.
 * - The pelvis rises and falls 2.7–4.8 cm as the pace goes 0.7–1.6 m/s (read: Orendurff et al. 2004, J Rehabil Res Dev 41:829,
 *   abstract, the centre of mass's; a sacral marker's more, Gard et al. 2004, Hum Mov Sci 22:597, abstract): 2–6 cm here, × the legs'
 *   length (a dynamically similar walk's, at the same Froude number), highest at mid-stance and lowest in double support (recalled).
 */
export function walkingForm(g: Stride, run: boolean): Check[] {
  if (run) return [];
  const out: Check[] = [];
  const add = (what: string, value: number, bound: Check['bound'], limit: number) => void out.push({ what, value, bound, limit });
  add('stance share of the stride', g.duty, 'min', 0.57);
  add('stance share of the stride', g.duty, 'max', 0.65);
  add('trunk forward lean (°)', g.trunkLean, 'min', 4);
  add('trunk forward lean (°)', g.trunkLean, 'max', 9);
  if (!Number.isNaN(g.elbowMin)) {
    add('elbow flexion (°)', g.elbowMin, 'min', 10);
    add('elbow flexion (°)', g.elbowMax, 'max', 50);
    add('elbow swing (°)', g.elbowMax - g.elbowMin, 'min', 10);
    add('elbow swing (°)', g.elbowMax - g.elbowMin, 'max', 35);
  }
  add('pelvis vertical p2p (m, × the legs)', g.pelvisUp / g.legs, 'min', 0.02);
  add('pelvis vertical p2p (m, × the legs)', g.pelvisUp / g.legs, 'max', 0.06);
  // (in phase with the stance, above its mean at mid-stance: the balance legs' lowest comes late in the swing, just before the heel
  // strike, its straight leading leg vaulting the pelvis up after — ~0.4 of the way to its peak at mid-stance on the default body)
  add('pelvis height at mid-stance (+1: its highest)', g.bobPhase, 'min', 0);
  return out;
}

/** Regression assertions shared by scenario tests. */
export function checks(m: Measured, limit: MetricsOptions): Check[] {
  const out: Check[] = [];
  const add = (what: string, value: number, bound: Check['bound'], lim: number, at?: number, where?: string) => void out.push({ what, value, bound, limit: lim, at, where });
  add('late landing retarget (m)', m.landings.late.value, 'max', LATE_RETARGET, m.landings.late.at);
  // stopping and standing, no wide catching steps: the feet land at most as far apart as the step's kind allows (`SLOW_WIDTH`, × height)
  add('slow step width (share of its bound)', m.landings.wide.value, 'max', 1, m.landings.wide.at);
  add('leg-crossing frames', m.crossings, 'max', 0);
  // (what is held or tracked is judged: a head every frame it is asked, the wrists on most frames, out of reach only while walked to)
  if (limit.wrist !== undefined) add('palm off the grip it holds (m)', m.targets.wrist, 'max', limit.wrist, m.targets.wristAt);
  // (a tracked target is judged by its course — held, moving, within reach — not one fixed margin: `Targets.judge`)
  if (m.targets.tracked.judged || m.targets.tracked.head) add(`tracked target past its course's bound (m): ${m.targets.over.what}`, m.targets.over.value, 'max', 0, m.targets.over.at);
  add('tracked wrists: frames judged (share of those asked)', m.targets.tracked.asked ? m.targets.tracked.judged / m.targets.tracked.asked : 1, 'min', TRACKED);
  // (the gaze target past the eyes' comfortable turn by more than 5° only for a moment — at most `GAZE.held` s on end — and never
  // further in the head than the eyes turn at all: brief eccentric eye-in-head positions are normal as the head comes round, within the
  // oculomotor range of ±45–55°, Guitton & Volle 1987, recalled; the time on end tuned, a reach's longest measured 0.18 s)
  add("gaze target beyond the eyes' comfortable turn by 5°: longest (s)", m.targets.pastPeak.value, 'max', GAZE.held, m.targets.pastPeak.at);
  add('gaze target in the head (°)', m.targets.eyesPeak.value, 'max', GAZE.eyes, m.targets.eyesPeak.at);
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
    if (!Number.isNaN(g.headRoll)) gait('head roll (°)', g.headRoll, 'max', 2);
    // smooth: one sway per stride, over the stance foot at mid-stance, no jitter
    gait('chest sway beyond the stride frequency', g.chestResidual, 'max', 0.4);
    // the steps alike: left and right as long, on a curve too
    gait('step length asymmetry', g.stepAsymmetry, 'max', curve ? ASYMMETRY.curve : ASYMMETRY.straight);
    // (jerk over its own sway's — RMS jerk ÷ that of one sinusoid with the stride's peak to peak and period — not a fixed 50 m/s³: jerk
    // grows with the cadence cubed, so a fixed bound fails a quicker or tighter walk of the same shape; tuned 20, above the
    // steady strides' ≤ 15.0 (measured), no motion-capture value read yet)
    gait('chest lateral jerk (× its sway\'s)', g.chestJerkShare, 'max', 20);
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
  // setting off and stopping blend in and out of the walk: no pitch much faster than walking's own (the trunk's lean into the start or
  // the stop on top of it)
  const rates = m.gait.rates(), most = limit.startStop;
  if (most !== null && rates) {
    for (const k of ['trunk', 'pelvis'] as const) {
      add(`setting off: ${k} pitch rate (°/s)`, rates.start[k], 'max', most[k] * rates.steady[k]);
      add(`stopping: ${k} pitch rate (°/s)`, rates.stop[k], 'max', most[k] * rates.steady[k]);
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
    // (fore-aft against the ankle joints, where quiet stance's gravity line is read — ≈ 4–6 cm ahead of them: Winter 1995, Gait Posture
    // 3:193, recalled — never behind them, at most 8 cm ahead)
    stance('CoM ahead of the ankles (m)', rest.overAnkles, 'min', 0);
    stance('CoM ahead of the ankles (m)', rest.overAnkles, 'max', 0.08);
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
    // A short approach may expose only part of a swing before the hands prepare a grab.
    if (walking.cycle) add('free arms walking: forward swing (°)', walking.flexion.max, 'min', 12);
    add('free arms walking: forward swing (°)', walking.flexion.max, 'max', 35);
    if (walking.cycle) add('free arms walking: back swing (°)', walking.flexion.min, 'max', -8);
    add('free arms walking: back swing (°)', walking.flexion.min, 'min', -30);
  }
  // what the body handles keeps out of it (the hands and arms holding or wearing it may touch it)
  if (limit.clearance !== undefined) {
    add('items: frames judged', m.clearance.frames, 'min', 1);
    add('items into the body (m)', m.clearance.depth, 'max', limit.clearance, m.clearance.at, m.clearance.what);
  }
  return out;
}
