import { Vector3 } from 'three';
import type { Stepper } from './legs/stepper';
import { TimelineRunner, type ReusableTimeline, type TimelineClock } from '@pmndrs/timeline';
import { Pose, type ReadonlyPose } from './pose';
import type { Skeleton } from './skeleton';
import { Dev, type LogEntry } from './dev';
import { checkLimits } from './limits';
import { SnapChecks } from './rotation';
import { dress, load, moveWorn, type Bearing, type Dressed, type Wearing } from './worn';
import type { Item } from './carrier';
import { createAsks, type Asks } from './asks';
import { createLocomotion, type Locomotion } from './legs/gait';
import type { Gazer } from './gaze';
import { yawOf } from './math';

/** the sub-step (s): fixed, so that what behaviours read off the history (velocities) does not depend on the frame rate */
export const STEP = 1 / 60;

/**
 * What a body's behaviour gets each sub-step: the two last final poses and the pose being
 * written. `current` starts as a copy of `prev`; behaviours write it in the order the timeline
 * steps them, so a later writer wins on the bones it writes. The poses rotate every sub-step:
 * read them from the frame each time, do not keep them.
 */
export interface Frame<W = unknown> {
  /** the sub-step's length (s): always `STEP` */
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
  readonly dev?: Dev;
  /** Active named contributions, also recorded with dev off. */
  readonly beats: Set<string>;
}

export interface BodyOptions<W> {
  world?: W;
  /** Scale applied only to placements in bone frames. */
  scale?: number;
  /** Checks final poses and records problems; default off. */
  dev?: boolean;
  /** the pose it starts at, still (default the skeleton's rest pose) */
  pose?: ReadonlyPose;
  /** what it wears from the start: worn and borne from the first sub-step, each piece where it sits on its bone */
  wearing?: readonly Dressed[];
  /** its hands, by name, each the bone it holds with; and how they keep to what they hold, every sub-step after the worn items move */
  hands?: { bones: Readonly<Record<string, number>>; hold: (body: Body<W>) => (f: Frame<W>) => void };
  /** its neck and eyes, for `lookAt` */
  gazer?: Gazer;
}

/**
 * An articulated body moved by one behaviour timeline. Each sub-step of `STEP` the timeline
 * writes `current`; then the items it wears move with it, its hands keep to what they hold, the
 * weight it bears loads its bones, and its world transforms are brought up to date and it becomes
 * the history: current → prev → prev2. Updates run as many whole sub-steps as the time they bring
 * covers and carry the rest over; the body shows its last final pose.
 */
export class Body<W = unknown> {
  /** after an update: `prev` is the final pose, `prev2` the one before, `dt` the last sub-step */
  readonly frame: Frame<W>;
  /** what it wears, each item and what it is worn on (`wear`, `takeOff`: change it through them) */
  readonly worn = new Map<Item, Wearing>();
  /** how much of each item's weight it bears, held off its support or worn (taken up and given up over a moment), as its centre of mass counts it */
  readonly borne = new Map<Item, Bearing>();
  /** its hands' bones, by name (`BodyOptions.hands`) */
  readonly hands: Readonly<Record<string, number>>;
  /** what each hand holds, by which grip (`closeHand`, `openHand`) */
  readonly holding: Record<string, { item: Item; grip: string } | null>;
  /** what the tasks ask of its legs (see `Asks`) */
  readonly asks: Asks = createAsks();
  /** its walk, as the legs report it; walkTo publishes its arrival estimate there */
  readonly locomotion: Locomotion;
  readonly gazer?: Gazer;
  /** the stepper keeping its legs under a root the scene drives, if any: ask it to `jump`, read whether it is `airborne` */
  stepper: Stepper | null = null;
  readonly scale: number;
  /** the poses `frame` shows, as [prev2, prev, current] */
  private poses: [Pose, Pose, Pose];
  private readonly behaviour: ReusableTimeline<Frame<W>>;
  /** made on the first update: a behaviour may read the body (its pose) as it sets out */
  private runner: TimelineRunner<Frame<W>> | null = null;
  private readonly clock: TimelineClock = { delta: 0, prevDelta: 0, frame: 0 };
  /** the time updates have brought that no sub-step has taken yet (s) */
  private pending = 0;
  private readonly snaps = new SnapChecks();
  private readonly hold: ((f: Frame<W>) => void) | null;

