import { Quaternion, Vector3, type Group, type Object3D } from 'three';
import { INDEX } from '../species/humanoid/bones';
import type { ReadonlyPose } from '../kernel/pose';
import type { LogEntry } from '../kernel/dev';
import type { AnySpecies, Species } from '../species/define';
import { Person } from './person';
import { Self, type SelfOptions } from './runtime';
import { Binding } from './model';
import { handsOn } from '../things/hold';
import { Thing } from '../things/thing';
import type { Channel, Tier } from '../kernel/requests';

/** How a body is made. It keeps clear of the bodies it deals with, never of things: the scene's places say where it stands. */
export type BodyOptions = SelfOptions;

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
    const binding = new Binding(species, options.model);
    selves.set(this, species.person ? new Person(species, options, binding) : new Self(species, options, binding));
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
   * following its parent, as far as the hands holding what hangs from it hold it there (turned faster than the body follows, it waits for
   * the trunk rather than leaving the hands): read so as its hands take hold of what hangs from it, each sub-step, after the trunk is
   * posed; `null` lets it go: it rides its parent (the chest) from the turn it was last given, and the hands on what hangs from it hold it
   * there.
   * Set it before each `update`; the node's own rotation is written to match as the update ends. With no hand on what hangs from it, it
   * simply turns as asked. */
  orient(node: Object3D, rotation: Readonly<Quaternion> | null): void {
    selfOf(this).orient.set(node, rotation);
  }

  /**
   * A point for a person's hand `side`, scaled to its body: out from its shoulder (the upper arm's joint) along `direction` (the body's
   * frame as it stands: +X its left, +Y up, +Z ahead) `share` of its arm's length (`species.person.armLength`): 0.5 a thing held up
   * before the chest, the elbow tucked (a ready hold); 0.75 a comfortable reach; 0.9 all but straight, held out before the face. Past
   * about 0.8, and behind the shoulder, the joints' ranges may hold the hand a little short (a carry there ends once it has stopped
   * closing, within 1.5 cm of it). A carry keeps what it holds out of the trunk and head, sized by the body's height: on a body
   * whose arms are far shorter than a person's for its height, a point close before it may lie within them, and a carry there fails. Read
   * where the body stands now: as a hand verb's target, give it as a function so it moves with the body,
   * `() => body.armPoint('right', ahead, 0.8)`. A point keeps a carried thing turned as the hand holds it; to turn it too, carry it to an
   * empty turned so (parented to `object`, it moves with the body).
   */
  armPoint(side: 'left' | 'right', direction: Readonly<Vector3>, share: number): Vector3 {
    const person = this.species.person;
    if (!person) throw new Error(`armPoint: a ${this.species.name ?? 'custom species'} has no arms`);
    const pose = poseOf(this), turn = new Quaternion().setFromAxisAngle(UP, pose.facing);
    return direction.clone().normalize().applyQuaternion(turn).multiplyScalar(share * person.armLength).add(pose.position(INDEX[`${side}UpperArm`]));
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
    const root = poseOf(this).position(0);
    return new Vector3(root.x, selfOf(this).floor(root.x, root.z), root.z);
  }

  /** its ground velocity: its centre of mass's over the last sub-step, horizontal (m/s) */
  get velocity(): Vector3 {
    const self = selfOf(this), [prev, prev2] = reader ? self.posesFor(reader) : [self.frame.prev, self.frame.prev2];
    return prev.com(new Vector3()).sub(prev2.com(new Vector3())).divideScalar(self.frame.dt).setY(0);
  }

  /** the way it faces (rad about +Y; 0 faces +Z) */
  get facing(): number {
    return poseOf(this).facing;
  }

  /** come to rest: no walk under way, its feet planted a while and none wanting to step */
  get settled(): boolean {
    return selfOf(this).locomotion.settled;
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

  /** what `dev: true` found (empty with it off), one row per check and call site: sub-step motion checks and misuse noted, not failures, which throw (`Missed`) */
  get log(): readonly LogEntry[] {
    return selfOf(this).log;
  }
}

const selves = new WeakMap<Body, Self>();
const UP = new Vector3(0, 1, 0);

/** `body`'s last final pose: bone rotations and positions by index, its centre of mass, what its bones carry, as the body updating now reads it */
export function poseOf(body: Body): ReadonlyPose {
  const self = selfOf(body);
  return reader && reader !== self ? self.poseFor(reader) : self.pose;
}

/** the runtime of `body` */
export function selfOf(body: Body): Self {
  const self = selves.get(body);
  if (!self) throw new Error('not a body made with new Body');
  return self;
}

/** the body updating now, if any: while it does, another body's state reads as it was before that body's own update this frame */
let reader: Self | null = null;
