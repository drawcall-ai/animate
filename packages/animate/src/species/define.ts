import { Quaternion, Vector3 } from 'three';
import type { SkeletonBone } from '@drawcall/rig';
import type { Inertial } from '../kernel/inertia';
import type { Gait } from './gait';
import type { CarriedBones, Striding } from './carriage';
import type { JointCycle } from './cycle';
import type { LegChain } from './leg';
import type { Frame } from '../kernel/frame';
import type { ReadonlyPose } from '../kernel/pose';
import { Skeleton, type BoneDef, type Limit } from '../kernel/skeleton';
import type { Proportions } from './humanoid/proportions';

/** What looks: a chain of the skeleton from the neck's base up to the head, and where its eyes are. */
export interface Gazer {
  /** the chain that turns the head; without one, the species' posture turns it toward where the eyes are asked (`look`) */
  neck?: string;
  /** the point the eyes look from (world), into `out` */
  eyes(pose: ReadonlyPose, out: Vector3): Vector3;
  /** how far the eyes turn in the head comfortably (rad): what a head short of its target leaves them */
  range: { down: number; up: number; side: number };
  /** Comfortable cervical flexion (rad); unbounded for a chain without a posture preference. */
  pitch?: number;
}

/** A point as a skeleton writes it: [x, y, z] (m; +Y up, the body facing +Z, its left +X). */
export type Vec3 = readonly [number, number, number];

/** the names of a skeleton's bones */
export type BoneNames<S extends readonly SkeletonBone[]> = S[number]['name'];

/** a skeleton that names every bone in `Needed`; else a type error naming the bones it lacks */
export type Having<S extends readonly SkeletonBone[], Needed extends string> =
  [Exclude<Needed, BoneNames<S>>] extends [never] ? unknown : { missingBones: Exclude<Needed, BoneNames<S>> };

/**
 * What kind of body it is: its skeleton as written (`bones`, the names `Bone`) and as it moves (`skeleton`: the bones its roles use,
 * each with its mass, centre, range and chains), how it looks about, the bones it holds things with (`Hand`: their names), its legs.
 */
export interface Species<Bone extends string = string, Hand extends string = string> {
  /** the skeleton as written: every bone, by name, where it stands at rest (model space) */
  readonly bones: readonly SkeletonBone<Bone>[];
  /** the bones that move, parents first, the species' root first: masses at `mass` kg in all, ranges, chains */
  readonly skeleton: Skeleton;
  /**
   * each moving bone's turn from how it moves at rest (its straight limbs: a T-pose) onto how the skeleton stands (an A-pose's arms
   * down, a knee a little bent), by name; a bone not named stands as it moves (no turn)
   */
  readonly turns: ReadonlyMap<string, Quaternion>;
  /** its neck and eyes, for `lookAt` and the gazes built on it */
  readonly gaze?: Gazer;
  /** its hands (or a jaw), by name: the chain each reaches with, the hand its tip */
  readonly hands?: ReadonlyMap<Hand, string>;
  /** its legs, their gait and what the gait carries over them — or a posture of its own, written in their place */
  readonly legs?: {
    readonly chains: readonly LegChain[];
    readonly gait: Gait;
    readonly carriage?: CarriedBones;
    readonly posture?: (start: ReadonlyPose, gait: Gait, seed?: number) => Posture;
  };
  /** how its trunk takes its root's acceleration (none: it does not lean) */
  readonly inertia?: Inertial;
  /** its size against the body its distances were tuned for */
  readonly scale: number;
  /** what it weighs in all (kg), as its bones' masses add up */
  readonly mass: number;
  /** a person's measures, if it is one */
  readonly person?: Proportions;
}

/** Any species, whatever its names. */
export type AnySpecies = Species<string, string>;

/** What a creature heeds as it stands and walks besides what it looks at: a tether it is tied by, a startle (a new point each time). */
export interface Attention {
  tether?: (time: number) => { position: Readonly<Vector3>; length: number } | undefined;
  startle?: (time: number) => Readonly<Vector3> | undefined;
}

