import { action, type NonReuseableTimeline } from '@pmndrs/timeline';
import type { Frame } from './body';
import type { Behaviour } from './goal';

export interface Problem {
  /** Name of the expectation that failed. */
  check: string;
  /** Observed quantity, in the units named by the check. */
  value: number;
  /** Allowed bound in the same units as value. */
  limit: number;
  /** Bone, item or other scene location of the problem. */
  where: string;
}

export interface LogEntry extends Problem {
  time: number;
  beat?: string;
}

/** Watchers read the last final poses; they cannot write this step's pose. */
export type WatchFrame = Readonly<Omit<Frame, 'current' | 'dev' | 'beats'>>;

/** One body's development log. Absent entirely when dev is off. */
export class Dev {
  readonly log: LogEntry[] = [];
  /** Bounds a body only reports (a driven body's balance): measured, never failures; recorded only when asked for. */
  readonly notes: LogEntry[] = [];
  beat?: string;

  constructor(private readonly noting = false) {}

  append(time: number, problem: Problem): void {
    this.log.push({ ...problem, time, ...(this.beat === undefined ? {} : { beat: this.beat }) });
  }

  note(time: number, problem: Problem): void {
    if (!this.noting) return;
    this.notes.push({ ...problem, time, ...(this.beat === undefined ? {} : { beat: this.beat }) });
  }
}

/** a problem in the dev log, once: the body then stands where it is, asking nothing more — what a verb does for a goal it can never get to */
export function problemOnce(problem: Problem): Behaviour {
  return function* () {
    let logged = false;
    yield* action<Frame>({ update: (f) => { if (!logged) f.dev?.append(f.time, problem); logged = true; } });
  };
}

/** Labels a behaviour's contributions to each final pose (parallel labels are joined): a behaviour, or a timeline already made
 * (`parallel(…)`, which then runs once). */
export function named(label: string, behaviour: Behaviour | NonReuseableTimeline<Frame>): Behaviour {
  return function* () {
    const context: { frame?: Frame } = {};
    // Receive the frame before starting the generator: even an immediate throw has a beat.
    yield (f) => { context.frame = f; return 'skipped'; };
    try {
      for (const step of typeof behaviour === 'function' ? behaviour() : behaviour) {
        yield (f, clock) => {
          f.beats.add(label);
          const status = step(f, clock);
          if (status === 'skipped') f.beats.delete(label);
          return status;
        };
      }
    } catch (cause) {
      context.frame?.beats.add(label);
      throw cause;
    }
  };
}

/** A read-only expectation, composed in parallel with the story; dev off never calls read. */
export function watch(label: string, read: (f: WatchFrame) => Problem | null): Behaviour {
  return function* () {
    yield* action<Frame>({ update: (f) => {
      if (!f.dev || f.time <= f.dt) return;
      const { dt, time, prev2, prev } = f;
      const problem = read({ dt, time: time - dt, get world() { return f.world; }, prev2, prev });
      if (problem) f.dev.append(time - dt, { ...problem, check: `${label}: ${problem.check}` });
    } });
  };
}
