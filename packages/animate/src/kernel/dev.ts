/** A motion check gone wrong in a sub-step, or a misuse noted: what was checked, what was seen and what is allowed (in the check's units), and where. */
export interface Problem {
  check: string;
  value: number;
  limit: number;
  /** the bone, thing or other place the problem is at */
  where: string;
  /** what was seen, said for a reader: what limited it and by how much (a check is matched by `check` and `where`, not this) */
  detail?: string;
}

/** One row of a body's log: one check while one set of verbs ran, however many sub-steps it went wrong in. */
export interface LogEntry {
  check: string;
  /** where it was worst (a bone, a foot) */
  where: string;
  /** its worst value, in the check's units */
  worst: number;
  limit: number;
  /** how many sub-steps it went wrong in */
  count: number;
  /** when it first went wrong (the body's time, s) */
  time: number;
  /** the verbs running then, each with where the story asked for it */
  beat?: string;
  detail?: string;
}

/** One body's development log. Absent entirely when dev is off. */
export class Dev {
  readonly log: LogEntry[] = [];
  /** the requests running, as the log names them */
  beat?: string;
  private readonly rows = new Map<string, LogEntry>();

  append(time: number, { check, value, limit, where, detail }: Problem): void {
    const key = `${check}\n${this.beat ?? ''}`, row = this.rows.get(key);
    if (!row) {
      const made: LogEntry = { check, where, worst: value, limit, count: 1, time, ...(this.beat === undefined ? {} : { beat: this.beat }), ...(detail === undefined ? {} : { detail }) };
      this.rows.set(key, made);
      this.log.push(made);
      return;
    }
    row.count++;
    if (Math.abs(value - limit) <= Math.abs(row.worst - row.limit)) return;
    Object.assign(row, { worst: value, where, limit, detail });
  }
}

/** how far off its floor (m) a height asked of where a body stands may be unsaid: a height off it is ignored */
export const OFF_FLOOR = 0.01;
