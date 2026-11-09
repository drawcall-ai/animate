import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { BonePose, type ReadonlyBonePose } from '../kernel/bone-pose';
import { SUBSTEP, type Frame, type Behaviour } from '../kernel/frame';
import { Dev, OFF_FLOOR, type LogEntry } from '../kernel/dev';
import { Skeleton } from '../kernel/skeleton';
import { checkLimits } from '../kernel/limits';
import { SnapChecks } from '../kernel/rotation';
import { Asks } from '../kernel/asks';
import { HeadOffset } from '../look/offset';
import { createLocomotion, type Locomotion } from '../step/locomotion';
import type { Root } from '../step/root';
import type { Stepper } from '../step/stepper';
import { steadiness, type AnySpecies, type Gazer, type Temperament } from '../species/define';
import { MovingFrame } from '../kernel/moving-frame';
import { yawOf } from '../kernel/math';
import { Binding } from './binding';
import { PlatformFrame } from './platform';
import { placedFor } from '../things/placed';
import { anchors, movers, type Interpolated } from '../things/anchors';
import { Claims, Request, type RequestKind, type Staging } from '../kernel/requests';
import type { Thing } from '../things/thing';
import type { Goal, Placement } from '../kernel/goal';
import { heldMass, wornOf, type Bearing, type Hold } from '../things/hold';
import type { HandStaging } from './hand-staging';
import { FLAT, type Floor } from '../step/floor';
import { FingerState } from '../fingers/state';
import { TurnedNodes } from './turned-nodes';
import { checkShear, massed, restPose, type SelfOptions } from './setup';
import { Springs, type TrunkCapsules } from './springs';

/** Body state and arbitration. Each 1/60 s sub-step applies balance, request staging, part claims, then carried things.
 * Balance reads the previous sub-step’s asks; after all writes, final poses advance current → prev → prev2. */
export abstract class Self {
  readonly skeleton: Skeleton;
  readonly scale: number;
  readonly restOf;
  readonly scaleOf;
  readonly tempo: number;
  readonly frame: Frame;
  readonly log: readonly LogEntry[];
  /** the last final pose and the one before, as they were when its last update began: what others read while it is ahead of them */
  private readonly before: [ReadonlyBonePose, ReadonlyBonePose];
  private readonly poses: BonePose[];
  updates = 0;
  share = 0;
  readonly frames = new WeakMap<Object3D, Interpolated>();
  /** how it is asked to hold itself over its legs, by all its parts this sub-step: balance takes it at the start of the next */
  readonly asks = new Asks();
  /** its head turned over its gaze as its story asks (`pose`, `lookAt`'s roll and pitch), written after the eyes each sub-step */
  readonly headOffset: HeadOffset;
  readonly locomotion: Locomotion;
  /** its stepping legs, made with its balance */
  stepper: Stepper | null = null;
  readonly gazer?: Gazer;
  /** each hand's tip bone, by name */
  readonly hands: Readonly<Record<string, number>>;
  /** each hand's arm, as a pose asks for it */
  private readonly arms: readonly `arm.${string}`[];
  readonly holding: Record<string, Hold | null>;
  readonly coming: Record<string, Hold | null>;
  readonly drive?: (time: number) => Root;
  /** the root its app drove it to this sub-step: `drive` read once, as the sub-step starts */
  driven: Root | undefined;
  /** what it stands on: the floor's height under a world point */
  readonly floor: Floor;
  readonly life: Temperament;
  /** the bodies it keeps clear of: those it has dealt with (`meet`), either way */
  readonly near = new Set<Self>();
  /** what it moves itself, by object, each on its own frame's history (after its hands, each sub-step) */
  readonly carried = new Map<Object3D, MovingFrame>();
  /** the nodes on it its app keeps turned in the world (`Body.orient`) */
  readonly turnedNodes = new TurnedNodes(this);
  readonly requests: Request[] = [];
  /** the body's time when a story last filed a mover with it (s; −∞: never) */
  lastMover = -Infinity;
  /** what it wears (things on its bones its hands do not hold), as of its update's start */
  worn: Thing[] = [];
  readonly claims = new Claims();
  /** what it tracks of the scene, a sub-step's placement each */
  private readonly tracked = new WeakMap<Object3D, MovingFrame>();
  private readonly snaps = new SnapChecks();
  private readonly platform: PlatformFrame;
  private pending = 0;
  /** whether it is posing a sub-step (its current pose is being written) */
  private stepping = false;
  protected behaviours: Behaviours | null = null;
  /** its fingers, for a species with finger bones: written over each update's pose */
  readonly fingers: FingerState | null;
  private readonly springs: Springs | null;