  constructor(skeleton: Skeleton, behaviour: ReusableTimeline<Frame<W>>, options: BodyOptions<W> = {}) {
    this.scale = options.scale ?? 1;
    this.gazer = options.gazer;
    const start = new Pose(skeleton);
    if (options.pose) start.copy(options.pose);
    start.forward();
    this.locomotion = createLocomotion(yawOf(start.local(0)));
    this.hands = options.hands?.bones ?? {};
    this.holding = Object.fromEntries(Object.keys(this.hands).map((hand) => [hand, null]));
    dress(this, start, options.wearing ?? []);
    this.hold = options.hands?.hold(this) ?? null;
    this.poses = [new Pose(skeleton).copy(start), start, new Pose(skeleton).copy(start)];
    const { world } = options;
    this.frame = {
      dev: options.dev ? new Dev() : undefined,
      beats: new Set(),
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
    this.behaviour = behaviour;
  }

  /** Development problems; empty when dev is off. */
  get log(): readonly LogEntry[] { return this.frame.dev?.log ?? EMPTY_LOG; }

  /** Development measurements that are reported, not failures; empty when dev is off. */
  get notes(): readonly LogEntry[] { return this.frame.dev?.notes ?? EMPTY_LOG; }

  /** the last final pose */
  get pose(): ReadonlyPose {
    return this.frame.prev;
  }

  /** its ground velocity over the last sub-step: its centre of mass's, horizontal (m/s) */
  get velocity(): Vector3 {
    const { prev, prev2, dt } = this.frame;
    return prev.com(new Vector3()).sub(prev2.com(new Vector3())).divideScalar(dt).setY(0);
  }

  /** its facing about +Y (0 faces +Z): the root's */
  get yaw(): number {
    return yawOf(this.pose.local(0));
  }

  /** a copy of the last final pose, as other bodies read it */
  snapshot(): Pose {
    return new Pose(this.pose.skeleton).copy(this.pose);
  }

  /** advances by `dt` (s): every whole `STEP` it covers, with what earlier updates left over */
  update(dt: number): void {
    if (!(dt >= 0 && Number.isFinite(dt))) throw new Error(`cannot update by ${dt} s`);
    this.pending += dt;
    // (1e-9: 1/30 is a hair under two sub-steps of 1/60 in floating point)
    const steps = Math.floor(this.pending / STEP + 1e-9);
    this.pending = Math.max(0, this.pending - steps * STEP);
    try {
      for (let i = 0; i < steps; i++) this.step();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`${this.frame.time.toFixed(3)} s, "${[...this.frame.beats].join(' ∥ ')}": ${message}`, { cause });
    }
  }

  private step(): void {
    const dt = STEP;
    const { frame, clock } = this;
    const [prev2, prev, current] = this.poses;
    current.copy(prev);
    frame.dt = dt;
    if (frame.dev && frame.time > 0) {
      checkLimits(frame.prev, frame.dev, frame.time);
      this.snaps.check(frame, frame.dev);
    }
    frame.beats.clear();
    frame.time += dt;
    clock.delta = dt;
    (this.runner ??= new TimelineRunner(this.behaviour)).step(frame, clock);
    if (frame.dev) frame.dev.beat = frame.beats.size ? [...frame.beats].join(' ∥ ') : undefined;
    moveWorn(this, frame);
    this.hold?.(frame);
    load(this, frame);
    clock.prevDelta = dt;
    clock.frame++;
    current.forward();
    this.poses = [prev, current, prev2];
    [frame.prev2, frame.prev, frame.current] = this.poses;
  }
}

const EMPTY_LOG: readonly LogEntry[] = Object.freeze([]);
