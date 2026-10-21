import { Quaternion, Vector3 } from 'three';
import type { Stepper } from './legs/stepper';
import { parallel, TimelineRunner, type ReusableTimeline, type TimelineClock } from '@pmndrs/timeline';
import { Pose, type ReadonlyPose } from './pose';
import type { Attention, Species } from './species';
import type { Stance } from './asks';
import type { DrivenRoot } from './legs/stepper';
import type { Behaviour, Live } from './goal';
import type { Proportions } from '../humanoid/proportions';
import { creature } from './legs/creature';
import { Dev, type LogEntry } from './dev';
import { checkLimits } from './limits';
import { SnapChecks } from './rotation';
import { dress, load, moveWorn, weld, type Bearing, type Dressed, type Wearing } from './worn';
import type { Item } from './carrier';
import { createAsks, type Asks } from './asks';
import { createLocomotion, type Locomotion } from './legs/gait';
import type { Gazer } from './gaze';
import { yawOf } from './math';
import { World } from './world';

/** the sub-step (s): fixed, so that what behaviours read off the history (velocities) does not depend on the frame rate */
export const STEP = 1 / 60;

/**
 * What a body's behaviour gets each sub-step: the two last final poses and the pose being
 * written. `current` starts as a copy of `prev`; behaviours write it in the order the timeline
 * steps them, so a later writer wins on the bones it writes. The poses rotate every sub-step:
 * read them from the frame each time, do not keep them.
 */
export interface Frame {
  /** the sub-step's length (s): always 1/60 */
  dt: number;
  /** the time `current` is posed for (s); the body starts at 0 */
  time: number;
  /** the world the body is in (`World.add`); alone, a world of none */
  readonly world: World;
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

/**
 * How a body stands and moves when its story asks nothing of it (its base: a person's balance, arms and glances; a creature's legs and
 * carriage): its stance and the seed of its idle variation (a person's), what it heeds (a creature's), or a `root` the scene drives.
 */
export interface IdleOptions {
  /** a person's stance */
  stance?: Partial<Stance>;
  /** fixes a person's idle variation (sway, breathing, weight shifts, glances) */
  seed?: number;
  /** a creature's tether and startles */
  attention?: Attention;
  /** the scene owns the root (a player's): the legs keep up with it */
  root?: Live<DrivenRoot>;
}

export interface BodyOptions {
  /** where it stands (on the floor, y = 0; default the origin) */
  at?: { x: number; z: number };
  /** its facing about +Y (0 faces +Z) */
  yaw?: number;
  /** its base under the story, tuned (`IdleOptions`); `false`: none, the story poses it all */
  idle?: IdleOptions | false;
  /** its size against the body its distances were tuned for (default the species', `Species.scale`): placements in its bones' frames scale with it */
  scale?: number;
  /** Checks final poses and records problems in `log`; default off. `{ notes: true }` also records `notes`: measurements a body only
   * reports, never failures — a player-driven body's extrapolated centre of mass outside its feet (the player, not its balance, decides
   * where it goes) */
  dev?: boolean | { notes?: boolean };
  /** the pose it starts at, still (default the skeleton's rest pose) */
  pose?: ReadonlyPose;
  /** what it wears from the start: worn and borne from the first sub-step, each piece where it sits on its bone (a person's may be placed for its proportions) */
  wearing?: readonly Dressed[] | ((proportions: Proportions) => readonly Dressed[]);
  /** how its hands keep to what they hold, every sub-step after the worn items move (default: each item stays where it was on its hand when taken) */
  hold?: (body: Body) => (f: Frame) => void;
}

/**
 * A body of a species, moved by its story (`story(body)`, run once it is made; none: it only idles) over its base (`IdleOptions`: it stands and walks, looks
 * about, keeps its arms as the species does), standing `at` facing `yaw`; `done` once the story has ended (the base goes on). A person
 * (`human()`) is a body like any other. Each 1/60 s sub-step the base and the story write `current`; then the items it wears move with it, its hands keep to what they hold, the
 * weight it bears loads its bones, and its world transforms are brought up to date and it becomes
 * the history: current → prev → prev2. Updates run as many whole sub-steps as the time they bring
 * covers and carry the rest over; the body shows its last final pose.
 */
export class Body<H extends string = string> {
  /** after an update: `prev` is the final pose, `prev2` the one before, `dt` the last sub-step */
  declare readonly frame: Frame;
  /** what it wears, each item and what it is worn on (`wear`, `takeOff`: change it through them) */
  readonly worn = new Map<Item, Wearing>();
  /** how much of each item's weight it bears, held off its support or worn (taken up and given up over a moment), as its centre of mass counts it */
  readonly borne = new Map<Item, Bearing>();
  /** its hands' bones, by name: the tips of their chains (`Species.hands`) */
  declare readonly hands: Readonly<Record<H, number>>;
  /** what each hand holds, by which grip */
  declare readonly holding: Record<H, { item: Item; grip: string } | null>;
  /** what the tasks ask of its legs (see `Asks`) */
  readonly asks: Asks = createAsks();
  /** its walk, as the legs report it; walkTo publishes its arrival estimate there */
  declare readonly locomotion: Locomotion;
  /** its neck and eyes (`Species.gaze`) */
  readonly gazer?: Gazer;
  /** the stepper keeping its legs under a root the scene drives, if any: ask it to `jump`, read whether it is `airborne` */
  stepper: Stepper | null = null;
  /** whether its story has ended */
  done = false;
  declare readonly scale: number;
  /** the poses `frame` shows, as [prev2, prev, current] */
  private declare poses: [Pose, Pose, Pose];
  private declare behaviour: ReusableTimeline<Frame>;
  /** made on the first update: a behaviour may read the body (its pose) as it sets out */
  private runner: TimelineRunner<Frame> | null = null;
  private readonly clock: TimelineClock = { delta: 0, prevDelta: 0, frame: 0 };
  /** the time updates have brought that no sub-step has taken yet (s) */
  private pending = 0;
  private readonly snaps = new SnapChecks();
  private declare readonly hold: (f: Frame) => void;
  /** the world it joined; until then one of its own, empty */
  private world: World | null = null;
  private alone: World | null = null;

