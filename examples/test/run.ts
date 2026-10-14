import { DEFAULT_HEIGHT } from '@drawcall/animate';
import { FIXED_DT, type Scenario } from '../src/scenario';
import { Simulation } from '../src/simulation';
import { beats, label, running, type Beat } from './beats';
import { flowChecks, type FlowReport } from './flow';
import type { Frame } from './frame';
import { checks, limitsFor, measure, type Check, type Limits, type Measured } from './judge';

/** each fixed step's frames of a run `sim` (OpenPose models, read without rendering); the beats' clock at the sub-step about to run */
export function* steps(sim: Simulation): Generator<Frame[]> {
  while (sim.t < sim.scenario.duration) {
    beats.t = sim.t + FIXED_DT;
    sim.step();
    const asked = sim.stage.report.at(sim.t);
    const solids = sim.stage.solids?.() ?? [];
    yield sim.actors.map((h) => ({ t: sim.t, h, asked, solids }));
  }
}

/** a run of a scenario judged: what it measured, every check (the flow's too, and whether it did what it is for), its flow and beats */
export interface Run {
  scenario: Scenario;
  m: Measured;
  checks: Check[];
  flow: FlowReport;
  beats: Beat[];
  /** whether its limits are its own (else the universal defaults) */
  own: boolean;
  /** whether it did what it is for */
  done: boolean;
}

/** runs `sc` and judges it (`adjust`: over its limits) */
export function run(sc: Scenario, adjust: Partial<Limits> = {}): Run {
  beats.log = [];
  const sim = new Simulation(sc);
  const m = measure(sc.id, steps(sim));
  const log = beats.log;
  const { limits, own } = limitsFor(sc.id, m);
  // (the flow over the span the tasks run in: from the first's start to the last's end, the run's end for one that never ends)
  const tasks = log.filter((b) => b.task !== 'idle');
  const from = tasks.length ? Math.min(...tasks.map((b) => b.start)) : 0;
  const to = tasks.length ? Math.max(...tasks.map((b) => b.end ?? sc.duration)) : sc.duration;
  // (the hands at work: a task that moves them running; without beats, always)
  const working = (t: number) => !tasks.length || running(log, t).some((b) => HANDS.has(b.task));
  const flow = m.flow.report(from, to, working);
  const done = sim.stage.done();
  const did: Check = { what: 'done: the scenario did what it is for', value: Number(done), bound: 'is', limit: 1, at: sim.t, fix: "a task never finished (its condition is never met) or `duration` is too short; `done()` is asked at the end" };
  return { scenario: sc, m, checks: [did, ...checks(m, { ...limits, ...adjust }), ...flowChecks(flow)], flow, beats: log, own, done };
}

/** the tasks that move the hands */
const HANDS = new Set(['grab', 'reachFor', 'handTo', 'carry', 'hold', 'release', 'wear', 'takeOff']);

/** a seeded variation of `sc`: each actor starting up to 10 cm off, turned up to 0.15 rad and up to 4% taller or shorter — what no script may hang on */
export function vary(sc: Scenario, seed: number): Scenario {
  const random = mulberry32(seed);
  const jitter = (range: number) => (random() * 2 - 1) * range;
  return {
    ...sc,
    actors: sc.actors.map((r) => ({
      position: { x: (r.position?.x ?? 0) + jitter(0.1), z: (r.position?.z ?? 0) + jitter(0.1) },
      yaw: (r.yaw ?? 0) + jitter(0.15),
      height: (r.height ?? DEFAULT_HEIGHT) * (1 + jitter(0.04)),
    })),
  };
}

/** the beats running at `t`, as a short label: the latest started two */
export function beatAt(log: readonly Beat[], t: number | undefined): string {
  if (t === undefined) return '';
  return running(log, t).slice(0, 2).map(label).join(' ∥ ');
}

/** a small seeded generator of uniform numbers in [0, 1) */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