  constructor(readonly species: AnySpecies, options: SelfOptions, readonly binding: Binding, start?: (skeleton: Skeleton, floor: Floor) => BonePose, trunk?: TrunkCapsules) {
    const dev = options.dev ? new Dev() : undefined;
    this.log = dev?.log ?? EMPTY;
    this.skeleton = massed(species, options.mass, (check, message) => this.warn(check, message));
    this.scale = species.scale;
    this.object = binding.object;
    this.restOf = binding.restOf.bind(binding);
    this.scaleOf = binding.scaleOf.bind(binding);
    this.tempo = options.tempo ?? 1;
    if (!(this.tempo > 0 && Number.isFinite(this.tempo))) throw new Error(`a tempo of ${this.tempo}`);
    this.gazer = species.gaze;
    this.headOffset = new HeadOffset(species.gaze);
    this.drive = options.drive;
    this.floor = options.floor ?? FLAT;
    this.life = options.life ?? {};
    // (a body stands on its floor wherever it is asked to start)
    const at = options.at, height = at ? Math.abs(at.y - this.floor(at.x, at.z)) : 0;
    if (height > OFF_FLOOR && !options.drive) this.warn('at', `it stands on its floor: its start's height is ignored, ${height.toFixed(3)} m off it`);
    const pose = start?.(this.skeleton, this.floor) ?? restPose(this.skeleton, this.floor, options.at, options.face);
    this.locomotion = createLocomotion(pose.facing);
    this.hands = Object.fromEntries([...species.hands ?? []].map(([hand, chain]) => [hand, this.skeleton.chain(chain).slice(-1)[0]]));
    this.arms = Object.keys(this.hands).map((hand) => `arm.${hand}` as const);
    this.holding = Object.fromEntries(Object.keys(this.hands).map((hand) => [hand, null]));
    this.coming = Object.fromEntries(Object.keys(this.hands).map((hand) => [hand, null]));
    this.poses = Array.from({ length: 5 }, () => new BonePose(this.skeleton).copy(pose));
    this.platform = new PlatformFrame(this.skeleton);
    this.before = [this.poses[3], this.poses[4]];
    this.frame = { dev, dt: SUBSTEP, time: 0, prev2: this.poses[0], prev: this.poses[1], current: this.poses[2] };
    anchors.set(this.binding.object, { body: this, bone: -1 });
    this.skeleton.bones.forEach((bone, i) => {
      const node: Object3D | undefined = this.binding.bones[bone.name];
      if (node) anchors.set(node, { body: this, bone: i });
    });
    if (options.model) checkShear(this.binding);
    this.binding.write(this.pose, this.floor);
    this.springs = species.springs ? new Springs(species, binding, trunk ?? null) : null;
    this.fingers = species.fingers ? new FingerState(species.fingers, binding.bones, this.holding, binding.object, (check, message) => this.warn(check, message)) : null;
  }

  /** what it bears of the things it holds and wears */
  readonly borne = new Map<Thing, Bearing>();

  /** asks the body to come along before the head aims at `point` (a person bows to see low down) */
  gazeAsks?(pose: ReadonlyBonePose, point: Readonly<Vector3>): void;

  /** what its hands do for the verbs (made when first asked, once all it is has been made) */
  get handStaging(): HandStaging {
    return (this.staged ??= this.stageHands());
  }

  private staged: HandStaging | null = null;

  /** whether hand `hand` can hold a wrist at `wrist` (world) as the body is posed now */
  abstract holds(f: Frame, hand: string, wrist: Goal): boolean;

  /** what its hands do for the verbs */
  protected abstract stageHands(): HandStaging;

  /** its behaviours: made once all it is has been made */
  protected abstract behave(): Behaviours;

  /** the weight its hands bear off their support (kg) */
  get load(): number {
    return heldMass(this);
  }