  constructor(readonly species: Species<H>, story: (body: Body<H>) => Behaviour = NOTHING, options: BodyOptions = {}) {
    // (a person is made as the person it is)
    if (species.person && new.target === Body) return species.person.embody(story, options);
    const { skeleton } = species;
    this.scale = options.scale ?? species.scale ?? 1;
    this.gazer = species.gaze;
    const start = new Pose(skeleton);
    if (options.pose) start.copy(options.pose);
    else if (options.at || options.yaw !== undefined) {
      const root = start.position(0);
      start.setRoot(new Vector3(options.at?.x ?? root.x, root.y, options.at?.z ?? root.z));
      start.setLocal(0, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), options.yaw ?? 0).multiply(start.local(0)));
    }
    start.forward();
    this.locomotion = createLocomotion(yawOf(start.local(0)));
    this.hands = Object.fromEntries(Object.entries<string>(species.hands ?? {}).map(([hand, chain]) => [hand, skeleton.chain(chain).slice(-1)[0]])) as Record<H, number>;
    this.holding = Object.fromEntries(Object.keys(this.hands).map((hand) => [hand, null])) as Record<H, null>;
    const wearing = options.wearing;
    if (typeof wearing === 'function' && !this.proportions) throw new Error('a body other than a person wears what it is given, not what is placed for proportions');
    dress(this, start, typeof wearing === 'function' ? wearing(this.proportions!) : wearing ?? []);
    this.hold = (options.hold ?? weld)(this);
    this.poses = [new Pose(skeleton).copy(start), start, new Pose(skeleton).copy(start)];
    const body = this;
    this.frame = {
      dev: options.dev ? new Dev(typeof options.dev === 'object' && !!options.dev.notes) : undefined,
      beats: new Set(),
      dt: STEP,
      time: 0,
      get world() {
        return body.world ?? (body.alone ??= new World());
      },
      prev2: this.poses[0],
      prev: this.poses[1],
      current: this.poses[2],
    };
    this.story = story;
    this.idling = options.idle;
    if (new.target === Body) this.begin();
  }

  /** its story and its base, made once the body is (a subclass calls it last in its constructor) */
  protected begin(): void {
    const body = this, idling = this.idling, made = this.story(this), base = idling === false ? null : this.base(idling ?? {});
    const tasks = function* () { yield* made(); body.done = true; };
    this.behaviour = base ? () => parallel<Frame>('all', base, tasks) : tasks;
  }
  private declare readonly story: (body: Body<H>) => Behaviour;
  private declare readonly idling: IdleOptions | false | undefined;

  /** a person's measures (`human()`); none for other bodies */
  get proportions(): Proportions | undefined { return undefined; }

  /** its base under the story: a creature's legs and carriage (or where `root` drives it); a body without legs has none */
  protected base(options: IdleOptions): Behaviour | null {
    return this.species.legs ? creature(this, options.attention, options.root) : null;
  }

  /** Development problems; empty when dev is off. */
  get log(): readonly LogEntry[] { return this.frame.dev?.log ?? EMPTY_LOG; }

  /** Development measurements that are reported, not failures (`BodyOptions.dev`); empty unless asked for. */
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

  /** in `world` from now on (`World.add`: join through it) */
  join(world: World): void {
    if (this.world) throw new Error('a body is in one world');
    this.world = world;
  }

  /** advances by `dt` (s): every whole 1/60 s sub-step it covers, with what earlier updates left over */
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
    for (const item of this.worn.keys()) item.due(frame.time);
    (this.runner ??= new TimelineRunner(this.behaviour)).step(frame, clock);
    if (frame.dev) frame.dev.beat = frame.beats.size ? [...frame.beats].join(' ∥ ') : undefined;
    moveWorn(this, frame);
    this.hold(frame);
    load(this, frame);
    clock.prevDelta = dt;
    clock.frame++;
    current.forward();
    this.poses = [prev, current, prev2];
    [frame.prev2, frame.prev, frame.current] = this.poses;
  }
}

const EMPTY_LOG: readonly LogEntry[] = Object.freeze([]);
/** a story of nothing: the body only stands and walks as its base has it */
const NOTHING = (): Behaviour => function* () {};
