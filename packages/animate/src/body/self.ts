import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { Pose, type ReadonlyPose } from '../core/pose';
import { STEP, type Frame } from '../core/frame';
import { Dev, type LogEntry } from '../core/dev';
import { Skeleton } from '../core/skeleton';
import { checkLimits } from '../core/limits';
import { SnapChecks } from '../core/rotation';
import { createAsks, type Asks } from '../core/asks';
import { createLocomotion, type Locomotion } from '../core/legs/gait';
import type { Stepper } from '../core/legs/stepper';
import type { Gazer } from '../core/gaze';
import type { AnySpecies, Attention } from '../core/species';
import { Carrier } from '../core/carrier';
import type { Target } from '../core/goal';
import { yawOf } from '../core/math';
import { Binding } from './model';
import { anchors, resolve, type Interpolated, type Resolving } from './resolve';
import { rank, Request, type Channel, type Claim, type Staging } from './requests';
import type { Thing, Local } from './things';
import { bear, checkParents, wornOf, type Bearing } from './hold';
import { creature } from '../core/legs/creature';
import { keeping } from '../core/hands';

/** What a body's root does when the app drives it (a player's): where it is on the floor, its velocity, facing, crouch, steadiness, a leap. */
export interface Driven {
  /** its point on the floor (m) */
  position: Vector3;
  /** its velocity over the floor (m/s); default read off its moves */
  velocity?: Vector3;
  /** its facing (rad about +Y; 0 faces +Z) */
  yaw: number;
  /** how far it crouches (0 standing … 1 a deep crouch) */
  crouch?: number;
  /** how still it holds itself (0 at ease … 1 aiming): its breathing and sway fade by it */
  steady?: number;
  /** leap at this speed (m/s up) as soon as the feet can */
  jump?: number;
}

/** What a body's legs are asked by the scene and its quiet life: a seed, a tether, a startle. */
export interface Life extends Attention {
  /** fixes its variation: sway, breathing, weight shifts, glances */
  seed?: number;
}

/** How a body is made (`Body`'s options, as its runtime takes them). */
export interface SelfOptions {
  at?: Vector3;
  face?: number;
  drive?: (time: number) => Driven;
  life?: Life;
  tempo?: number;
  mass?: number | { readonly closed: boolean; readonly volume: number | null };
  model?: Object3D;
  dev?: boolean | { notes?: boolean };
}

/** What a hand holds: the thing, by which of its empties, and where the hand is on it (its goal in the thing's frame). */
export interface Hold {
  thing: Thing;
  grip: string;
  goal: Target;
}

/** one body part's behaviour this sub-step */
export type Step = (f: Frame) => void;

/**
 * A body as it moves: its pose history, what its story asks of it (requests on its parts) and the behaviours that serve them. Each
 * 1/60 s sub-step, in this order: balance (the legs and the trunk over them, as walks and reaches asked), the requests' staging, the
 * legs' and the trunk's asks for the next, the eyes, each hand, and the things it moves; then the final pose becomes the history:
 * current → prev → prev2.
 */
export class Self implements Resolving {
  readonly skeleton: Skeleton;
  readonly scale: number;
  /** how quick it is, all told (1: as tuned): its walks', reaches' and carries' paces */
  readonly tempo: number;
  readonly frame: Frame;
  /** the last final pose and the one before, as they were when its last update began: what others read while it is ahead of them */
  private readonly before: [Pose, Pose];
  private poses: [Pose, Pose, Pose];
  updates = 0;
  share = 0;
  readonly frames = new WeakMap<Object3D, Interpolated>();
  readonly asks: Asks = createAsks();
  readonly locomotion: Locomotion;
  /** its stepping legs, made with its balance */
  stepper: Stepper | null = null;
  readonly gazer?: Gazer;
  /** each hand's tip bone, by name */
  readonly hands: Readonly<Record<string, number>>;
  readonly holding: Record<string, Hold | null>;
  readonly binding: Binding;
  readonly drive?: (time: number) => Driven;
  readonly life: Life;
  /** the bodies it keeps clear of: those it has dealt with, either way, and those it was told to avoid */
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
  private behaviours: Behaviours | null = null;

