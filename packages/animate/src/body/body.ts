import { Vector3, type Group, type Object3D, type Quaternion } from 'three';
import type { ReadonlyPose } from '../kernel/pose';
import type { LogEntry } from '../kernel/dev';
import type { AnySpecies, Species } from '../species/define';
import { Person } from './person';
import { Self, type SelfOptions } from './runtime';
import { Binding } from './model';
import { handsOn } from '../things/hold';
import { Thing } from '../things/thing';
import type { Channel, Tier } from '../kernel/requests';
import type { Fingers } from '../fingers/shape';

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

/** What each of a body's parts is doing, by part: the legs (`go`), the eyes (`look`), the trunk's posture (`trunk`), the head's turn over
 * the eyes (`head`) and each hand. */
export interface Owners {
  go?: Owner;
  look?: Owner;
  trunk?: Owner;
  head?: Owner;
  hands: Partial<Record<string, Owner>>;
}

/** A foot as it stands or, swinging, where it lands. A planted foot turning on the spot pivots about its sole's middle, between heel and
 * toe, so its ankle shifts a little. */
export interface Foot {
  /** its ankle, standing flat on the floor there */
  position: Vector3;
  /** which way it points (rad about +Y) */
  yaw: number;
  planted: boolean;
}

/**
 * A body of a species: a person (`humanoid(skeleton)`) or a creature (`horse(skeleton)`, `dog(skeleton)`, `species(…)`). Asked nothing,
 * it lives: a person, or a creature with a carriage or a posture of its own, stands, breathes and looks about; any other creature stands
 * still but for its lean into its acceleration (`inertia`). Add `object` to your scene and call `update(seconds)` every frame; your stories move it
 * with the verbs (`walkTo`, `grab`, …), run on your own timeline runner.
 */
export class Body<S extends AnySpecies = AnySpecies> {
  /** a group on the floor under the body's root, turned by its facing alone, holding its model: add it to your scene (and move it only
   * through the body) */
  readonly object: Group;
  /** its bones by name: the very bones its model was rigged with, or library objects in a bare body's place — parent empties to them */
  readonly bones: Readonly<Record<BoneOf<S>, Object3D>>;

  /** Rejects creature legs that cannot step within their joint ranges with the sole on the floor. */
  constructor(readonly species: S, options: BodyOptions = {}) {
    const { avoid, ...rest } = options, binding = new Binding(species, rest.model);
    const self = species.person ? new Person(species, rest, binding) : new Self(species, rest, binding);
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

  /** Keeps `node` — something on the body, such as the mount of a rifle on its chest — turned to `rotation` in the world, its position
   * following its parent: read so as its hands take hold of what hangs from it, each sub-step, after the trunk is posed; `null` lets it go.
   * Set it before each `update`; the node's own rotation is written to match as the update ends. */
  orient(node: Object3D, rotation: Readonly<Quaternion> | null): void {
    selfOf(this).orient(node, rotation);
  }

  /**
   * Eases hand `side`'s fingers `seconds` on toward `to` and writes them, for a body its app poses itself (a puppet, its bones turned by
   * hand; a body its update poses does this itself, and the two would fight): the empty the hand is on or on its way to — a grip, as a
   * thing's are named, its thing the empty's parent — opening the hand as it comes and closing it round the thing's meshes once the wrist
   * is where `gripOn` puts it, the empty's `userData.fingers` laid over that as over a grabbed grip; a shape (`Fingers`; `FIST`, `POINT`,
   * …); or relaxed for `null`. Call it each frame after posing the hand.
   */
  fingers(side: 'left' | 'right', to: Fingers | Object3D | null, seconds: number): void {
    fingersOf(this).set(side, to, seconds);
  }

  /**
   * Where hand `side`'s bone goes to hold `empty` — a grip, its thing the empty's parent — for a body its app poses itself: its wrist and
   * its bone's rotation (world), the part of the hand the grip names on the empty as a grab would put it (`Thing.grip`: the palm, a
   * handle across it, or a digit's pad). The hand is turned from its turn now by the least turn that lays a handle along its grasp and
   * faces the palm (or the pad) as the grip's `facing` asks; with a handle and a `facing`, exactly so.
   */
  gripOn(side: 'left' | 'right', empty: Object3D): { wrist: Vector3; rotation: Quaternion } {
    return fingersOf(this).gripOn(side, empty);
  }

  /** A world-space impulse (N·s) at a world-space point: a humanoid's supported torso reacts and recovers before its hands are solved.
   * Locomotion or the physics controller continues to own the root. */
  applyImpulse(impulse: Readonly<Vector3>, point: Readonly<Vector3>): void {
    const self = selfOf(this);
    if (!(self instanceof Person)) throw new Error('applyImpulse: supported torso reactions require a humanoid');
    self.impact.apply(self.pose, impulse, point);
  }

  /** its root's point on the floor (m; its y the floor's height there): a person's hips, which sway several centimetres over planted feet,
   * so judge where a body stands by its `feet` */
  get position(): Vector3 {
    const root = this.pose.position(0);
    return new Vector3(root.x, selfOf(this).floor(root.x, root.z), root.z);
  }

  /** its ground velocity: its centre of mass's over the last sub-step, horizontal (m/s) */
  get velocity(): Vector3 {
    const self = selfOf(this), [prev, prev2] = reader ? self.posesFor(reader) : [self.frame.prev, self.frame.prev2];
    return prev.com(new Vector3()).sub(prev2.com(new Vector3())).divideScalar(self.frame.dt).setY(0);
  }

  /** the way it faces (rad about +Y; 0 faces +Z) */
  get facing(): number {
    return this.pose.facing;
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

  /** its feet, as they stand or, swinging, where they land (none before its first `update`) */
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
    return { go: owner('go'), look: owner('look'), trunk: owner('trunk'), head: owner('head'), hands: Object.fromEntries(hands) };
  }

  /** its last final pose: bone rotations and positions by index, its centre of mass, what its bones carry
   * As the body updating now reads it. */
  get pose(): ReadonlyPose {
    const self = selfOf(this);
    return reader && reader !== self ? self.poseFor(reader) : self.pose;
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

/** the fingers of `body`; a skeleton without finger bones has none, a misuse said at once */
function fingersOf(body: Body): NonNullable<Self['fingers']> {
  const fingers = selfOf(body).fingers;
  if (!fingers) throw new Error(`fingers: a ${body.species.name ?? 'custom species'} skeleton has no finger bones`);
  return fingers;
}

/** the runtime of `body` */
export function selfOf(body: Body): Self {
  const self = selves.get(body);
  if (!self) throw new Error('not a body made with new Body');
  return self;
}

/** the body updating now, if any: while it does, another body's state reads as it was before that body's own update this frame */
let reader: Self | null = null;
