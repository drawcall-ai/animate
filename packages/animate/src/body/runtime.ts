import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { Pose, type ReadonlyPose } from '../kernel/pose';
import { STEP, type Frame, type Step } from '../kernel/frame';
import { Dev, OFF_FLOOR, type LogEntry } from '../kernel/dev';
import { Skeleton, type SkinVolume } from '../kernel/skeleton';
import { checkLimits } from '../kernel/limits';
import { SnapChecks } from '../kernel/rotation';
import { Poise } from '../kernel/poise';
import { HeadOffset } from '../look/offset';
import type { Go } from '../kernel/go';
import { createLocomotion, type Locomotion } from '../legs/locomotion';
import type { Root } from '../legs/legged';
import type { Stepper } from '../legs/step/stepper';
import { steadiness, type AnySpecies, type Gazer, type Temperament } from '../species/define';
import { Carrier } from '../kernel/carrier';
import { yawOf } from '../kernel/math';
import { Binding } from './model';
import { PlatformFrame } from './platform';
import { anchors, movers, resolve, type Hold, type Holder, type Interpolated, type Resolving } from '../things/resolve';
import { rank, Request, type Channel, type Claim, type Staging } from '../kernel/requests';
import type { Thing } from '../things/thing';
import type { Goal, Placement } from '../kernel/goal';
import { bear, checkParents, heldMass, wornOf, type Bearing } from '../things/hold';
import { creature } from '../legs/creature';
import { creatureHands, keeping } from '../hands/creature/hands';
import type { Handling } from '../hands/handling';
import { FLAT, type Floor } from '../legs/floor';
import { FingerState } from '../fingers/state';
import { Orient } from './orient';
import { checkShear, massed, restPose } from './setup';
import { Springs } from '../springs';

/** How a body is made. */
export interface SelfOptions {
  /** where it stands (default the origin): x and z — it stands on its floor there; a y off that floor is ignored, with a warning */
  at?: Vector3;
  /**
   * the floor's height under a world point (x, z) (m; default 0 everywhere): what it stands and steps on — a raised stage, a dais, a
   * step, a flight of stairs — its feet each landing whole on one level, the body rising and falling over its legs as it goes. Level
   * areas with edges between them: a person climbs treads deeper than about 1.3 of its foot (`species.person.heelBack + toeFront`; 0.35 m
   * of tread for the default body) and steps
   * up a curb; a creature stands on raised floors and steps up single steps. Slopes, and stairs with shallower treads, are not handled for
   * walks; with physics support the controller carries the root over them, given matching world-space heights. A height-only floor does
   * not supply surface normals.
   * A person's step length against a tread decides whether it puts one foot or both on each; between the two it mixes them from tread to
   * tread, which reads as hesitation. Give every body on a set the same function, or they disagree on where its floor is.
   */
  floor?: Floor;
  /** the way it faces (rad about +Y; 0 faces +Z) */
  face?: number;
  /** its root driven by the app (a player's, or a scripted path a walk cannot take), read every sub-step with the body's time (s): its legs
   * keep up, and nothing borrows them; give `at` and `face` as the drive starts, or the first sub-step jumps there */
  drive?: (time: number) => Root;
  /** its quiet life: a seed that fixes its variation (unseeded, it varies with where the body is made), what tethers it and what startles it */
  life?: Temperament;
  /** how quick it is, all told (1: as tuned; 1.2: a fifth quicker): its walks', reaches' and carries' paces — a walk given a `speed` keeps
   * that speed, tempo or not; how it steps at a pace is its species' (a person's `stride`) */
  tempo?: number;
  /**
   * what it weighs (kg), or a closed mesh's volume as @drawcall/rig's skin report gives it (at 1000 kg/m³, within half and twice its
   * species' mass: it warns when it is held so, or the mesh is open and the species' mass is taken); default its species'
   */
  mass?: number | SkinVolume;
  /** the container its mesh was rigged in with @drawcall/rig (`skin(model, skeleton)`): the body poses its bones; without it, the body is bare */
  model?: Object3D;
  /** checks its motion each sub-step and records what went wrong in `Body.log`; off in a build, it costs nothing */
  dev?: boolean;
}