/** What a body's legs are asked by the scene and its quiet life: a seed, a tether, a startle. */
export interface Temperament extends Attention {
  /** fixes its variation: sway, breathing, weight shifts, glances */
  seed?: number;
}

/** A species' posture over its legs, written each sub-step before the legs step, its head toward `look` (what `lookAt` asks) if any. */
export interface Posture { prepare(f: Frame, legs: Striding, attention: Attention, look: Readonly<Vector3> | null): void }

/** A joint's range of motion, as `Limit` has it, for a bone named so. */
export type Range = Omit<Limit, 'bone'>;

/** A leg by its bones' names, as `LegChain` has it by their indices: each joint top first, the last the foot. */
export interface LegRole<Name extends string> {
  joints: readonly { bone: Name; axes: string; cycle?: JointCycle }[];
  heel: Vec3;
  toe: Vec3;
  toes?: { bone: Name; tip: Vec3 };
  toeOut?: number;
  rocker?: LegChain['rocker'];
}

/**
 * What each of a species' bones does, by name: the `root` it moves from (default the skeleton's), its `legs` (fore-left, fore-right,
 * hind-left, hind-right for four), the `gaze` (a neck chain from its base to the head, and the eyes on a bone), its `hands` (a chain
 * each, from its first joint to the hand or jaw), and the `carriage` its gait carries over its legs.
 */
export interface Roles<Name extends string, Hand extends string> {
  root?: Name;
  legs?: readonly LegRole<Name>[];
  gaze?: { neck?: readonly Name[]; eyes: { bone: Name; at: Vec3 }; range: Gazer['range']; pitch?: number };
  hands?: Readonly<Record<Hand, readonly Name[]>>;
  carriage?: CarriedBones;
}

/**
 * A species' numbers: its legs' `gait`; each bone's mass (kg; a bone not named has none) and where it centres (an offset from its joint, or
 * a share of the way to another bone's joint; default its joint); each joint's range; the trunk's `inertia`; development snap ceilings.
 */
export interface Tuning<Name extends string> {
  gait?: Gait;
  masses?: Partial<Record<Name, number>>;
  centres?: Partial<Record<Name, Vec3 | readonly [toward: Name, share: number]>>;
  limits?: Partial<Record<Name, Range>>;
  inertia?: Inertial;
  snaps?: Partial<Record<Name, { speed: number; accel: number }>>;
}

/**
 * A species of a skeleton (as rigged with @drawcall/rig: names, parents, rest positions) whose bones do what `roles` says, as fast and as
 * heavy as `tuning` has it. Every bone under the root moves, each turning from its rest; bones a role leaves out follow their parents.
 * Write the skeleton `as const` and the roles' names are checked.
 */
export function species<const S extends readonly SkeletonBone[], Hand extends string = never>(
  skeleton: S,
  roles: Roles<BoneNames<S>, Hand>,
  tuning: Tuning<BoneNames<S>> = {},
): Species<BoneNames<S>, Hand> {
  return { ...build(skeleton, roles, tuning), bones: skeleton };
}

