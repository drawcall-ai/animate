import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import type { SkinReport } from '@drawcall/rig';
import { Pose, type ReadonlyPose } from '../kernel/pose';
import { STEP, type Frame, type Step } from '../kernel/frame';
import { Dev, type LogEntry } from '../kernel/dev';
import { Skeleton } from '../kernel/skeleton';
import { checkLimits } from '../kernel/limits';
import { SnapChecks } from '../kernel/rotation';
import { Poise } from '../kernel/poise';
import type { Go } from '../kernel/go';
import { createLocomotion, type Locomotion } from '../legs/locomotion';
import type { Root } from '../legs/legged';
import type { Stepper } from '../legs/step/stepper';
import type { AnySpecies, Gazer, Temperament } from '../species/define';
import { Carrier } from '../kernel/carrier';
import { yawOf } from '../kernel/math';
import { Binding } from './model';
import { anchors, movers, resolve, type Hold, type Holder, type Interpolated, type Resolving } from '../things/resolve';
import { rank, Request, type Channel, type Claim, type Staging } from '../kernel/requests';
import type { Thing } from '../things/thing';
import type { Placement } from '../kernel/goal';
import { bear, checkParents, heldMass, wornOf, type Bearing } from '../things/hold';
import { creature } from '../legs/creature';
import { creatureHands, keeping } from '../hands/creature/hands';
import type { Handling } from '../hands/handling';

/** How a body is made. */
export interface SelfOptions {
  /** where it stands on the floor (default the origin) */
  at?: Vector3;
  /** the way it faces (rad about +Y; 0 faces +Z) */
  face?: number;
  /** its root driven by the app (a player's), read every sub-step with the body's time (s): its legs keep up, and nothing borrows them */
  drive?: (time: number) => Root;
  /** its quiet life: a seed that fixes its variation, what tethers it and what startles it */
  life?: Temperament;
  /** how quick it is, all told (1: as tuned; 1.2: a fifth quicker): its walks', reaches' and carries' paces */
  tempo?: number;
  /**
   * what it weighs (kg), or a closed mesh's volume as @drawcall/rig's skin report gives it (at 1000 kg/m³, within half and twice its
   * species' mass: development says when it is held so, or the mesh is open and the species' mass is taken); default its species'
   */
  mass?: number | Pick<SkinReport, 'closed' | 'volume'>;
  /** the container its mesh was rigged in with @drawcall/rig (`skin(model, skeleton)`): the body poses its bones; without it, the body is bare */
  model?: Object3D;
  /** checks final poses and records problems in `log`; `{ notes: true }` also records what is only reported (a player-driven body's balance) */
  dev?: boolean | { notes?: boolean };
}

/**
 * A body as it moves: its pose history, what its story asks of it (requests on its parts) and the behaviours that serve them. Each
 * 1/60 s sub-step, in this order: balance (the legs and the trunk over them, as walks and reaches asked a sub-step before), the requests'
 * staging, then for each part the request that has it — the legs, the eyes (else they look about), the trunk, each hand (else it keeps
 * hold, or hangs free) — and the things it moves; then the final pose becomes the history: current → prev → prev2.
 */
export class Self implements Holder {
  readonly skeleton: Skeleton;
  readonly scale: number;
  readonly tempo: number;
  readonly frame: Frame;
  /** the last final pose and the one before, as they were when its last update began: what others read while it is ahead of them */
  private readonly before: [Pose, Pose];
  private poses: [Pose, Pose, Pose];
  updates = 0;
  share = 0;
  readonly frames = new WeakMap<Object3D, Interpolated>();
  /** how it is asked to hold itself over its legs, by all its parts this sub-step: balance takes it at the start of the next */
  readonly poise = new Poise();
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
  readonly holding: Record<string, Hold | null>;
  readonly drive?: (time: number) => Root;
  readonly life: Temperament;
  /** the bodies it keeps clear of: those it has dealt with (`meet`), either way, and those it was told to avoid */
  readonly near = new Set<Self>();
  /** what it moves itself, by object, each on its own frame's history (after its hands, each sub-step) */
  readonly carried = new Map<Object3D, Carrier>();
  readonly requests: Request[] = [];
  /** what it wears (things on its bones its hands do not hold), as of its update's start */
  worn: Thing[] = [];
  private readonly claims = new Map<Channel, Claim[]>();
  /** what it tracks of the scene, a sub-step's placement each */
  private readonly tracked = new WeakMap<Object3D, Carrier>();
  private readonly snaps = new SnapChecks();
  private pending = 0;
  /** whether it is posing a sub-step (its current pose is being written) */
  private stepping = false;
  private behaviours: Behaviours | null = null;