/** Body state and arbitration. Each 1/60 s sub-step applies balance, request staging, part claims, then carried things.
 * Balance reads the previous sub-step’s asks; after all writes, final poses advance current → prev → prev2. */
export class Self implements Holder {
  readonly skeleton: Skeleton;
  readonly scale: number;
  readonly restOf;
  readonly scaleOf;
  readonly tempo: number;
  readonly frame: Frame;
  readonly log: readonly LogEntry[];
  /** the last final pose and the one before, as they were when its last update began: what others read while it is ahead of them */
  private readonly before: [ReadonlyPose, ReadonlyPose];
  private readonly poses: Pose[];
  updates = 0;
  share = 0;
  readonly frames = new WeakMap<Object3D, Interpolated>();
  /** how it is asked to hold itself over its legs, by all its parts this sub-step: balance takes it at the start of the next */
  readonly poise = new Poise();
  /** its head turned over its gaze as its story asks (`pose`, `lookAt`'s roll and pitch), written after the eyes each sub-step */
  readonly headOffset: HeadOffset;
  /** where the request that has its legs asks them to take it this sub-step (balance takes it at the start of the next) */
  going: Go | null = null;
  /** where the request that has its eyes asks them to look, for a species whose posture turns its head (it has no neck chain) */
  look: Readonly<Vector3> | null = null;
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
  readonly carried = new Map<Object3D, Carrier>();
  /** the nodes on it its app keeps turned in the world (`Body.orient`) */
  readonly orient = new Orient(this);
  readonly requests: Request[] = [];
  /** the body's time when a story last filed a mover with it (s; −∞: never) */
  lastMover = -Infinity;
  /** what it wears (things on its bones its hands do not hold), as of its update's start */
  worn: Thing[] = [];
  private readonly claims = new Map<Channel, Claim[]>();
  /** what it tracks of the scene, a sub-step's placement each */
  private readonly tracked = new WeakMap<Object3D, Carrier>();
  private readonly snaps = new SnapChecks();
  private readonly platform: PlatformFrame;
  private pending = 0;
  /** whether it is posing a sub-step (its current pose is being written) */
  private stepping = false;
  private behaviours: Behaviours | null = null;
  /** its fingers, for a species with finger bones: written over each update's pose */
  readonly fingers: FingerState | null;
  private readonly springs: Springs | null;

  constructor(readonly species: AnySpecies, options: SelfOptions, readonly binding: Binding, start?: (skeleton: Skeleton, floor: Floor) => Pose) {
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
    if (this.life.steady !== undefined && !species.person) throw new Error(`life.steady: a person's; a ${species.name ?? 'custom species'} has no such setting`);
    // (a body stands on its floor wherever it is asked to start)
    const at = options.at, height = at ? Math.abs(at.y - this.floor(at.x, at.z)) : 0;
    if (height > OFF_FLOOR && !options.drive) this.warn('at', `it stands on its floor: its start's height is ignored, ${height.toFixed(3)} m off it`);
    const pose = start?.(this.skeleton, this.floor) ?? restPose(this.skeleton, this.floor, options.at, options.face);
    this.locomotion = createLocomotion(pose.facing);
    this.hands = Object.fromEntries([...species.hands ?? []].map(([hand, chain]) => [hand, this.skeleton.chain(chain).slice(-1)[0]]));
    this.arms = Object.keys(this.hands).map((hand) => `arm.${hand}` as const);
    this.holding = Object.fromEntries(Object.keys(this.hands).map((hand) => [hand, null]));
    this.coming = Object.fromEntries(Object.keys(this.hands).map((hand) => [hand, null]));
    this.poses = Array.from({ length: 5 }, () => new Pose(this.skeleton).copy(pose));
    this.platform = new PlatformFrame(this.skeleton);
    this.before = [this.poses[3], this.poses[4]];
    this.frame = { dev, dt: STEP, time: 0, prev2: this.poses[0], prev: this.poses[1], current: this.poses[2] };
    anchors.set(this.binding.object, { body: this, bone: -1 });
    this.skeleton.bones.forEach((bone, i) => {
      const node: Object3D | undefined = this.binding.bones[bone.name];
      if (node) anchors.set(node, { body: this, bone: i });
    });
    if (options.model) checkShear(this.binding);
    this.binding.write(this.pose, this.floor);
    this.springs = species.springs ? new Springs(species, binding) : null;
    this.fingers = species.fingers ? new FingerState(species.fingers, binding.bones, this.holding, binding.object, (check, message) => this.warn(check, message)) : null;
    /** Construct creature behaviours now so infeasible legs fail before the first update. */
    if (!species.person) this.behaviours = this.behave();
  }