/** a species of `skeleton` as `species` makes it, but for its bones (the caller types them) */
export function build<Hand extends string>(skeleton: readonly SkeletonBone[], roles: Roles<string, Hand>, tuning: Tuning<string>): Omit<Species<string, Hand>, 'bones'> {
  const order = descendants(skeleton, roles.root);
  const at = new Map(skeleton.map((bone) => [bone.name, new Vector3(...bone.position)]));
  const point = (name: string) => need(at.get(name), name);
  const names = order.map((bone) => bone.name);
  const index = (name: string) => {
    const i = names.indexOf(name);
    if (i < 0) throw new Error(`species: no moving bone "${name}" (the root's descendants: ${names.join(', ')})`);
    return i;
  };
  const centreOf = (name: string): Vector3 => {
    const centre = tuning.centres?.[name];
    if (centre === undefined) return new Vector3();
    if (isVec3(centre)) return new Vector3(...centre);
    const [toward, share] = centre;
    return point(toward).clone().sub(point(name)).multiplyScalar(share);
  };
  const bones: BoneDef[] = order.map((bone, i) => {
    const parent = i === 0 ? -1 : index(need(bone.parent, bone.name));
    const offset = parent < 0 ? point(bone.name).clone() : point(bone.name).clone().sub(point(names[parent]));
    const mass = tuning.masses?.[bone.name] ?? 0;
    if (!(mass >= 0 && Number.isFinite(mass))) throw new Error(`species: bone "${bone.name}" weighs ${mass} kg`);
    return { name: bone.name, parent, offset, mass, com: centreOf(bone.name), snap: tuning.snaps?.[bone.name] };
  });
  const limits = Object.entries<Range | undefined>(tuning.limits ?? {}).flatMap(([name, range]) => range ? [{ ...range, bone: index(name) }] : []);
  const chains: Record<string, readonly string[]> = {};
  if (roles.gaze?.neck) chains.neck = roles.gaze.neck;
  for (const [hand, chain] of Object.entries<readonly string[]>(roles.hands ?? {})) chains[hand] = chain;
  const built = new Skeleton(bones, { limits, chains });
  const gaze = roles.gaze;
  const eyes = gaze && { bone: built.index(gaze.eyes.bone), at: new Vector3(...gaze.eyes.at) };
  if (roles.legs && !tuning.gait) throw new Error('species: legs need a gait');
  const hands = new Map<Hand, string>();
  for (const hand in roles.hands) hands.set(hand, hand);
  return {
    skeleton: built,
    turns: new Map(),
    gaze: gaze && eyes && {
      neck: gaze.neck ? 'neck' : undefined,
      eyes: (pose, out) => pose.point(eyes.bone, eyes.at, out),
      range: gaze.range,
      pitch: gaze.pitch,
    },
    hands: roles.hands && hands,
    legs: roles.legs && tuning.gait && {
      chains: roles.legs.map((leg): LegChain => ({
        joints: leg.joints.map(({ bone, axes, cycle }) => ({ bone: built.index(bone), axes, cycle })),
        heel: new Vector3(...leg.heel),
        toe: new Vector3(...leg.toe),
        toes: leg.toes && { bone: built.index(leg.toes.bone), tip: new Vector3(...leg.toes.tip) },
        toeOut: leg.toeOut ?? 0,
        rocker: leg.rocker ?? [[0, 0], [1, 0]],
      })),
      gait: tuning.gait,
      carriage: roles.carriage,
    },
    inertia: tuning.inertia,
    scale: 1,
    mass: bones.reduce((sum, bone) => sum + bone.mass, 0),
  };
}

/**
 * the bones under `root` (default the skeleton's one root) and it, parents first: in the order the skeleton lists them if it lists them
 * so, else level by level; throws on a skeleton that is no tree under it
 */
function descendants<B extends SkeletonBone>(skeleton: readonly B[], root?: string): B[] {
  const roots = skeleton.filter((bone) => bone.parent === undefined);
  if (roots.length !== 1) throw new Error(`a skeleton has one root, not ${roots.length}`);
  const top = root ?? roots[0].name;
  const start = skeleton.find((bone) => bone.name === top);
  if (!start) throw new Error(`no bone "${top}" in the skeleton`);
  const levels: B[] = [start];
  for (let k = 0; k < levels.length; k++) {
    for (const bone of skeleton) if (bone.parent === levels[k].name) levels.push(bone);
    if (levels.length > skeleton.length) throw new Error('a skeleton whose parents loop');
  }
  const listed = skeleton.filter((bone) => levels.includes(bone));
  const parentsFirst = listed.every((bone, i) => bone === start || listed.slice(0, i).some((before) => before.name === bone.parent));
  return parentsFirst && listed[0] === start ? listed : levels;
}

/** `skeleton`, checked to name every bone in `needed` (a species' roles name them): throws, naming those it lacks */
export function needing(skeleton: readonly SkeletonBone[], needed: readonly string[], kind: string): void {
  const missing = needed.filter((name) => !skeleton.some((bone) => bone.name === name));
  if (missing.length) throw new Error(`${kind}: the skeleton has no bone named ${missing.join(', ')}`);
}

const isVec3 = (value: Vec3 | readonly [string, number]): value is Vec3 => typeof value[0] === 'number';

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`species: bone "${what}" has no parent or position`);
  return value;
}
