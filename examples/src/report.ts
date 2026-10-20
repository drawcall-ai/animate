import { action, parallel } from '@pmndrs/timeline';
import { live, type Behaviour, type Frame, type Live } from '@drawcall/animate';

/** What a script asked of its actor, as the metrics read it: each goal by name, with the time it was last asked for. */
export class Report {
  readonly asked = new Map<string, { time: number; value: unknown }>();

  /** the goals asked for at time `t` (s): asked this sub-step */
  at(t: number): Map<string, unknown> {
    const out = new Map<string, unknown>();
    for (const [name, a] of this.asked) if (Math.abs(a.time - t) < 1e-6) out.set(name, a.value);
    return out;
  }
}

/** `goal`, reported to `report` as `name` every time a behaviour reads it */
export function reported<T>(report: Report, name: string, goal: Live<T>): (f: Frame) => T {
  return (f) => {
    const value = live(goal, f);
    report.asked.set(name, { time: f.time, value });
    return value;
  };
}

/** `behaviour`, reported to `report` as asking for each of `names` every sub-step it runs (a goal that is not a value: the hands taking hold of something) */
export function reporting(report: Report, names: readonly string[], behaviour: Behaviour): Behaviour {
  return function* () {
    yield* parallel<Frame>(
      'race',
      behaviour,
      action<Frame>({ update: (f) => names.forEach((name) => report.asked.set(name, { time: f.time, value: true })) }),
    );
  };
}
