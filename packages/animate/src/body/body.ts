import { Vector3, type Group, type Object3D } from 'three';
import type { ReadonlyPose } from '../kernel/pose';
import type { LogEntry } from '../kernel/dev';
import type { AnySpecies, Species } from '../species/define';
import { Person } from './person';
import { Self, type SelfOptions } from './runtime';
import { Binding } from './model';
import { handsOn } from '../things/hold';
import { Thing } from '../things/thing';
import type { Channel, Tier } from '../kernel/requests';

/** How a body is made: as its runtime takes it, and the bodies it keeps clear of besides those it deals with (bystanders; one shared
 * set works for a crowd). It keeps clear of bodies only, never of props: the scene's places say where it stands. */
export type BodyOptions = SelfOptions & { avoid?: Iterable<Body> };

/** the names of a species' bones */
type BoneOf<S extends AnySpecies> = S extends Species<infer Bone, string> ? Bone : never;
/** something for some of a species' hands, by name; for a species without hands `never`, so a verb for hands is a type error */
export type ByHand<S extends AnySpecies, T> = S extends Species<string, infer Hand> ? [Hand] extends [never] ? never : Partial<Record<Hand, T>> : never;

/** What holds one of a body's parts: the verb, where the story asked for it and how firmly (borrowed: needed, not asked). */
export interface Owner {
  verb: string;
  site: string;
  tier: Tier;
}

/** What each of a body's parts is doing, by part: the legs (`go`), the eyes (`look`), the trunk's turn (`trunk`) and each hand. */
export interface Owners {
  go?: Owner;
  look?: Owner;
  trunk?: Owner;
  hands: Partial<Record<string, Owner>>;
}

/** A foot as it stands or, swinging, where it lands. */
export interface Foot {
  position: Vector3;
  /** which way it points (rad about +Y) */
  yaw: number;
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

  /** Rejects creature legs that cannot step within their joint ranges with the sole on the floor. */
  constructor(readonly species: S, options: BodyOptions = {}) {
    const { avoid, ...rest } = options, binding = new Binding(species, rest.model);
    const self = species.person ? new Person(species, rest, binding) : new Self(species, rest, binding);
    if (!species.person) self.initialize();
    selves.set(this, self);
    for (const body of avoid ?? []) self.near.add(selfOf(body));
    this.object = binding.object;
    this.bones = binding.bones;
  }

  /** Advances by `seconds` (at most 0.1 s), keeping incomplete 1/60 s sub-steps for next time.
   * Errors include species, `object.name` when set, simulation time and running verbs, preserving the original error as `cause`. */
  update(seconds: number): void {
    const self = selfOf(this), was = reader;
    // (its reads of other bodies' state go by the rule `reader` gives)
    reader = self;
    try {
      self.update(seconds);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const name = this.object.name ? ` "${this.object.name}"` : '';
      throw new Error(`${this.species.name ?? 'custom species'}${name}, ${self.time.toFixed(3)} s, ${self.beat() || 'idle'}: ${message}`, { cause });
    } finally {
      reader = was;
    }
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
    return (selfOf(this).stepper?.legs ?? []).map((leg) => ({ position: leg.anchor.clone(), yaw: leg.yaw, planted: !leg.swing }));
  }

  /** whether any of its hands holds `thing` */
  holds(thing: Object3D): boolean {
    return handsOn(selfOf(this), Thing.of(thing)).length > 0;
  }

  /** what holds each of its parts now: the newest asked verb, else the first borrower */
  get owners(): Owners {
    const self = selfOf(this);
    const owner = (channel: Channel): Owner | undefined => {
      const claim = self.owner(channel);
      return claim && { verb: claim.request.verb, site: claim.request.site, tier: claim.tier };
    };
    const hands = Object.keys(self.hands).flatMap((hand) => {
      const held = owner(`hand.${hand}`);
      return held ? [[hand, held]] : [];
    });
    return { go: owner('go'), look: owner('look'), trunk: owner('trunk'), hands: Object.fromEntries(hands) };
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

/** `body`'s last final pose as the body updating now reads it */
function read(body: Body): ReadonlyPose {
  const self = selfOf(body);
  return reader && reader !== self ? self.poseFor(reader) : self.pose;
}