  /** its object in the scene: a group on the floor under its root, turned by its facing */
  readonly object;

  /** the scene node of moving bone `bone` */
  boneNode(bone: number): Object3D {
    return this.binding.bones[this.skeleton.bones[bone].name];
  }

  /** the last final pose */
  get pose(): ReadonlyBonePose {
    return this.frame.prev;
  }

  /** its root's turn about +Y (0 faces +Z) */
  get yaw(): number {
    return yawOf(this.pose.local(0));
  }

  /** its bones in the scene as its last finished pose has them: an update's later sub-steps stand ahead of what its last update wrote */
  showPrev(): void {
    this.binding.write(this.frame.prev, this.floor);
  }

  /** Self reads the pose being written (the last final pose between sub-steps); a body ahead of another reader exposes its update-start pose. */
  poseFor(reader: Self): ReadonlyBonePose {
    if (reader === this) return this.stepping ? this.frame.current : this.frame.prev;
    return this.updates > reader.updates ? this.before[0] : this.frame.prev;
  }

  /** its final poses as `reader` reads them (`poseFor`): the last and the one before */
  posesFor(reader: Self): readonly [ReadonlyBonePose, ReadonlyBonePose] {
    return this.updates > reader.updates ? [this.before[0], this.before[1]] : [this.frame.prev, this.frame.prev2];
  }

  /** it deals with the body `other` is (a target on it, a thing in its hands): each keeps clear of the other from now on */
  meet(other: Self): void {
    if (other === this) return;
    this.near.add(other);
    other.near.add(this);
  }

  /** where it moves `node`, as `reader` reads it (`poseFor`): its own this sub-step; another's as it was before its update this frame */
  movedFor(reader: Self, node: Object3D): Placement | null {
    const movingFrame = this.carried.get(node);
    if (!movingFrame) return null;
    if (reader === this) return movingFrame.at(this.frame.time).current;
    return this.updates > reader.updates ? this.movedBefore.get(node) ?? movingFrame.current : movingFrame.current;
  }

  /** where it moved each thing it carries as its last update began: what others read while it is ahead of them */
  private readonly movedBefore = new Map<Object3D, Placement>();

  /** moves `node` itself from now on (a thing in both its hands), from where `carrier` has it */
  carry(node: Object3D, movingFrame: MovingFrame): void {
    movers.get(node)?.leave(node);
    this.carried.set(node, movingFrame);
    movers.set(node, this);
  }

  /** stops moving `node` itself: it reads it on from there, its history (velocity, spin) carried over */
  leave(node: Object3D): void {
    const movingFrame = this.carried.get(node);
    if (!movingFrame) return;
    this.carried.delete(node);
    this.movedBefore.delete(node);
    if (movers.get(node) === this) movers.delete(node);
    this.tracked.set(node, movingFrame);
  }

  /** where `node` is this sub-step, tracked over the sub-steps (velocity, spin, the frame a hand follows on it) */
  track(node: Object3D): MovingFrame {
    const f = this.frame, own = this.carried.get(node);
    if (own) {
      own.due(f.time);
      return own;
    }
    let movingFrame = this.tracked.get(node);
    if (!movingFrame) {
      const at = placedFor(this, node, { position: new Vector3(), quaternion: new Quaternion() });
      this.tracked.set(node, (movingFrame = new MovingFrame(at.position, at.quaternion)));
      movingFrame.place(f.time, at.position, at.quaternion);
      return movingFrame;
    }
    if (!movingFrame.moved(f.time)) {
      const at = placedFor(this, node, _local);
      movingFrame.move(f.time, at.position, at.quaternion);
    }
    return movingFrame;
  }

  /**
   * `bones` as its pose being written has them, written into its earlier poses too: as if they had always stood so, so nothing reads
   * the change as motion — only as it starts, before its first update ends (none of its poses has been shown)
   */
  startAs(bones: readonly number[]): void {
    if (this.updates > 0) throw new Error('a body already shown cannot start otherwise');
    const current = this.frame.current;
    for (const pose of this.poses) {
      if (pose === current) continue;
      for (const bone of bones) pose.setLocal(bone, current.local(bone));
    }
  }

