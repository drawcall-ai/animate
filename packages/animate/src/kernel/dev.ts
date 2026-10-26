/** A development problem: what was checked, what was seen and what is allowed (in the check's units), and where. */
export interface Problem {
  /** what was expected, and its units */
  check: string;
  /** what was seen */
  value: number;
  /** what is allowed */
  limit: number;
  /** the bone, thing or other place the problem is at */
  where: string;
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

  constructor(private readonly noting = false) {}

  append(time: number, problem: Problem): void {
    this.log.push({ ...problem, time, ...(this.beat === undefined ? {} : { beat: this.beat }) });
  }

  note(time: number, problem: Problem): void {
    if (!this.noting) return;
    this.notes.push({ ...problem, time, ...(this.beat === undefined ? {} : { beat: this.beat }) });
  }
}
