import { Vector3, type Group, type Object3D } from 'three';
import type { SkeletonBone } from '@drawcall/rig';
import type { ReadonlyPose } from '../core/pose';
import type { LogEntry } from '../core/dev';
import type { AnySpecies, Species } from '../core/species';
import { Person } from '../humanoid/person';
import { Self, type Driven, type Life, type SelfOptions } from './self';
import { handsOn } from './hold';
import { Thing } from './things';
import type { Tier } from './requests';

/** How a body is made. */
export interface BodyOptions {
  /** where it stands on the floor (default the origin) */
  at?: Vector3;
  /** the way it faces (rad about +Y; 0 faces +Z) */
  face?: number;
  /** its root driven by the app (a player's), read every sub-step with the body's time (s): its legs keep up, and nothing borrows them */
  drive?: (time: number) => Driven;
  /** the bodies it keeps clear of besides those it deals with (bystanders; one shared set works for a crowd) */
  avoid?: Iterable<Body>;
  /** its quiet life: a seed that fixes its variation, what tethers it and what startles it */
  life?: Life;
  /** how quick it is, all told (1: as tuned; 1.2: a fifth quicker): its walks', reaches' and carries' paces */
  tempo?: number;
  /** what it weighs (kg), or a closed mesh's volume as @drawcall/rig's skin report gives it (at 1000 kg/m³); default its species' */
  mass?: number | { readonly closed: boolean; readonly volume: number | null };
  /** the container its mesh was rigged in with @drawcall/rig (`skin(model, skeleton)`): the body poses its bones; without it, the body is bare */
  model?: Object3D;
  /** checks final poses and records problems in `log`; `{ notes: true }` also records what is only reported (a player-driven body's balance) */
  dev?: boolean | { notes?: boolean };
}

/** the names of a species' bones */
export type BoneOf<S extends AnySpecies> = S extends Species<infer Bone, string> ? Bone : never;
/** the names of a species' hands */
export type HandOf<S extends AnySpecies> = S extends Species<string, infer Hand> ? Hand : never;

/** What holds one of a body's parts: the verb, where the story asked for it and how firmly (borrowed: needed, not asked). */
export interface Goal {
  verb: string;
  site: string;
  tier: Tier;
}

/** What each of a body's parts is doing, by part: the legs (`go`), the eyes (`look`), the trunk's turn (`trunk`) and each hand. */
export interface Goals {
  go?: Goal;
  look?: Goal;
  trunk?: Goal;
  hands: Partial<Record<string, Goal>>;
}

/** A foot as it stands or, swinging, where it lands. */
export interface Foot {
  position: Vector3;
  planted: boolean;
}

/**
 * A body of a species: a person (`humanoid(skeleton)`) or a creature (`horse(skeleton)`, `dog(skeleton)`, `species(…)`). Asked nothing,
 * it lives: it stands, breathes, looks about. Add `object` to your scene and call `update(seconds)` every frame; your stories move it
 * with the verbs (`walkTo`, `grab`, …), run on your own timeline runner.
 */
export class Body<S extends AnySpecies = AnySpecies> {
  /** a group on the floor, turned by the body's facing alone, holding its model: add it to your scene (and move it only through the body) */
  readonly object: Group;
  /** its bones by name: the very bones its model was rigged with, or library objects in a bare body's place — parent empties to them */
  readonly bones: Readonly<Record<BoneOf<S>, Object3D>>;

  constructor(readonly species: S, options: BodyOptions = {}) {
    const { avoid, ...rest } = options;
    const made: SelfOptions = rest;
    const self = species.person ? new Person(species, made) : new Self(species, made);
    selves.set(this, self);
    for (const body of avoid ?? []) self.near.add(selfOf(body));
    this.object = self.binding.object;
    this.bones = bonesOf(self.binding.bones, species.bones);
  }

  /** advances it by `seconds` (a frame's time; at most 0.1 s is taken): every whole 1/60 s sub-step it covers, the rest kept for the next */
  update(seconds: number): void {
    const self = selfOf(this);
    reading(self, () => self.update(seconds));
  }

  /** where it stands: its root over the floor (m) */
  get position(): Vector3 {
    const root = read(this).position(0);
    return new Vector3(root.x, 0, root.z);
  }