  /** what it bears of the things it holds and wears */
  readonly borne = new Map<Thing, Bearing>();

  /** what its hands do for the verbs (made when first asked, once all it is has been made) */
  get handling(): Handling {
    return (this.handled ??= this.handle());
  }

  private handled: Handling | null = null;

  /** whether hand `hand` can hold a wrist at `wrist` (world) as the body is posed now: a creature's, wherever it reaches */
  holds(_f: Frame, _hand: string, _wrist: Goal): boolean {
    return true;
  }

  /** a creature's hands: one at a time, each the tip of its chain */
  protected handle(): Handling {
    return creatureHands(this);
  }

  /** its behaviours (made after construction, once all it is has been made): a creature's legs and carriage, its jaw keeping hold */
  protected behave(): Behaviours {
    return {
      balance: this.species.legs ? creature(this) : undefined,
      keep: keeping(this),
      things: (f) => {
        checkParents(this);
        bear(this, f, this.worn, this.borne);
      },
    };
  }

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
  get pose(): ReadonlyPose {
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
  poseFor(reader: Resolving): ReadonlyPose {
    if (reader === this) return this.stepping ? this.frame.current : this.frame.prev;
    return this.updates > reader.updates ? this.before[0] : this.frame.prev;
  }

  /** its final poses as `reader` reads them (`poseFor`): the last and the one before */
  posesFor(reader: Resolving): readonly [ReadonlyPose, ReadonlyPose] {
    return this.updates > reader.updates ? [this.before[0], this.before[1]] : [this.frame.prev, this.frame.prev2];
  }

  /** it deals with the body `other` is (a target on it, a thing in its hands): each keeps clear of the other from now on */
  meet(other: Holder): void {
    if (!(other instanceof Self) || other === this) return;
    this.near.add(other);
    other.near.add(this);
  }

  /** where it moves `node`, as `reader` reads it (`poseFor`): its own this sub-step; another's as it was before its update this frame */
  movedFor(reader: Resolving, node: Object3D): Placement | null {
    const carrier = this.carried.get(node);
    if (!carrier) return null;
    if (reader === this) return carrier.at(this.frame.time).current;
    return this.updates > reader.updates ? this.movedBefore.get(node) ?? carrier.current : carrier.current;
  }

  /** where it moved each thing it carries as its last update began: what others read while it is ahead of them */
  private readonly movedBefore = new Map<Object3D, Placement>();

  /** moves `node` itself from now on (a thing in both its hands), from where `carrier` has it */
  carry(node: Object3D, carrier: Carrier): void {
    movers.get(node)?.leave(node);
    this.carried.set(node, carrier);
    movers.set(node, this);
  }

  /** stops moving `node` itself: it reads it on from there, its history (velocity, spin) carried over */
  leave(node: Object3D): void {
    const carrier = this.carried.get(node);
    if (!carrier) return;
    this.carried.delete(node);
    this.movedBefore.delete(node);
    if (movers.get(node) === this) movers.delete(node);
    this.tracked.set(node, carrier);
  }

  /** where `node` is this sub-step, tracked over the sub-steps (velocity, spin, the frame a hand follows on it) */
  track(node: Object3D): Carrier {
    const f = this.frame, own = this.carried.get(node);
    if (own) {
      own.due(f.time);
      return own;
    }
    let carrier = this.tracked.get(node);
    if (!carrier) {
      const at = resolve(this, node, { position: new Vector3(), quaternion: new Quaternion() });
      this.tracked.set(node, (carrier = new Carrier(at.position, at.quaternion)));
      carrier.place(f.time, at.position, at.quaternion);
      return carrier;
    }
    if (!carrier.moved(f.time)) {
      const at = resolve(this, node, _local);
      carrier.move(f.time, at.position, at.quaternion);
    }
    return carrier;
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
  file(verb: string, site: string | (() => string), staging: Staging, aimer = false, owned = false): Request {
    const request = new Request(this, verb, site, staging, aimer);
    request.owned = owned;
    if (!aimer && !owned) this.lastMover = this.time;
    this.requests.push(request);
    return request;
  }

  /** a request of the body's own (a hand backing out of what it let go): no story renews it; it ends with its staging */
  own(verb: string, site: string, staging: Staging): Request {
    return this.file(verb, site, staging, false, true);
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

  claim(claim: Claim): void {
    const claims = this.claims.get(claim.channel) ?? [];
    claims.push(claim);
    claims.sort(rank);
    this.claims.set(claim.channel, claims);
  }

  unclaim(claim: Claim): void {
    const claims = this.claims.get(claim.channel);
    if (!claims) return;
    const k = claims.indexOf(claim);
    if (k >= 0) claims.splice(k, 1);
  }

  /** the claim that has `channel` (its last in order), if any */
  owner(channel: Channel): Claim | undefined {
    const claims = this.claims.get(channel);
    return claims?.[claims.length - 1];
  }

  /** Losing leg claims still tick for progress tracking; only the owner's result drives the body. */
  private run(channel: Channel, f: Frame): Go | void {
    const claims = this.claims.get(channel);
    if (!claims?.length) return;
    const owner = claims[claims.length - 1];
    if (channel === 'go') for (const claim of claims.slice(0, -1)) claim.step(f);
    return owner.step(f);
  }

  /** advances by `seconds`: every whole sub-step it covers, with what earlier updates left over */
  update(seconds: number): void {
    if (!(seconds >= 0 && Number.isFinite(seconds))) throw new Error(`cannot update by ${seconds} s`);
    this.pending += Math.min(seconds, MOST);
    // (1e-9: 1/30 is a hair under two sub-steps of 1/60 in floating point)
    const steps = Math.floor(this.pending / STEP + 1e-9);
    this.pending = Math.max(0, this.pending - steps * STEP);
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
        this.step();
        if (this.springs) {
          this.springs.restore();
          this.binding.write(this.pose, this.floor);
          this.orient.write();
          this.springs.step(STEP);
        }
      }
    } finally {
      this.stepping = false;
    }
    // (one too short for a sub-step finished nothing: readers and what was kept for this pose stay as they are)
    if (steps > 0) this.updates++;
    this.binding.write(this.pose, this.floor);
    this.orient.write();
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

  private step(): void {
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
    if (this.life.steady !== undefined) this.poise.add({ steady: steadiness(this.life, f.time) });
    // (its pose faces the way balance turned it before anything reads its object's frame: a place before it, a thing on it)
    current.facing = this.locomotion.facing;
    this.orient.step(f);
    for (const request of [...this.requests]) {
      request.stage(f);
      if (!request.owned) continue;
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
    this.going = this.run('go', f) ?? null;
    this.look = null;
    behaviours.gaze?.(f);
    this.run('look', f);
    this.run('head', f);
    this.headOffset.write(f);
    this.run('trunk', f);
    for (const arm of this.arms) this.run(arm, f);
    if (this.fingers) for (const hand of Object.keys(this.hands)) this.run(`fingers.${hand}`, f);
    behaviours.hands?.(f);
    for (const hand of Object.keys(this.hands)) {
      if (this.owner(`hand.${hand}`)) this.run(`hand.${hand}`, f);
      else if (this.holding[hand]) behaviours.keep?.(f, hand);
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

/** a body's behaviours, in the order they run each sub-step: balance, the eyes when nothing asks, the free hands, a holding hand's keep, what it moves */
export interface Behaviours {
  balance?: Step;
  gaze?: Step;
  hands?: Step;
  keep?: (f: Frame, hand: string) => void;
  things?: Step;
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