  /** the request `verb` files (its staging runs from its next sub-step on); `site` names where its story asked for it */
  file(verb: string, site: string | (() => string), staging: Staging, kind?: RequestKind): Request {
    const request = new Request(this, verb, site, staging, kind);
    if (request.kind === 'mover') this.lastMover = this.time;
    this.requests.push(request);
    return request;
  }

  /** a request's verb has ended: its staging stops, its claims let go */
  drop(request: Request): void {
    const k = this.requests.indexOf(request);
    if (k < 0) return;
    this.requests.splice(k, 1);
    request.end();
  }

  get time(): number {
    return this.frame.time;
  }

  /** advances by `seconds`: every whole sub-step it covers, with what earlier updates left over */
  update(seconds: number): void {
    if (!(seconds >= 0 && Number.isFinite(seconds))) throw new Error(`cannot update by ${seconds} s`);
    this.pending += Math.min(seconds, MOST);
    // (1e-9: 1/30 is a hair under two sub-steps of 1/60 in floating point)
    const steps = Math.floor(this.pending / SUBSTEP + 1e-9);
    this.pending = Math.max(0, this.pending - steps * SUBSTEP);
    [this.before[0], this.before[1]] = [this.frame.prev, this.frame.prev2];
    for (const [node, carrier] of this.carried) {
      const before = this.movedBefore.get(node) ?? { position: new Vector3(), quaternion: new Quaternion() };
      before.position.copy(carrier.current.position);
      before.quaternion.copy(carrier.current.quaternion);
      this.movedBefore.set(node, before);
    }
    this.worn = wornOf(this);
    this.checkPlacement();
    this.checkYielded();
    try {
      this.stepping = true;
      for (let i = 0; i < steps; i++) {
        this.share = (i + 1) / steps;
        this.subStep();
        if (this.springs) {
          this.springs.restore();
          this.binding.write(this.pose, this.floor);
          this.turnedNodes.write();
          this.springs.step(SUBSTEP);
        }
      }
    } finally {
      this.stepping = false;
    }
    // (one too short for a sub-step finished nothing: readers and what was kept for this pose stay as they are)
    if (steps > 0) this.updates++;
    this.binding.write(this.pose, this.floor);
    this.turnedNodes.write();
    this.fingers?.update(seconds);
    this.springs?.write();
  }

  /** each hand's digits' contacts met this sub-step (`FingerState.meet`), the hand where its hold left it */
  private meetContacts(fingers: FingerState, f: Frame): void {
    for (const side of ['left', 'right'] as const) {
      const hand = this.hands[side];
      if (hand === undefined) continue;
      const at = { position: f.current.position(hand).clone(), quaternion: f.current.rotation(hand).clone().multiply(this.restOf(hand)), scale: this.scaleOf(hand) };
      fingers.meet(side, at, (object) => this.track(object).at(f.time).current);
    }
  }

  /** the parent its object was first seen under */
  private parent: Object3D | null | undefined = undefined;

  /** its object stays where it was added (it is not mounted on anything), under a parent that is the world's frame */
  private checkPlacement(): void {
    const object = this.binding.object, parent = object.parent;
    this.parent ??= parent;
    if (parent !== this.parent) throw new Error(`its object was re-parented${parent ? ` to "${parent.name}"` : ''}: add it once, where it stays (a body on something moving takes its \`platform\`)`);
    if (!parent) return;
    parent.updateWorldMatrix(true, false);
    if (!parent.matrixWorld.equals(IDENTITY)) throw new Error(`its object is under "${parent.name}", moved, turned or scaled: add it to the world's frame`);
  }

  /** verbs called and not yet stepped by a story: a verb a story forgot to `yield*`, said once it has lain a second */
  readonly unyielded = new Set<{ readonly verb: string; readonly site: string; readonly time: number }>();

  private checkYielded(): void {
    for (const call of this.unyielded) {
      if (this.time - call.time < UNYIELDED) continue;
      this.unyielded.delete(call);
      this.warn(`unyielded ${call.verb} ${call.site}`, `${call.verb}${call.site ? ` (${call.site})` : ''} was called but never run: a verb does nothing until \`yield*\`ed`);
    }
  }

  /** what it has warned of */
  private readonly warned = new Set<string>();