  constructor(readonly species: AnySpecies, options: SelfOptions, readonly binding: Binding, start?: (skeleton: Skeleton) => Pose) {
    const dev = options.dev ? new Dev(typeof options.dev === 'object' && !!options.dev.notes) : undefined;
    this.skeleton = massed(species, options.mass, dev);
    this.scale = species.scale;
    this.tempo = options.tempo ?? 1;
    if (!(this.tempo > 0 && Number.isFinite(this.tempo))) throw new Error(`a tempo of ${this.tempo}`);
    this.gazer = species.gaze;
    this.drive = options.drive;
    this.life = options.life ?? {};
    const pose = start?.(this.skeleton) ?? restPose(this.skeleton, options.at, options.face);
    this.locomotion = createLocomotion(pose.facing);
    this.hands = Object.fromEntries([...species.hands ?? []].map(([hand, chain]) => [hand, this.skeleton.chain(chain).slice(-1)[0]]));
    this.holding = Object.fromEntries(Object.keys(this.hands).map((hand) => [hand, null]));
    this.poses = [new Pose(this.skeleton).copy(pose), new Pose(this.skeleton).copy(pose), new Pose(this.skeleton).copy(pose)];
    this.before = [new Pose(this.skeleton).copy(pose), new Pose(this.skeleton).copy(pose)];
    this.frame = { dev, dt: STEP, time: 0, prev2: this.poses[0], prev: this.poses[1], current: this.poses[2] };
    anchors.set(this.binding.object, { body: this, bone: -1 });
    this.skeleton.bones.forEach((bone, i) => {
      const node: Object3D | undefined = this.binding.bones[bone.name];
      if (node) anchors.set(node, { body: this, bone: i });
    });
    if (this.frame.dev && options.model) checkShear(this.binding, this.frame.dev);
    this.binding.write(this.pose);
  }

  /** what it bears of the things it holds and wears */
  readonly borne = new Map<Thing, Bearing>();

  /** what its hands do for the verbs (made when first asked, once all it is has been made) */
  get handling(): Handling {
    return (this.handled ??= this.handle());
  }