  /** its ground velocity: its centre of mass's over the last sub-step, horizontal (m/s) */
  get velocity(): Vector3 {
    const self = selfOf(this), [prev, prev2] = reader ? self.posesFor(reader) : [self.frame.prev, self.frame.prev2];
    return prev.com(new Vector3()).sub(prev2.com(new Vector3())).divideScalar(self.frame.dt).setY(0);
  }

  /** the way it faces (rad about +Y; 0 faces +Z) */
  get facing(): number {
    return read(this).facing;
  }

  /** come to rest: no walk under way, its feet planted a while and none wanting to step */
  get settled(): boolean {
    return selfOf(this).locomotion.settled;
  }

  /** off the floor: a leap's flight */
  get airborne(): boolean {
    return selfOf(this).stepper?.airborne ?? false;
  }

  /** its stride: its phase (rad), how far it walks (0 standing … 1 walking) and runs (0 … 1) */
  get gait(): { readonly phase: number; readonly walk: number; readonly run: number } {
    const { phase, walk, run } = selfOf(this).locomotion;
    return { phase, walk, run };
  }

  /** its feet, as they stand or, swinging, where they land */
  get feet(): readonly Foot[] {
    const self = selfOf(this);
    if (self instanceof Person) return self.feet.map((foot) => ({ position: foot.position.clone(), planted: foot.phase === 'planted' }));
    return (self.stepper?.legs ?? []).map((leg) => ({ position: leg.anchor.clone(), planted: !leg.swing }));
  }

  /** whether any of its hands holds `thing` */
  holds(thing: Object3D): boolean {
    return handsOn(selfOf(this), Thing.of(thing)).length > 0;
  }

  /** what holds each of its parts now: the newest asked verb, else the first borrower */
  get goals(): Goals {
    const self = selfOf(this);
    const goal = (channel: Parameters<Self['owner']>[0]): Goal | undefined => {
      const claim = self.owner(channel);
      return claim && { verb: claim.request.verb, site: claim.request.site, tier: claim.tier };
    };
    return {
      go: goal('go'),
      look: goal('look'),
      trunk: goal('trunk'),
      hands: Object.fromEntries(Object.keys(self.hands).flatMap((hand) => {
        const held = goal(`hand.${hand}`);
        return held ? [[hand, held]] : [];
      })),
    };
  }

  /** its last final pose: bone rotations and positions by index, its centre of mass, what its bones carry */
  get pose(): ReadonlyPose {
    return read(this);
  }

  /** development problems (empty with dev off): each check that failed, by when and while which verbs ran */
  get log(): readonly LogEntry[] {
    return selfOf(this).log;
  }

  /** what development only reports (`dev: { notes: true }`) */
  get notes(): readonly LogEntry[] {
    return selfOf(this).notes;
  }
}

const selves = new WeakMap<Body, Self>();

/** the runtime of `body` */
export function selfOf(body: Body): Self {
  const self = selves.get(body);
  if (!self) throw new Error('not a body made with new Body');
  return self;
}

/** the body updating now, if any: while it does, another body's state reads as it was before that body's own update this frame */
let reader: Self | null = null;

/** runs `update` as `self`'s update: its reads of other bodies' state go by the rule above */
export function reading(self: Self, update: () => void): void {
  const was = reader;
  reader = self;
  try {
    update();
  } finally {
    reader = was;
  }
}

/** `body`'s last final pose as the body updating now reads it */
function read(body: Body): ReadonlyPose {
  const self = selfOf(body);
  return reader && reader !== self ? self.poseFor(reader) : self.pose;
}

/** the bones by name, checked to be every one the skeleton names */
function bonesOf<Name extends string>(bones: Readonly<Record<string, Object3D>>, names: readonly SkeletonBone<Name>[]): Readonly<Record<Name, Object3D>> {
  if (complete(bones, names)) return bones;
  const missing = names.filter(({ name }) => !(name in bones)).map(({ name }) => name);
  throw new Error(`the model has no bone named ${missing.join(', ')} (rig it with this skeleton: skin(model, skeleton))`);
}

function complete<Name extends string>(bones: Readonly<Record<string, Object3D>>, names: readonly SkeletonBone<Name>[]): bones is Readonly<Record<Name, Object3D>> {
  return names.every(({ name }) => name in bones);
}