  /** says `message` on the console, the first time this body comes to `check`: a fallback it took, which must be seen with development off too */
  warn(check: string, message: string): void {
    if (this.warned.has(check)) return;
    this.warned.add(check);
    console.warn(`animate: ${this.species.name ?? 'custom species'}${this.binding.object.name ? ` "${this.binding.object.name}"` : ''}: ${message}`);
  }

  beat(): string {
    return this.requests.map((request) => request.label).join(' ∥ ');
  }

  private subStep(): void {
    const { frame: f } = this, { prev, current } = f;
    if (f.dev && f.time > 0) {
      checkLimits(f.prev, f.dev, f.time);
      this.snaps.check(f, f.dev);
    }
    f.time += f.dt;
    const root = this.driven = this.drive?.(f.time);
    const carried = this.platform.read(f, root?.support ? root.platform : undefined);
    if (carried !== f) this.stepper?.transport(this.platform.delta);
    current.copy(carried.prev);
    const behaviours = (this.behaviours ??= this.behave());
    // (balance first, on what was asked last sub-step; then the requests' staging, reading the body as balance has it now)
    // Gait follows its supporting frame; gaze and hand targets keep their world-space motion histories.
    behaviours.balance?.(carried);
    // (how still its life holds it, asked for balance's next sub-step as its parts ask)
    if (this.life.steady !== undefined) this.asks.add({ steady: steadiness(this.life, f.time) });
    // (its pose faces the way balance turned it before anything reads its object's frame: a place before it, a thing on it)
    current.facing = this.locomotion.facing;
    this.turnedNodes.step(f);
    for (const request of [...this.requests]) {
      request.stage(f);
      // (one of the body's own: no story renews it; it ends with its staging)
      if (request.kind !== 'own') continue;
      request.renewed = f.time;
      if (request.finished) this.drop(request);
    }
    if (f.dev) {
      f.dev.beat = this.beat() || undefined;
      for (const request of this.requests) {
        if (request.stale || f.time - request.renewed <= STALE) continue;
        request.stale = true;
        f.dev.append(f.time, { check: `request not renewed for ${STALE} s: its story stopped stepping (s)`, value: f.time - request.renewed, limit: STALE, where: request.label });
      }
    }
    this.asks.legGoal = this.claims.run('legs', f) ?? null;
    behaviours.gaze?.(f);
    this.claims.run('look', f);
    this.claims.run('head', f);
    this.headOffset.write(f);
    this.claims.run('trunk', f);
    for (const arm of this.arms) this.claims.run(arm, f);
    if (this.fingers) for (const hand of Object.keys(this.hands)) this.claims.run(`fingers.${hand}`, f);
    behaviours.hands?.(f);
    for (const hand of Object.keys(this.hands)) {
      if (this.claims.owner(`hand.${hand}`)) this.claims.run(`hand.${hand}`, f);
      else if (this.holding[hand]) behaviours.idleHold?.(f, hand);
    }
    if (this.fingers) this.meetContacts(this.fingers, f);
    behaviours.things?.(f);
    current.forward();
    // (keep the two update-start poses intact, including across multiple sub-steps)
    const next = this.poses.find((pose) => pose !== prev && pose !== current && !this.before.includes(pose));
    if (!next) throw new Error('no writable pose outside the frame history');
    [f.prev2, f.prev, f.current] = [prev, current, next];
  }
}

/** a body's behaviours, in the order they run each sub-step: balance, the eyes when nothing asks, the free hands, a holding hand's idle, what it moves */
export interface Behaviours {
  balance?: Behaviour;
  gaze?: Behaviour;
  hands?: Behaviour;
  idleHold?: (f: Frame, hand: string) => void;
  things?: Behaviour;
}

const IDENTITY = new Matrix4();
/** the longest frame an update takes (s): a body does not run on through a stall */
const MOST = 0.1;
/** how long a verb called may lie unstepped before it is said (s) */
const UNYIELDED = 1;
/** how long a request may go unrenewed before development says its story stopped stepping (s) */
const STALE = 1;
const _local: Placement = { position: new Vector3(), quaternion: new Quaternion() };
const EMPTY: readonly LogEntry[] = Object.freeze([]);