  private handled: Handling | null = null;

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
        checkParents(this, f);
        bear(this, f, this.worn, this.borne);
      },
    };
  }

  /** Construct creature behaviours now so infeasible legs fail before the first update. */
  initialize(): void {
    this.behaviours = this.behave();
  }

  /** the weight its hands bear off their support (kg) */
  get load(): number {
    return heldMass(this);
  }

  /** its object in the scene: a group on the floor, turned by its facing */
  get object(): Object3D {
    return this.binding.object;
  }

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

  /**
   * the pose `reader` reads this body by: its own as posed so far this sub-step (between sub-steps, its last); another's as it was before
   * its update this frame, if it is ahead
   */
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

  restOf(bone: number): Readonly<Quaternion> {
    return this.binding.restOf(bone);
  }

  scaleOf(bone: number): number {
    return this.binding.scaleOf(bone);
  }

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

  /** the request `verb` files (its staging runs from its next sub-step on); `site` names where its story asked for it */
  file(verb: string, site: string, staging: Staging, aimer = false): Request {
    const request = new Request(this, verb, site, staging, aimer);
    this.requests.push(request);
    return request;
  }

  /** a request of the body's own (a hand backing out of what it let go): no story renews it; it ends with its staging */
  own(verb: string, site: string, staging: Staging): Request {
    const request = this.file(verb, site, staging);
    request.owned = true;
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

  /**
   * the step of the claim that has `channel` run, and what it asks returned; the legs' others tick too (a walk keeps its own count of
   * how it is getting on), their asks unheard
   */
  private run(channel: Channel, f: Frame): Go | void {
    const claims = this.claims.get(channel);
    if (!claims?.length) return;
    const owner = claims[claims.length - 1];
    if (channel === 'go') for (const claim of claims.slice(0, -1)) claim.step(f);
    return owner.step(f);
  }

  get log(): readonly LogEntry[] {
    return this.frame.dev?.log ?? EMPTY;
  }

  get notes(): readonly LogEntry[] {
    return this.frame.dev?.notes ?? EMPTY;
  }

  /** advances by `seconds`: every whole sub-step it covers, with what earlier updates left over */
  update(seconds: number): void {
    if (!(seconds >= 0 && Number.isFinite(seconds))) throw new Error(`cannot update by ${seconds} s`);
    this.pending += Math.min(seconds, MOST);
    // (1e-9: 1/30 is a hair under two sub-steps of 1/60 in floating point)
    const steps = Math.floor(this.pending / STEP + 1e-9);
    this.pending = Math.max(0, this.pending - steps * STEP);
    this.before[0].copy(this.frame.prev);
    this.before[1].copy(this.frame.prev2);
    for (const [node, carrier] of this.carried) {
      const before = this.movedBefore.get(node) ?? { position: new Vector3(), quaternion: new Quaternion() };
      before.position.copy(carrier.current.position);
      before.quaternion.copy(carrier.current.quaternion);
      this.movedBefore.set(node, before);
    }
    this.worn = wornOf(this);
    if (this.frame.dev) this.checkPlacement(this.frame.dev);
    try {
      this.stepping = true;
      for (let i = 0; i < steps; i++) {
        this.share = (i + 1) / steps;
        this.step();
      }
    } finally {
      this.stepping = false;
    }
    this.updates++;
    this.binding.write(this.pose);
  }

  /** the parent its object was first seen under, and whether development has said it moved or is not the world's frame */
  private parent: Object3D | null | undefined = undefined;
  private placed = false;

  /** development: its object stays where it was added (it is not mounted on anything), under a parent that is the world's frame */
  private checkPlacement(dev: Dev): void {
    const object = this.binding.object, parent = object.parent;
    if (this.placed) return;
    this.parent ??= parent;
    if (parent !== this.parent) {
      this.placed = true;
      dev.append(this.frame.time, { check: "the body's object was re-parented: add it once, where it stays", value: 1, limit: 0, where: parent?.name ?? 'nothing' });
      return;
    }
    if (!parent) return;
    parent.updateWorldMatrix(true, false);
    if (parent.matrixWorld.equals(IDENTITY)) return;
    this.placed = true;
    dev.append(this.frame.time, { check: "the body's object is under a moved, turned or scaled parent: add it to the world's frame", value: 1, limit: 0, where: parent.name });
  }

  beat(): string {
    return this.requests.map((request) => request.label).join(' ∥ ');
  }

  private step(): void {
    const { frame: f } = this, [prev2, prev, current] = this.poses;
    current.copy(prev);
    if (f.dev && f.time > 0) {
      checkLimits(f.prev, f.dev, f.time);
      this.snaps.check(f, f.dev);
    }
    f.time += f.dt;
    const behaviours = (this.behaviours ??= this.behave());
    // (balance first, on what was asked last sub-step; then the requests' staging, reading the body as balance has it now)
    behaviours.balance?.(f);
    // (its pose faces the way balance turned it before anything reads its object's frame: a place before it, a thing on it)
    current.facing = this.locomotion.facing;
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
    this.run('trunk', f);
    behaviours.hands?.(f);
    for (const hand of Object.keys(this.hands)) {
      if (this.owner(`hand.${hand}`)) this.run(`hand.${hand}`, f);
      else if (this.holding[hand]) behaviours.keep?.(f, hand);
    }
    behaviours.things?.(f);
    current.forward();
    this.poses = [prev, current, prev2];
    [f.prev2, f.prev, f.current] = this.poses;
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

/** the species' skeleton, its masses for a body of `mass` kg (a skin report's closed volume at 1000 kg/m³, kept within a sane range) */
function massed(species: AnySpecies, mass: SelfOptions['mass'], dev?: Dev): Skeleton {
  if (mass === undefined) return species.skeleton;
  const total = typeof mass === 'number' ? mass : volumeMass(species, mass, dev);
  if (!(total > 0 && Number.isFinite(total))) throw new Error(`a body of ${total} kg`);
  if (total === species.mass) return species.skeleton;
  const { skeleton } = species, share = total / species.mass;
  const chains = Object.fromEntries(skeleton.chainNames().map((name) => [name, skeleton.chain(name).map((bone) => skeleton.bones[bone].name)]));
  return new Skeleton(skeleton.bones.map((bone) => ({ ...bone, mass: bone.mass * share })), { limits: skeleton.limits.filter((limit) => limit !== undefined), chains });
}

/** a body's mass from a mesh's volume as `SelfOptions.mass` takes it */
function volumeMass(species: AnySpecies, report: Pick<SkinReport, 'closed' | 'volume'>, dev?: Dev): number {
  if (!report.closed || report.volume === null) {
    dev?.append(0, { check: "an open mesh's volume (its species' mass taken, kg)", value: species.mass, limit: 0, where: 'mass' });
    return species.mass;
  }
  const mass = report.volume * 1000, held = Math.min(2 * species.mass, Math.max(species.mass / 2, mass));
  if (held !== mass) dev?.append(0, { check: "a mesh's mass past half or twice its species' (kg)", value: mass, limit: held, where: 'mass' });
  return held;
}

/** the skeleton's rest pose standing `at` facing `face` */
function restPose(skeleton: Skeleton, at?: Vector3, face = 0): Pose {
  const pose = new Pose(skeleton), root = pose.position(0);
  pose.setRoot(new Vector3(at?.x ?? root.x, root.y + (at?.y ?? 0), at?.z ?? root.z));
  pose.setLocal(0, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), face).multiply(pose.local(0)));
  pose.facing = face;
  pose.forward();
  return pose;
}

