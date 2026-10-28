/** A development problem: what was checked, what was seen and what is allowed (in the check's units), and where. */
export interface Problem {
  check: string;
  value: number;
  limit: number;
  /** the bone, thing or other place the problem is at */
  where: string;
  /** what was seen, said for a reader: what limited it and by how much (a check is matched by `check` and `where`, not this) */
  detail?: string;
}

/** A problem in a body's log: when it was seen (the body's time, s), and the requests running then. */
export interface LogEntry extends Problem {
  time: number;
  beat?: string;
}

/** One body's development log. Absent entirely when dev is off. */
export class Dev {
  readonly log: LogEntry[] = [];
  /** Bounds a body only reports (a driven body's balance): measured, never failures; recorded only when asked for. */
  readonly notes: LogEntry[] = [];
  /** the requests running, as the log names them */
  beat?: string;

  /** the checks said `once` so far */
  private readonly said = new Set<string>();

  constructor(private readonly noting = false) {}

  /** a problem said the first time its check is seen, not again: one that stays as it was asked (a height the floor ignores) */
  once(time: number, problem: Problem): void {
    if (this.said.has(problem.check)) return;
    this.said.add(problem.check);
    this.append(time, problem);
  }

  append(time: number, problem: Problem): void {
    this.log.push({ ...problem, time, ...(this.beat === undefined ? {} : { beat: this.beat }) });
  }

  note(time: number, problem: Problem): void {
    if (!this.noting) return;
    this.notes.push({ ...problem, time, ...(this.beat === undefined ? {} : { beat: this.beat }) });
  }
}

/** how far off the floor (m) a height asked of where a body stands may be unsaid: the floor is the plane y = 0, a height off it ignored */
export const OFF_FLOOR = 0.01;
