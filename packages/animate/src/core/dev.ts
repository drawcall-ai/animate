import { action } from '@pmndrs/timeline';
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
export type WatchFrame<W = unknown> = Readonly<Omit<Frame<W>, 'current' | 'dev' | 'beats'>>;

/** One body's development log. Absent entirely when dev is off. */
export class Dev {
  readonly log: LogEntry[] = [];
  beat?: string;

  append(time: number, problem: Problem): void {
    this.log.push({ ...problem, time, ...(this.beat === undefined ? {} : { beat: this.beat }) });
  }
}

/** Labels a behaviour's contributions to each final pose (parallel labels are joined). */
export function named<W>(label: string, behaviour: Behaviour<W>): Behaviour<W> {
  return function* () {
    const context: { frame?: Frame<W> } = {};
    // Receive the frame before starting the generator: even an immediate throw has a beat.
    yield (f) => { context.frame = f; return 'skipped'; };
    try {
      for (const step of behaviour()) {
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
export function watch<W>(label: string, read: (f: WatchFrame<W>) => Problem | null): Behaviour<W> {
  return function* () {
    yield* action<Frame<W>>({ update: (f) => {
      if (!f.dev || f.time <= f.dt) return;
      const { dt, time, prev2, prev } = f;
      const problem = read({ dt, time: time - dt, get world() { return f.world; }, prev2, prev });
      if (problem) f.dev.append(time - dt, { ...problem, check: `${label}: ${problem.check}` });
    } });
  };
}