/** development: a model's bones neither sheared nor scaled unevenly at rest, relative to the body (rig's own contract) */
function checkShear(binding: Binding, dev: Dev): void {
  binding.object.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(binding.object.matrixWorld).invert();
  // (a pose turns and moves bones, so each must rest as a turn, a move and one scale: its matrix what those recompose to, as rig checks it)
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
  for (const [name, node] of Object.entries(binding.bones)) {
    const rest = new Matrix4().multiplyMatrices(inverse, node.matrixWorld), position = new Vector3(), turn = new Quaternion(), scale = new Vector3();
    rest.decompose(position, turn, scale);
    const recomposed = new Matrix4().compose(position, turn, scale).elements;
    const even = close(Math.abs(scale.x), Math.abs(scale.y)) && close(Math.abs(scale.y), Math.abs(scale.z));
    if (!even || !rest.elements.every((x, k) => close(x, recomposed[k]))) dev.append(0, { check: 'a bone sheared or scaled unevenly at rest', value: 1, limit: 0, where: name });
  }
}

const IDENTITY = new Matrix4();
/** the longest frame an update takes (s): a body does not run on through a stall */
const MOST = 0.1;
/** how long a request may go unrenewed before development says its story stopped stepping (s) */
const STALE = 1;
const _local: Placement = { position: new Vector3(), quaternion: new Quaternion() };
const EMPTY: readonly LogEntry[] = Object.freeze([]);
