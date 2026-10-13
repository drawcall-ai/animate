/** The hints in force: what the behaviours asked of each other last sub-step, merged. */
export interface Hinted {
  /** how far the pelvis is lowered below the stance's height (m): the deepest asked */
  crouch: number;
  /** the body's facing (rad about +Y, 0 facing +Z): the most urgent asked; none, as the feet stand */
  facing: number | null;
  /** how far free arms swing, as a share of their own swing: the least asked */
  armSwing: number;
  /** how far the pelvis tips forward, the trunk bending at the hips (rad): the deepest asked */
  stoop: number;
}

const none = (): Hinted => ({ crouch: 0, facing: null, armSwing: 1, stoop: 0 });

/**
 * How behaviours ask things of each other that are not proposals to the body: a crouch, a
 * facing, stiller arms. Double-buffered: what is asked in one sub-step is read, merged by each
 * kind's rule, in the next, whatever order the behaviours run in. A sub-step is told by the
 * body's time.
 */
export class Hints {
  private at = 0;
  private hinted = none();
  private asked = none();
  /** the facing asked so far this sub-step: its priority and weight */
  private facingBy = { priority: -Infinity, weight: 0 };

  /** the hints in force at `time` (s): those asked in the sub-step before */
  read(time: number): Readonly<Hinted> {
    this.turn(time);
    return this.hinted;
  }

  /** the hints in force as of the last sub-step anything was asked or read in */
  get last(): Readonly<Hinted> {
    return this.hinted;
  }

  crouch(time: number, depth: number) {
    this.turn(time);
    this.asked.crouch = Math.max(this.asked.crouch, depth);
  }

  /** the body facing `yaw`, asked with `priority` (the highest wins, a tie by the larger `weight`) */
  facing(time: number, yaw: number, priority: number, weight = 1) {
    this.turn(time);
    const by = this.facingBy;
    if (priority < by.priority || (priority === by.priority && weight <= by.weight)) return;
    this.asked.facing = yaw;
    by.priority = priority;
    by.weight = weight;
  }

  armSwing(time: number, share: number) {
    this.turn(time);
    this.asked.armSwing = Math.min(this.asked.armSwing, share);
  }

  stoop(time: number, angle: number) {
    this.turn(time);
    this.asked.stoop = Math.max(this.asked.stoop, angle);
  }

  /** a new sub-step: what was asked comes into force */
  private turn(time: number) {
    if (time === this.at) return;
    if (time < this.at) throw new Error(`hints at ${time} s, after ${this.at} s`);
    this.at = time;
    [this.hinted, this.asked] = [this.asked, this.hinted];
    Object.assign(this.asked, none());
    this.facingBy = { priority: -Infinity, weight: 0 };
  }
}
