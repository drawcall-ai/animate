/** A motion check gone wrong in a sub-step, or a misuse noted: what was checked, what was seen and what is allowed (in the check's units), and where. */
export interface Problem {
  check: string;
  value: number;
  limit: number;
  /** the bone, thing or other place the problem is at */
  where: string;
}

/**
 * One row of a body's log: one check at one place while one set of verbs ran. A row says a sub-step of motion broke a limit set as a guard
 * against visible faults, not that a verb failed (those throw `Missed`): a `worst` marginally over `limit` for a few sub-steps (`count`) is
 * rarely visible, so judge it by eye and move on; one well over, or for many sub-steps, is usually a story asking too much of that part
 * (`beat` says which verb): ask less, or more slowly.
 */
export interface LogEntry extends Omit<Problem, 'value'> {
  /** its worst value, in the check's units */
  worst: number;
  /** how many sub-steps it went wrong in */
  count: number;
  /** when it first went wrong (the body's time, s) */
  time: number;
  /** the verbs running then, each with where the story asked for it */
  beat?: string;
}

/** One body's development log. Absent entirely when dev is off. */
export class Dev {
  readonly log: LogEntry[] = [];
  /** the requests running, as the log names them */
  beat?: string;
  private readonly rows = new Map<string, LogEntry>();

  append(time: number, { check, value, limit, where }: Problem): void {
    const key = `${check}\n${where}\n${this.beat ?? ''}`, row = this.rows.get(key);
    if (!row) {
      const made: LogEntry = { check, where, worst: value, limit, count: 1, time, ...(this.beat === undefined ? {} : { beat: this.beat }) };
      this.rows.set(key, made);
      this.log.push(made);
      return;
    }
    row.count++;
    if (Math.abs(value - limit) > Math.abs(row.worst - row.limit)) Object.assign(row, { worst: value, limit });
  }
}

/** how far off its floor (m) a height asked of where a body stands may be unsaid: a height off it is ignored */
export const OFF_FLOOR = 0.01;
