import { action } from '@pmndrs/timeline';
import type { Frame } from './body';
import type { Behaviour } from './goal';

export interface Problem {
  check: string;
  value: number;
  limit: number;
  where: string;
  severity?: 'error' | 'warning';
}

export interface LogEntry extends Problem {
  time: number;
  beat: string;
  severity: 'error' | 'warning';
}

/** Watchers read the last final poses; they cannot write this step's pose. */
export type WatchFrame<W = unknown> = Readonly<Omit<Frame<W>, 'current' | 'dev'>>;

/** One body's development log. Absent entirely when dev is off. */
export class Dev {
  readonly log: LogEntry[] = [];
  readonly beats = new Set<string>();
  beat = '';

  append(time: number, problem: Problem): void {
    this.log.push({ ...problem, severity: problem.severity ?? 'error', time, beat: this.beat });
  }
}

/** Labels a behaviour's contributions to each final pose (parallel labels are joined). */
export function named<W>(label: string, behaviour: Behaviour<W>): Behaviour<W> {
  return function* () {
    for (const step of behaviour()) {
      yield (f, clock) => {
        const status = step(f, clock);
        if (status !== 'skipped') f.dev?.beats.add(label);
        return status;
      };
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
