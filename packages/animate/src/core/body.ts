import { TimelineRunner, type ReusableTimeline, type TimelineClock } from '@pmndrs/timeline';
import { Pose, type ReadonlyPose } from './pose';
import type { Skeleton } from './skeleton';

/** the longest sub-step (s) */
export const STEP = 1 / 60;

/**
 * What a body's behaviour gets each sub-step: the two last final poses and the pose being
 * written. `current` starts as a copy of `prev`; behaviours write it in the order the timeline
 * steps them, so a later writer wins on the bones it writes. The poses rotate every sub-step:
 * read them from the frame each time, do not keep them.
 */
export interface Frame<W = unknown> {
  /** this sub-step's length (s) */
  dt: number;
  /** the time `current` is posed for (s); the body starts at 0 */
  time: number;
  /** the world the body was made with; throws when it was made without one */
  readonly world: W;
  /** the final pose two sub-steps ago */
  prev2: ReadonlyPose;
  /** the final pose of the last sub-step */
  prev: ReadonlyPose;
  /** this sub-step's pose, as written so far */
  current: Pose;
}

export interface BodyOptions<W> {
  world?: W;
  /** the pose it starts at, still (default the skeleton's rest pose) */
  pose?: ReadonlyPose;
}

/**
 * An articulated body moved by one behaviour timeline. Each sub-step (1/60 s at most) the
 * timeline writes `current`; then its world transforms are brought up to date and it becomes
 * the history: current → prev → prev2.
 */
export class Body<W = unknown> {
  /** after an update: `prev` is the final pose, `prev2` the one before, `dt` the last sub-step */
  readonly frame: Frame<W>;
  /** the poses `frame` shows, as [prev2, prev, current] */
  private poses: [Pose, Pose, Pose];
  private readonly runner: TimelineRunner<Frame<W>>;
  private readonly clock: TimelineClock = { delta: 0, prevDelta: 0, frame: 0 };

  constructor(skeleton: Skeleton, behaviour: ReusableTimeline<Frame<W>>, options: BodyOptions<W> = {}) {
    const start = new Pose(skeleton);
    if (options.pose) start.copy(options.pose);
    start.forward();
    this.poses = [new Pose(skeleton).copy(start), start, new Pose(skeleton).copy(start)];
    const { world } = options;
    this.frame = {
      dt: STEP,
      time: 0,
      get world() {
        if (world === undefined) throw new Error('this body was made without a world');
        return world;
      },
      prev2: this.poses[0],
      prev: this.poses[1],
      current: this.poses[2],
    };
    this.runner = new TimelineRunner(behaviour);
  }

  /** the last final pose */
  get pose(): ReadonlyPose {
    return this.frame.prev;
  }

  /** advances by `dt` (s) in ceil(dt · 60) even sub-steps (at least one; none for 0) */
  update(dt: number): void {
    if (!(dt >= 0 && Number.isFinite(dt))) throw new Error(`cannot update by ${dt} s`);
    if (dt === 0) return;
    // (1e-6: 1/30 · 60 is a hair above 2 in floating point)
    const steps = Math.max(1, Math.ceil(dt / STEP - 1e-6));
    for (let i = 0; i < steps; i++) this.step(dt / steps);
  }

  private step(dt: number): void {
    const { frame, clock } = this;
    const [prev2, prev, current] = this.poses;
    current.copy(prev);
    frame.dt = dt;
    frame.time += dt;
    clock.delta = dt;
    this.runner.step(frame, clock);
    clock.prevDelta = dt;
    clock.frame++;
    current.forward();
    this.poses = [prev, current, prev2];
    [frame.prev2, frame.prev, frame.current] = this.poses;
  }
}