  constructor(readonly species: AnySpecies, options: SelfOptions, start?: (skeleton: Skeleton) => Pose) {
    this.skeleton = massed(species, options.mass);
    this.scale = species.scale;
    this.tempo = options.tempo ?? 1;
    if (!(this.tempo > 0 && Number.isFinite(this.tempo))) throw new Error(`a tempo of ${this.tempo}`);
    this.gazer = species.gaze;
    this.drive = options.drive;
    this.life = options.life ?? {};
    const pose = start?.(this.skeleton) ?? standing(this.skeleton, options.at, options.face);
    this.locomotion = createLocomotion(pose.facing);
    this.hands = Object.fromEntries([...species.hands ?? []].map(([hand, chain]) => [hand, this.skeleton.chain(chain).slice(-1)[0]]));
    this.holding = Object.fromEntries(Object.keys(this.hands).map((hand) => [hand, null]));
    this.poses = [new Pose(this.skeleton).copy(pose), new Pose(this.skeleton).copy(pose), new Pose(this.skeleton).copy(pose)];
    this.before = [new Pose(this.skeleton).copy(pose), new Pose(this.skeleton).copy(pose)];
    this.frame = {
      dev: options.dev ? new Dev(typeof options.dev === 'object' && !!options.dev.notes) : undefined,
      dt: STEP,
      time: 0,
      prev2: this.poses[0],
      prev: this.poses[1],
      current: this.poses[2],
    };
    this.binding = new Binding(species, options.model);
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

  /** its behaviours (made on its first sub-step, once all it is has been made): a creature's legs and carriage, its jaw keeping hold */
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

  /** the last final pose */
  get pose(): ReadonlyPose {
    return this.frame.prev;
  }

  /** its root's turn about +Y (0 faces +Z) */
  get yaw(): number {
    return yawOf(this.pose.local(0));
  }

  /** the pose `reader` reads this body by: its own as posed so far; another's as it was before its update this frame, if it is ahead */
  poseFor(reader: Resolving): ReadonlyPose {
    if (reader === this) return this.frame.current;
    if (reader instanceof Self) {
      this.near.add(reader);
      reader.near.add(this);
    }
    return this.updates > reader.updates ? this.before[0] : this.frame.prev;
  }

  /** its final poses as `reader` reads them (`poseFor`): the last and the one before */
  posesFor(reader: Resolving): readonly [ReadonlyPose, ReadonlyPose] {
    return this.updates > reader.updates ? [this.before[0], this.before[1]] : [this.frame.prev, this.frame.prev2];
  }

  moved(node: Object3D): Local | null {
    const carrier = this.carried.get(node);
    return carrier ? carrier.at(this.frame.time).current : null;
  }

  restOf(bone: number): Readonly<Quaternion> {
    return this.binding.restOf(bone);
  }

  scaleOf(bone: number): number {
    return this.binding.scaleOf(bone);
  }

  /** stops moving `node` itself: it reads it on from there, its history (velocity, spin) carried over */
  leave(node: Object3D): void {
    const carrier = this.carried.get(node);
    if (!carrier) return;
    this.carried.delete(node);
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

  /** every claim of `channel` run, the one that has it last */
  private run(channel: Channel, f: Frame): void {
    const claims = this.claims.get(channel);
    if (claims) for (const claim of [...claims]) claim.step(f);
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
    // (a frame of more than 0.1 s is taken as 0.1 s: a body does not run on through a stall)
    this.pending += Math.min(seconds, MOST);
    // (1e-9: 1/30 is a hair under two sub-steps of 1/60 in floating point)
    const steps = Math.floor(this.pending / STEP + 1e-9);
    this.pending = Math.max(0, this.pending - steps * STEP);
    this.before[0].copy(this.frame.prev);
    this.before[1].copy(this.frame.prev2);
    this.worn = wornOf(this);
    if (this.frame.dev) this.checkPlacement(this.frame.dev);
    try {
      for (let i = 0; i < steps; i++) {
        this.share = (i + 1) / steps;
        this.step();
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`${this.frame.time.toFixed(3)} s, ${this.beat() || 'idle'}: ${message}`, { cause });
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

  private beat(): string {
    return this.requests.map((request) => request.label).join(' ∥ ');
  }

  private step(): void {
    const { frame: f } = this;
    const [prev2, prev, current] = this.poses;
    current.copy(prev);
    if (f.dev && f.time > 0) {
      checkLimits(f.prev, f.dev, f.time);
      this.snaps.check(f, f.dev);
    }
    f.time += f.dt;
    const behaviours = (this.behaviours ??= this.behave());
    // (balance first, on what was asked last sub-step; then the requests' staging, reading the body as balance has it now)
    behaviours.balance?.(f);
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
    this.run('go', f);
    behaviours.gaze?.(f);
    this.run('look', f);
    this.run('trunk', f);
    behaviours.hands?.(f);
    for (const hand of Object.keys(this.hands)) {
      if (this.holding[hand]) behaviours.keep?.(f, hand);
      this.run(`hand.${hand}`, f);
    }
    behaviours.things?.(f);
    current.facing = this.locomotion.facing;
    current.forward();
    this.poses = [prev, current, prev2];
    [f.prev2, f.prev, f.current] = this.poses;
  }
}

/** a body's behaviours, in the order they run each sub-step: balance, the eyes when nothing asks for them, the free hands, a holding
 * hand's keep, the things it moves */
export interface Behaviours {
  balance?: Step;
  gaze?: Step;
  hands?: Step;
  keep?: (f: Frame, hand: string) => void;
  things?: Step;
}

/** the species' skeleton, its masses for a body of `mass` kg (a skin report's closed volume at 1000 kg/m³, kept within a sane range) */
function massed(species: AnySpecies, mass: SelfOptions['mass']): Skeleton {
  if (mass === undefined) return species.skeleton;
  const total = typeof mass === 'number' ? mass : volumeMass(species, mass);
  if (!(total > 0 && Number.isFinite(total))) throw new Error(`a body of ${total} kg`);
  if (total === species.mass) return species.skeleton;
  const { skeleton } = species, share = total / species.mass;
  const chains = Object.fromEntries(skeleton.chainNames().map((name) => [name, skeleton.chain(name).map((bone) => skeleton.bones[bone].name)]));
  return new Skeleton(skeleton.bones.map((bone) => ({ ...bone, mass: bone.mass * share })), { limits: skeleton.limits.filter((limit) => limit !== undefined), chains });
}

/** a body's mass from a closed mesh's volume, held within half and twice the species' own */
function volumeMass(species: AnySpecies, report: { closed: boolean; volume: number | null }): number {
  if (!report.closed || report.volume === null) return species.mass;
  return Math.min(2 * species.mass, Math.max(species.mass / 2, report.volume * 1000));
}

/** the skeleton's rest pose standing `at` facing `face` */
function standing(skeleton: Skeleton, at?: Vector3, face = 0): Pose {
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
  for (const [name, node] of Object.entries(binding.bones)) {
    const rest = new Matrix4().multiplyMatrices(inverse, node.matrixWorld), position = new Vector3(), turn = new Quaternion(), scale = new Vector3();
    rest.decompose(position, turn, scale);
    const spread = Math.max(scale.x, scale.y, scale.z) / Math.min(scale.x, scale.y, scale.z) - 1;
    const sheared = !new Matrix4().compose(position, turn, scale).equals(rest) && rest.elements.some((x, k) => Math.abs(x - new Matrix4().compose(position, turn, scale).elements[k]) > 1e-6);
    if (spread > 1e-6 || sheared) dev.append(0, { check: 'a bone sheared or scaled unevenly at rest (spread)', value: spread, limit: 0, where: name });
  }
}

const IDENTITY = new Matrix4();
/** the longest frame an update takes (s) */
const MOST = 0.1;
/** how long a request may go unrenewed before development says its story stopped stepping (s) */
const STALE = 1;
const EMPTY: readonly LogEntry[] = Object.freeze([]);
const _local: Local = { position: new Vector3(), quaternion: new Quaternion() };
